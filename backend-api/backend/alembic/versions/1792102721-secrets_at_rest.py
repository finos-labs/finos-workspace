"""secrets at rest

Stores every secret the API uses again encrypted with AES-256-GCM, in the v1 format below
(revision 4c1d2e8f9a3b re-encrypts it to the format of api/crypto.py):

- The encrypted columns (api_source.endpointHeaders, custom_copilot.headers and
  custom_copilot.copilots) are re-encrypted from the old AES-CBC format, whose key was
  SHA-256 of WORKSPACE_AES_KEY, to the v1 format under the same WORKSPACE_AES_KEY. A value
  that does not decrypt (another key, damaged) is cleared; the log counts them.
- user.totp_secret becomes an encrypted column; user.totp_last_step records the time step
  of the last authenticator code accepted, so that no code is accepted twice.
- The users' own Copilot provider keys move out of user.display_settings into the
  encrypted columns user.openai_api_key and user.perplexity_api_key.
- The custom headers of MCP servers move out of the server list (mcp_servers.servers)
  into the encrypted column mcp_servers.headers, keyed by the normalized server URL.
- user.auth_token (the SDK token, a JWT kept as issued) and session.api_token are dropped,
  with the sessions the SDK signed in with. The API has no SDK routes.
- Invitations no longer hold a password: the generated ones are deleted from
  user_invite.data.

downgrade() restores the schema, and the encrypted columns go back to the AES-CBC
format. Nothing is written back in plain text: authenticator secrets are cleared (users
set up their authenticator again), provider keys and MCP headers are dropped, and
user.auth_token and session.api_token come back empty.

Revision ID: ff59d563599c
Revises: bd12bc3c71ac
Create Date: 2026-10-15

"""

import base64
import gzip
import hashlib
import json
import logging
import os

import sqlalchemy as sa
import sqlalchemy_utils
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes, padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy.dialects import postgresql

from alembic import op  # type: ignore
from api import crypto
from api.schemas import normalize_mcp_url
from utilities.config import settings

# revision identifiers, used by Alembic.
revision = "ff59d563599c"
down_revision = "bd12bc3c71ac"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")

# (table, column) of every EncryptedType column
ENCRYPTED_COLUMNS = [
    ("api_source", "endpointHeaders"),
    ("custom_copilot", "headers"),
    ("custom_copilot", "copilots"),
]
# The display settings that held the users' own provider keys, and their new columns
PROVIDER_KEYS = {
    "openaiApiKey": "openai_api_key",
    "perplexityApiKey": "perplexity_api_key",
}
# Where a stored MCP server kept its custom headers
MCP_HEADER_KEYS = ("custom_headers", "customHeaders")

CBC_BLOCK_BYTES = 16

# The format this revision writes: "v1." + base64url(nonce || ciphertext || tag), AES-256-GCM
# without associated data under HKDF-SHA256 of WORKSPACE_AES_KEY
V1_PREFIX = "v1."
V1_HKDF_INFO = b"workspace-at-rest:v1"
V1_NONCE_BYTES = 12

UUID_TYPE = sqlalchemy_utils.types.uuid.UUIDType()
JSON_TYPE = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def _cbc_cipher(iv: bytes) -> Cipher:
    """The old cipher: AES-256-CBC under SHA-256 of WORKSPACE_AES_KEY."""
    key = hashlib.sha256(settings.WORKSPACE_AES_KEY.encode()).digest()
    return Cipher(algorithms.AES(key), modes.CBC(iv))


def _cbc_decrypt(value: str) -> object:
    """The JSON value of an old ciphertext, base64(ciphertext || IV) with PKCS#7 padding.
    Raises ValueError for anything else."""
    raw = base64.b64decode(value, validate=True)
    if len(raw) < 2 * CBC_BLOCK_BYTES or len(raw) % CBC_BLOCK_BYTES:
        raise ValueError("not an AES-CBC ciphertext")
    decryptor = _cbc_cipher(raw[-CBC_BLOCK_BYTES:]).decryptor()
    padded = decryptor.update(raw[:-CBC_BLOCK_BYTES]) + decryptor.finalize()
    unpadder = padding.PKCS7(CBC_BLOCK_BYTES * 8).unpadder()
    return json.loads(unpadder.update(padded) + unpadder.finalize())


