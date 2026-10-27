import hashlib
import secrets
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api import base, models

WORKSPACE_MCP_TOKEN_TYPE = "workspace_mcp"  # noqa: S105
WORKSPACE_MCP_TOKEN_PREFIX = "ws_mcp_"  # noqa: S105
DISPLAY_TOKEN_PREFIX_LENGTH = 20

workspace_mcp_credentials_exception = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate Workspace MCP credentials",
)


def generate_workspace_mcp_token() -> str:
    return f"{WORKSPACE_MCP_TOKEN_PREFIX}{secrets.token_urlsafe(32)}"


def hash_workspace_mcp_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def display_token_prefix(token: str) -> str:
    return token[:DISPLAY_TOKEN_PREFIX_LENGTH]


async def validate_workspace_mcp_token(db: AsyncSession, token: str) -> UUID:
    token_hash = hash_workspace_mcp_token(token)
    result = await db.execute(
        select(models.PersonalAccessToken).where(
            models.PersonalAccessToken.token_hash == token_hash,
            models.PersonalAccessToken.token_type == WORKSPACE_MCP_TOKEN_TYPE,
            models.PersonalAccessToken.revoked_at.is_(None),
        )
    )
    personal_access_token = result.scalar_one_or_none()
    if personal_access_token is None:
        raise workspace_mcp_credentials_exception

    personal_access_token.last_used_at = base.get_now()
    await db.commit()
    return personal_access_token.user_uuid
