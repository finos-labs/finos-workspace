import json

import pytest

from api.body_limit import FRAME_BODY_BYTES, FRAME_PREFIX, JSON_BODY_BYTES, BodyLimitMiddleware, limit_for


def test_only_the_routes_that_pass_bodies_on_have_a_limit():
    assert limit_for("/app/data-connectors/api-source/abc/request") == JSON_BODY_BYTES
    assert limit_for("/app/data-connectors/api-source-test/request") == JSON_BODY_BYTES
    assert limit_for("/app/data-connectors/api-source/abc/frame") == JSON_BODY_BYTES
    assert limit_for(f"{FRAME_PREFIX}token/page") == FRAME_BODY_BYTES
    assert limit_for("/app/data-connectors/api-source/abc") is None
    assert limit_for("/app/dash/sync") is None


async def run(path, body_chunks, headers=()):
    seen = {"read": 0, "start": None, "body": b""}

    async def app(scope, receive, send):
        while True:
            message = await receive()
            seen["read"] += len(message.get("body", b""))
            if not message.get("more_body"):
                break
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    chunks = list(body_chunks)

    async def receive():
        chunk = chunks.pop(0) if chunks else b""
        return {"type": "http.request", "body": chunk, "more_body": bool(chunks)}

    async def send(message):
        if message["type"] == "http.response.start":
            seen["start"] = message["status"]
        else:
            seen["body"] += message.get("body", b"")

    scope = {"type": "http", "path": path, "headers": list(headers)}
    await BodyLimitMiddleware(app)(scope, receive, send)
    return seen


@pytest.mark.asyncio
async def test_a_declared_length_over_the_limit_is_refused_without_reading_anything():
    seen = await run(
        "/app/data-connectors/api-source/x/request",
        [b"x"],
        headers=[(b"content-length", str(JSON_BODY_BYTES + 1).encode())],
    )
    assert seen["start"] == 413
    assert seen["read"] == 0
    assert json.loads(seen["body"])["status"] == 413


@pytest.mark.asyncio
async def test_a_chunked_body_is_stopped_when_it_goes_over_the_limit():
    chunk = b"x" * (512 * 1024)
    seen = await run("/app/data-connectors/api-source/x/request", [chunk] * 6)
    assert seen["start"] == 413
    assert seen["read"] <= JSON_BODY_BYTES


@pytest.mark.asyncio
async def test_a_body_within_the_limit_and_any_other_route_pass_through():
    assert (await run("/app/data-connectors/api-source/x/request", [b"x" * 100]))["start"] == 200
    huge = await run("/app/dash/sync", [b"x" * (JSON_BODY_BYTES + 10)])
    assert huge["start"] == 200