def _cbc_encrypt(value: object) -> str:
    padder = padding.PKCS7(CBC_BLOCK_BYTES * 8).padder()
    padded = padder.update(json.dumps(value).encode()) + padder.finalize()
    iv = os.urandom(CBC_BLOCK_BYTES)
    encryptor = _cbc_cipher(iv).encryptor()
    return base64.b64encode(encryptor.update(padded) + encryptor.finalize() + iv).decode()


def _v1_cipher() -> AESGCM:
    material = crypto.decode_key_material(settings.WORKSPACE_AES_KEY)
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=V1_HKDF_INFO)
    return AESGCM(key.derive(material))


def _v1_encrypt(plaintext: bytes) -> str:
    nonce = os.urandom(V1_NONCE_BYTES)
    sealed = nonce + _v1_cipher().encrypt(nonce, plaintext, None)
    return V1_PREFIX + base64.urlsafe_b64encode(sealed).rstrip(b"=").decode("ascii")


def _v1_encrypt_text(value: str) -> str:
    return _v1_encrypt(value.encode("utf-8"))


def _v1_encrypt_json(value: object) -> str:
    return _v1_encrypt(json.dumps(value, separators=(",", ":")).encode("utf-8"))


def _v1_decrypt_json(token: str) -> object:
    """The JSON value of a v1 ciphertext. Raises ValueError for anything else."""
    encoded = token.removeprefix(V1_PREFIX)
    raw = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
    try:
        plaintext = _v1_cipher().decrypt(raw[:V1_NONCE_BYTES], raw[V1_NONCE_BYTES:], None)
    except InvalidTag as exc:
        raise ValueError("not a v1 ciphertext of this key") from exc
    return json.loads(plaintext)


def _rows(table: sa.TableClause, *where) -> list:
    return op.get_bind().execute(sa.select(table).where(*where)).all()


def _update(table: sa.TableClause, uuid, **values) -> None:
    op.get_bind().execute(table.update().where(table.c.uuid == uuid).values(**values))


def _encrypted_column(table_name: str, column: str) -> sa.TableClause:
    return sa.table(table_name, sa.column("uuid", UUID_TYPE), sa.column(column, sa.Text))


