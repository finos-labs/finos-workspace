import base64
import gzip
import hashlib
import json
import logging
import os

import sqlalchemy as sa
import sqlalchemy_utils
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy.dialects import mysql

import api.models.model_helpers
from alembic import op  # type: ignore
from api import crypto
from utilities.config import settings

revision = "4c1d2e8f9a3b"
down_revision = "210b7a161dbc"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")

ENCRYPTED_COLUMNS = [
    ("api_source", "endpointHeaders"),
    ("custom_copilot", "headers"),
    ("custom_copilot", "copilots"),
    ("mcp_servers", "headers"),
    ("user", "totp_secret"),
    ("user", "openai_api_key"),
    ("user", "perplexity_api_key"),
]
SERVERS_CONTEXT = "mcp_servers.servers"
GRANT_CONTEXT = "mcp_oauth_grant.credentials"
OLD_GRANT_UNIQUE = "uix_mcp_oauth_grant"
GRANT_UNIQUE = "uix_mcp_oauth_grant_server"
OLD_SERVER_URL_LENGTH = 400
BATCH_SIZE = 200

UUID_TYPE = sqlalchemy_utils.types.uuid.UUIDType()
MEDIUM_TEXT = sa.Text().with_variant(mysql.MEDIUMTEXT(), "mysql")

V1_PREFIX = "v1."
V1_HKDF_INFO = b"workspace-at-rest:v1"
V1_NONCE_BYTES = 12


def _v1_cipher() -> AESGCM:
    material = crypto.decode_key_material(settings.WORKSPACE_AES_KEY)
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=V1_HKDF_INFO)
    return AESGCM(key.derive(material))


def _v1_encrypt(plaintext: bytes) -> str:
    nonce = os.urandom(V1_NONCE_BYTES)
    sealed = nonce + _v1_cipher().encrypt(nonce, plaintext, None)
    return V1_PREFIX + base64.urlsafe_b64encode(sealed).rstrip(b"=").decode("ascii")


def _v1_decrypt(token: str) -> bytes:
    encoded = token.removeprefix(V1_PREFIX)
    raw = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
    try:
        return _v1_cipher().decrypt(raw[:V1_NONCE_BYTES], raw[V1_NONCE_BYTES:], None)
    except InvalidTag as exc:
        raise ValueError("not a v1 ciphertext of this key") from exc


def _server_hash(server_url: str) -> str:
    return hashlib.sha256(server_url.encode("utf-8")).hexdigest()


def _batches(table: sa.TableClause, columns: list[str], *where):
    bind = op.get_bind()
    uuids = bind.execute(sa.select(table.c.uuid).where(*where)).scalars().all()
    for start in range(0, len(uuids), BATCH_SIZE):
        yield bind.execute(
            sa.select(table.c.uuid, *(table.c[column] for column in columns)).where(
                table.c.uuid.in_(uuids[start : start + BATCH_SIZE])
            )
        ).all()


def _update(table: sa.TableClause, uuid, **values) -> None:
    op.get_bind().execute(table.update().where(table.c.uuid == uuid).values(**values))


def _delete(table: sa.TableClause, uuid) -> None:
    op.get_bind().execute(table.delete().where(table.c.uuid == uuid))


def _text_column(table_name: str, column: str) -> sa.TableClause:
    return sa.table(table_name, sa.column("uuid", UUID_TYPE), sa.column(column, sa.Text))


def upgrade():
    for table_name, column in ENCRYPTED_COLUMNS:
        _reencrypt(table_name, column)
    _encrypt_server_lists()
    _key_grants_by_hash()


def _reencrypt(table_name: str, column: str) -> None:
    table = _text_column(table_name, column)
    moved = cleared = 0
    for rows in _batches(table, [column], table.c[column].like(f"{V1_PREFIX}%")):
        for row in rows:
            try:
                plaintext = _v1_decrypt(row._mapping[column])
            except ValueError:
                new_value = None
                cleared += 1
            else:
                new_value = crypto.at_rest_cipher().encrypt(
                    plaintext, f"{table_name}.{column}"
                )
                moved += 1
            _update(table, row.uuid, **{column: new_value})
    log.info(
        "%s.%s: %d values re-encrypted, %d that did not decrypt cleared",
        table_name,
        column,
        moved,
        cleared,
    )


def _encrypt_server_lists() -> None:
    gzipped = sa.table(
        "mcp_servers", sa.column("uuid", UUID_TYPE), sa.column("servers", sa.LargeBinary)
    )
    sealed: dict = {}
    cleared = 0
    for rows in _batches(gzipped, ["servers"], gzipped.c.servers.is_not(None)):
        for row in rows:
            try:
                servers = json.loads(gzip.decompress(row.servers).decode("utf-8"))
            except (OSError, EOFError, ValueError):
                cleared += 1
                continue
            sealed[row.uuid] = crypto.encrypt_json(servers, SERVERS_CONTEXT)

    with op.batch_alter_table("mcp_servers", schema=None) as batch_op:
        batch_op.drop_column("servers")
    with op.batch_alter_table("mcp_servers", schema=None) as batch_op:
        batch_op.add_column(sa.Column("servers", MEDIUM_TEXT, nullable=True))

    encrypted = _text_column("mcp_servers", "servers")
    for uuid, value in sealed.items():
        _update(encrypted, uuid, servers=value)
    log.info(
        "mcp_servers.servers: %d server lists encrypted, %d unreadable cleared",
        len(sealed),
        cleared,
    )


