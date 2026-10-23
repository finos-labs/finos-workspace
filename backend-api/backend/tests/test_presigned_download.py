import io
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from api.models import StoredFile
from api.storage import FileStorage
from tests.fixtures.base import _AUTH_USER, TEST_BASE_URL, TEST_ORIGIN, app, settings

CONTENT = b"%PDF-1.4 a document for the agent"


@pytest.fixture
async def stored_file(auth_client, db_session):
    name = f"{uuid4()}.pdf"
    bucket = settings.get_file_bucket()
    assert await FileStorage.upload_file(io.BytesIO(CONTENT), bucket, name)
    row = StoredFile(
        creater_uuid=UUID(_AUTH_USER["user_uuid"]),
        s3_file_name=name,
        bucket=bucket,
        extension="pdf",
        original_file_name="report.pdf",
        size=len(CONTENT),
    )
    db_session.add(row)
    await db_session.commit()
    yield name
    await db_session.delete(row)
    await db_session.commit()
    settings.get_local_file_path(name).unlink(missing_ok=True)


async def _presigned_path(auth_client, name: str) -> str:
    response = await auth_client.get(f"/app/files/{name}/presigned-url")
    assert response.status_code == 200, response.text
    url = urlsplit(response.json()["pre_signed_url"])
    assert url.path.startswith("/app/files/presigned/")
    return f"{url.path}?{url.query}"


@pytest.fixture
async def agent(client):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=TEST_BASE_URL, headers={"Origin": TEST_ORIGIN}
    ) as agent:
        yield agent


class TestThePresignedDownload:
    @pytest.mark.asyncio
    async def test_an_agent_downloads_with_the_url_alone(self, auth_client, stored_file, agent):
        response = await agent.get(await _presigned_path(auth_client, stored_file))
        assert response.status_code == 200, response.text
        assert response.content == CONTENT

    @pytest.mark.asyncio
    async def test_a_wrong_signature_is_refused(self, auth_client, stored_file, agent):
        path = await _presigned_path(auth_client, stored_file)
        response = await agent.get(path.replace("Signature=", "Signature=0", 1))
        assert response.status_code == 403