def upgrade():
    _reencrypt_columns()

    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.alter_column(
            "totp_secret", existing_type=sa.String(length=32), type_=sa.Text()
        )
        batch_op.add_column(sa.Column("totp_last_step", sa.BigInteger(), nullable=True))
        batch_op.add_column(sa.Column("openai_api_key", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("perplexity_api_key", sa.Text(), nullable=True))
        batch_op.drop_column("auth_token")
    _encrypt_user_secrets()

    session = sa.table("session", sa.column("api_token", sa.String))
    op.execute(session.delete().where(session.c.api_token.is_not(None)))
    with op.batch_alter_table("session", schema=None) as batch_op:
        batch_op.drop_column("api_token")

    with op.batch_alter_table("mcp_servers", schema=None) as batch_op:
        batch_op.add_column(sa.Column("headers", sa.Text(), nullable=True))
    _move_mcp_headers()

    _drop_invite_passwords()


def _reencrypt_columns():
    for table_name, column in ENCRYPTED_COLUMNS:
        table = _encrypted_column(table_name, column)
        moved = cleared = 0
        for row in _rows(table, table.c[column].is_not(None)):
            value = row._mapping[column]
            if value.startswith(V1_PREFIX):
                continue
            try:
                new_value = _v1_encrypt_json(_cbc_decrypt(value))
                moved += 1
            except ValueError:
                new_value = None
                cleared += 1
            _update(table, row.uuid, **{column: new_value})
        log.info(
            "%s.%s: %d values re-encrypted, %d that did not decrypt cleared",
            table_name,
            column,
            moved,
            cleared,
        )


def _encrypt_user_secrets():
    user = sa.table(
        "user",
        sa.column("uuid", UUID_TYPE),
        sa.column("totp_secret", sa.Text),
        sa.column("display_settings", JSON_TYPE),
        *(sa.column(column, sa.Text) for column in PROVIDER_KEYS.values()),
    )
    has_secret = sa.or_(
        user.c.totp_secret.is_not(None), user.c.display_settings.is_not(None)
    )
    moved_keys = 0
    for row in _rows(user, has_secret):
        values = {}
        if row.totp_secret is not None:
            values["totp_secret"] = _v1_encrypt_text(row.totp_secret)
        # The app stores display settings as a JSON document holding their JSON text
        display_settings = row.display_settings
        as_text = isinstance(display_settings, str)
        if as_text:
            try:
                display_settings = json.loads(display_settings)
            except ValueError:
                display_settings = None
        if isinstance(display_settings, dict) and PROVIDER_KEYS.keys() & display_settings.keys():
            kept = {
                name: value
                for name, value in display_settings.items()
                if name not in PROVIDER_KEYS
            }
            values["display_settings"] = json.dumps(kept) if as_text else kept
            for name, column in PROVIDER_KEYS.items():
                key = display_settings.get(name)
                if isinstance(key, str) and key.strip():
                    values[column] = _v1_encrypt_text(key.strip())
                    moved_keys += 1
        if values:
            _update(user, row.uuid, **values)
    log.info("user: %d provider keys moved out of display_settings", moved_keys)


def _move_mcp_headers():
    mcp_servers = sa.table(
        "mcp_servers",
        sa.column("uuid", UUID_TYPE),
        sa.column("servers", sa.LargeBinary),
        sa.column("headers", sa.Text),
    )
    for row in _rows(mcp_servers, mcp_servers.c.servers.is_not(None)):
        try:
            servers = json.loads(gzip.decompress(row.servers).decode("utf-8"))
        except (OSError, EOFError, ValueError):
            continue
        if not isinstance(servers, list):
            continue
        headers: dict[str, dict[str, str]] = {}
        for server in servers:
            if not isinstance(server, dict):
                continue
            found = {}
            for key in MCP_HEADER_KEYS:
                if isinstance(value := server.pop(key, None), dict):
                    found.update(value)
            found = {
                name: value
                for name, value in found.items()
                if isinstance(name, str) and isinstance(value, str) and value
            }
            if found and isinstance(server.get("url"), str):
                headers.setdefault(normalize_mcp_url(server["url"]), {}).update(found)
        _update(
            mcp_servers,
            row.uuid,
            servers=gzip.compress(json.dumps(servers).encode("utf-8")),
            headers=_v1_encrypt_json(headers) if headers else None,
        )


def _drop_invite_passwords():
    invite = sa.table(
        "user_invite", sa.column("uuid", UUID_TYPE), sa.column("data", JSON_TYPE)
    )
    for row in _rows(invite, invite.c.data.is_not(None)):
        if isinstance(row.data, dict) and "password" in row.data:
            data = {name: value for name, value in row.data.items() if name != "password"}
            _update(invite, row.uuid, data=data)


def downgrade():
    with op.batch_alter_table("mcp_servers", schema=None) as batch_op:
        batch_op.drop_column("headers")

    with op.batch_alter_table("session", schema=None) as batch_op:
        batch_op.add_column(sa.Column("api_token", sa.String(length=300), nullable=True))

    user = sa.table(
        "user", sa.column("totp_secret", sa.Text), sa.column("totp_active", sa.Boolean)
    )
    op.execute(user.update().values(totp_secret=None, totp_active=False))
    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.add_column(sa.Column("auth_token", sa.Text(), nullable=True))
        batch_op.drop_column("perplexity_api_key")
        batch_op.drop_column("openai_api_key")
        batch_op.drop_column("totp_last_step")
        batch_op.alter_column(
            "totp_secret", existing_type=sa.Text(), type_=sa.String(length=32)
        )

    for table_name, column in ENCRYPTED_COLUMNS:
        table = _encrypted_column(table_name, column)
        for row in _rows(table, table.c[column].like(f"{V1_PREFIX}%")):
            try:
                old_value = _cbc_encrypt(_v1_decrypt_json(row._mapping[column]))
            except ValueError:
                old_value = None
            _update(table, row.uuid, **{column: old_value})