def _key_grants_by_hash() -> None:
    with op.batch_alter_table("mcp_oauth_grant", schema=None) as batch_op:
        batch_op.add_column(sa.Column("server_hash", sa.String(length=64), nullable=True))

    grant = sa.table(
        "mcp_oauth_grant",
        sa.column("uuid", UUID_TYPE),
        sa.column("user_uuid", UUID_TYPE),
        sa.column("server_url", sa.String),
        sa.column("server_hash", sa.String),
        sa.column("credentials", sa.Text),
    )
    moved = deleted = 0
    for rows in _batches(grant, ["user_uuid", "server_url", "credentials"]):
        for row in rows:
            try:
                credentials = json.loads(_v1_decrypt(row.credentials))
            except ValueError:
                _delete(grant, row.uuid)
                deleted += 1
                continue
            credentials.update(user_uuid=str(row.user_uuid), server_url=row.server_url)
            _update(
                grant,
                row.uuid,
                server_hash=_server_hash(row.server_url),
                credentials=crypto.encrypt_json(credentials, GRANT_CONTEXT),
            )
            moved += 1
    log.info(
        "mcp_oauth_grant: %d grants keyed by server hash, %d that did not decrypt deleted",
        moved,
        deleted,
    )

    with op.batch_alter_table("mcp_oauth_grant", schema=None) as batch_op:
        batch_op.create_unique_constraint(GRANT_UNIQUE, ["user_uuid", "server_hash"])
        batch_op.drop_constraint(OLD_GRANT_UNIQUE, type_="unique")
        batch_op.drop_column("server_url")
        batch_op.alter_column(
            "server_hash", existing_type=sa.String(length=64), nullable=False
        )


def downgrade():
    _key_grants_by_url()
    _gzip_server_lists()
    for table_name, column in ENCRYPTED_COLUMNS:
        _restore_v1(table_name, column)


def _key_grants_by_url() -> None:
    with op.batch_alter_table("mcp_oauth_grant", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("server_url", sa.String(length=OLD_SERVER_URL_LENGTH), nullable=True)
        )

    grant = sa.table(
        "mcp_oauth_grant",
        sa.column("uuid", UUID_TYPE),
        sa.column("server_url", sa.String),
        sa.column("credentials", sa.Text),
    )
    for rows in _batches(grant, ["credentials"]):
        for row in rows:
            try:
                credentials = crypto.decrypt_json(row.credentials, GRANT_CONTEXT)
            except crypto.DecryptionError:
                _delete(grant, row.uuid)
                continue
            credentials.pop("user_uuid", None)
            server_url = credentials.pop("server_url", None)
            if not isinstance(server_url, str) or len(server_url) > OLD_SERVER_URL_LENGTH:
                _delete(grant, row.uuid)
                continue
            payload = json.dumps(credentials, separators=(",", ":")).encode("utf-8")
            _update(grant, row.uuid, server_url=server_url, credentials=_v1_encrypt(payload))

    with op.batch_alter_table("mcp_oauth_grant", schema=None) as batch_op:
        batch_op.create_unique_constraint(OLD_GRANT_UNIQUE, ["user_uuid", "server_url"])
        batch_op.drop_constraint(GRANT_UNIQUE, type_="unique")
        batch_op.drop_column("server_hash")
        batch_op.alter_column(
            "server_url",
            existing_type=sa.String(length=OLD_SERVER_URL_LENGTH),
            nullable=False,
        )


def _gzip_server_lists() -> None:
    encrypted = _text_column("mcp_servers", "servers")
    gzipped_values: dict = {}
    for rows in _batches(encrypted, ["servers"], encrypted.c.servers.is_not(None)):
        for row in rows:
            try:
                servers = crypto.decrypt_json(row.servers, SERVERS_CONTEXT)
            except crypto.DecryptionError:
                continue
            gzipped_values[row.uuid] = gzip.compress(json.dumps(servers).encode("utf-8"))

    with op.batch_alter_table("mcp_servers", schema=None) as batch_op:
        batch_op.drop_column("servers")
    with op.batch_alter_table("mcp_servers", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("servers", api.models.model_helpers.GzipJsonType(), nullable=True)
        )

    gzipped = sa.table(
        "mcp_servers", sa.column("uuid", UUID_TYPE), sa.column("servers", sa.LargeBinary)
    )
    for uuid, value in gzipped_values.items():
        _update(gzipped, uuid, servers=value)


def _restore_v1(table_name: str, column: str) -> None:
    table = _text_column(table_name, column)
    context = f"{table_name}.{column}"
    prefix = crypto.VERSION_PREFIX
    for rows in _batches(table, [column], table.c[column].like(f"{prefix}%")):
        for row in rows:
            try:
                plaintext = crypto.at_rest_cipher().decrypt(row._mapping[column], context)
            except crypto.DecryptionError:
                new_value = None
            else:
                new_value = _v1_encrypt(plaintext)
            _update(table, row.uuid, **{column: new_value})
