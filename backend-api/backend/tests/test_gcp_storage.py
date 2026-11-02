import io
import json
import socket
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

import aiohttp
import pytest
from aiohttp import web
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from pydantic import ValidationError

from api.schemas import StoredFileSchema
from api.storage.gcp import GCPStorage, GCSClients, service_account_email
from utilities.config import Settings

BUCKET = "workspace-files"
IMAGE = "fsouza/fake-gcs-server:1.56.1"
SERVICE_ACCOUNT = "files@workspace.iam.gserviceaccount.com"


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


@pytest.fixture(scope="module")
def emulator_address():
    from docker.errors import DockerException
    from testcontainers.core.container import DockerContainer
    from testcontainers.core.wait_strategies import LogMessageWaitStrategy

    port = free_port()
    address = f"http://127.0.0.1:{port}"
    try:
        container = (
            DockerContainer(IMAGE)
            .with_command(f"-scheme http -port 4443 -backend memory -external-url {address}")
            .with_bind_ports(4443, port)
            .waiting_for(LogMessageWaitStrategy("server started at"))
        )
        container.start()
    except DockerException as exc:
        pytest.skip(f"Unable to start the Google Cloud Storage emulator: {exc}")
    try:
        yield address
    finally:
        container.stop()


@pytest.fixture
def key_file(tmp_path):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    path = tmp_path / "service-account.json"
    path.write_text(
        json.dumps(
            {
                "type": "service_account",
                "project_id": "workspace",
                "private_key_id": "key-1",
                "private_key": pem,
                "client_email": SERVICE_ACCOUNT,
                "client_id": "1",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        )
    )
    return path


@pytest.fixture
async def bucket(emulator_address, key_file, monkeypatch):
    monkeypatch.setenv("STORAGE_EMULATOR_HOST", emulator_address)
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", str(key_file))
    name = f"{BUCKET}-{uuid4().hex[:8]}"
    async with aiohttp.ClientSession() as session:
        response = await session.post(f"{emulator_address}/storage/v1/b", json={"name": name})
        response.raise_for_status()
    yield name
    await GCSClients.close()


def stored(bucket: str, name: str | None = None, original: str = "notes.txt") -> StoredFileSchema:
    return StoredFileSchema(
        creater_uuid=uuid4(),
        s3_file_name=name or f"{uuid4()}.txt",
        bucket=bucket,
        extension="txt",
        original_file_name=original,
        size=0,
    )


async def test_a_file_goes_up_and_comes_back(bucket):
    pending = stored(bucket)
    content = b"quarterly notes\n" * 100

    uploaded = await GCPStorage.upload_pending_file(io.BytesIO(content), pending)

    assert uploaded.failed is False
    assert await GCPStorage.check_file_exists(pending) is True
    assert await GCPStorage.get_file(bucket, pending.s3_file_name) == content


async def test_a_large_file_goes_up_in_a_resumable_upload(bucket):
    pending = stored(bucket)
    content = bytes(range(256)) * (6 * 1024 * 4)

    assert await GCPStorage.upload_file(io.BytesIO(content), bucket, pending.s3_file_name) is True

    assert await GCPStorage.get_file(bucket, pending.s3_file_name) == content


async def test_an_upload_that_fails_marks_the_file_failed(emulator_address, key_file, monkeypatch):
    monkeypatch.setenv("STORAGE_EMULATOR_HOST", emulator_address)
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", str(key_file))
    pending = stored("no-such-bucket")

    uploaded = await GCPStorage.upload_pending_file(io.BytesIO(b"x"), pending)

    assert uploaded.failed is True
    assert await GCPStorage.upload_file(io.BytesIO(b"x"), "no-such-bucket", "a.txt") is False
    await GCSClients.close()


async def test_a_missing_file_is_missing(bucket):
    missing = stored(bucket)

    assert await GCPStorage.check_file_exists(missing) is False
    assert await GCPStorage.get_file(bucket, missing.s3_file_name) is None
    assert await GCPStorage.delete_file(bucket, missing.s3_file_name) is False


async def test_a_deleted_file_is_gone(bucket):
    pending = stored(bucket)
    await GCPStorage.upload_pending_file(io.BytesIO(b"x"), pending)

    assert await GCPStorage.delete_file(bucket, pending.s3_file_name) is True

    assert await GCPStorage.check_file_exists(pending) is False


async def test_a_file_streams_with_its_name_and_type(bucket):
    pending = stored(bucket, original="Q3 notes é.txt")
    content = b"stream me " * 200_000
    await GCPStorage.upload_pending_file(io.BytesIO(content), pending)
    sent = []

    async def send(message):
        sent.append(message)

    stream = GCPStorage.get_stream(pending)
    await stream.stream_response(send)

    start = sent[0]
    headers = dict(start["headers"])
    assert start["status"] == 200
    assert headers[b"content-disposition"] == b'attachment; filename="Q3%20notes%20%C3%A9.txt"'
    assert headers[b"content-type"].startswith(b"text/plain")
    body = b"".join(message["body"] for message in sent[1:])
    assert body == content
    assert sent[-1]["more_body"] is False


async def test_a_signed_link_names_the_file_and_when_it_ends(bucket):
    name = f"{uuid4()}.txt"

    link = await GCPStorage.create_presigned_url(bucket, name, 900)

    parsed = urlparse(link)
    query = parse_qs(parsed.query)
    assert parsed.scheme == "https"
    assert parsed.path == f"/{bucket}/{name}"
    assert query["X-Goog-Algorithm"] == ["GOOG4-RSA-SHA256"]
    assert query["X-Goog-Expires"] == ["900"]
    assert query["X-Goog-Credential"][0].startswith(f"{SERVICE_ACCOUNT}/")
    assert len(query["X-Goog-Signature"][0]) == 512


async def test_a_machine_without_a_key_is_asked_for_its_service_account(bucket):
    asked = []

    async def email(request):
        asked.append(request.headers.get("Metadata-Flavor"))
        return web.Response(text=f"{SERVICE_ACCOUNT}\n")

    app = web.Application()
    app.router.add_get("/service-accounts/default/email", email)
    runner = web.AppRunner(app)
    await runner.setup()
    port = free_port()
    await web.TCPSite(runner, "127.0.0.1", port).start()
    client = GCSClients.get()
    client.token.service_data = {}
    try:
        found = await service_account_email(
            client, f"http://127.0.0.1:{port}/service-accounts/default/email"
        )
    finally:
        await runner.cleanup()

    assert found == SERVICE_ACCOUNT
    assert asked == ["Google"]


def test_gcp_needs_its_bucket():
    with pytest.raises(ValidationError, match="GCP_STORAGE_BUCKET"):
        Settings(STORAGE_PROVIDER="gcp", GCP_STORAGE_BUCKET=None)
    assert Settings(STORAGE_PROVIDER="gcp", GCP_STORAGE_BUCKET="files").get_file_bucket() == "files"
