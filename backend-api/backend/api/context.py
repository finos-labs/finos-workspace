from contextvars import ContextVar
from uuid import UUID

session_uuid_ctx: ContextVar[UUID | None] = ContextVar("session_uuid", default=None)
