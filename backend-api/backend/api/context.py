from contextvars import ContextVar
from uuid import UUID

# The row id (Session.uuid) of the session the current request rides, for the audit log
session_uuid_ctx: ContextVar[UUID | None] = ContextVar("session_uuid", default=None)
