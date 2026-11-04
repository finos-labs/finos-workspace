import json

from starlette.types import ASGIApp, Message, Receive, Scope, Send

FRAME_PREFIX = "/app/data-connectors/frame/"
JSON_BODY_BYTES = 2 * 1024 * 1024
FRAME_BODY_BYTES = 10 * 1024 * 1024
MCP_BODY_BYTES = 10 * 1024 * 1024
AGENT_BODY_BYTES = 64 * 1024 * 1024


class TooLarge(Exception):
    pass


def limit_for(path: str) -> int | None:
    if path.startswith(FRAME_PREFIX):
        return FRAME_BODY_BYTES
    if path == "/app/mcp-proxy":
        return MCP_BODY_BYTES
    if path.startswith("/app/custom-copilot/") and path.endswith("/relay"):
        return AGENT_BODY_BYTES
    if path in {"/app/custom-copilot", "/app/custom-copilot/discover"}:
        return JSON_BODY_BYTES
    if path.startswith("/app/data-connectors/api-source") and (path.endswith("/request") or path.endswith("/frame")):
        return JSON_BODY_BYTES
    return None


class BodyLimitMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        limit = limit_for(scope["path"]) if scope["type"] == "http" else None
        if limit is None:
            await self.app(scope, receive, send)
            return
        headers = {k.lower(): v for k, v in scope["headers"]}
        length = headers.get(b"content-length")
        if length is not None and (not length.isdigit() or int(length) > limit):
            await self._refuse(send)
            return
        total = 0
        started = False

        async def limited() -> Message:
            nonlocal total
            message = await receive()
            if message["type"] == "http.request":
                total += len(message.get("body", b""))
                if total > limit:
                    raise TooLarge
            return message

        async def watched(message: Message) -> None:
            nonlocal started
            started = True
            await send(message)

        try:
            await self.app(scope, limited, watched)
        except TooLarge:
            if started:
                raise
            await self._refuse(send)

    @staticmethod
    async def _refuse(send: Send) -> None:
        body = json.dumps({"detail": "the request is too large", "status": 413}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                    (b"x-workspace-proxy-error", b"1"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
