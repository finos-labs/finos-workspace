import hashlib
import time
from urllib.parse import unquote, urlsplit
from uuid import UUID

import jwt

from api.auth_helpers import FRAME_ROUTE
from api.source_proxy import refused, remember, snapshot
from utilities.config import settings

LINK_PREFIX = "ws_frame_"
AUDIENCE = "frame"
TTL_SECONDS = 3600
SANDBOX = "sandbox allow-scripts allow-forms allow-popups allow-downloads"
FORWARDED_HEADERS = ("accept-language", "content-type", "if-modified-since", "if-none-match", "range")
MAX_BODY_BYTES = 10 * 1024 * 1024


def _key() -> bytes:
    return hashlib.sha256(b"workspace-frame\0" + settings.JWT_SECRET.encode()).digest()


def issue(user_uuid: UUID, source_uuid: UUID, widget_id: str, prefix: str, session_uuid: UUID | None = None) -> str:
    now = int(time.time())
    claims = {
        "aud": AUDIENCE,
        "sub": str(user_uuid),
        "src": str(source_uuid),
        "wid": widget_id,
        "pre": prefix,
        "iat": now,
        "exp": now + TTL_SECONDS,
        **({"sid": str(session_uuid)} if session_uuid else {}),
    }
    return LINK_PREFIX + jwt.encode(claims, _key(), algorithm="HS256")


def read(token: str) -> dict:
    if not token.startswith(LINK_PREFIX):
        raise refused("this page link is not valid", 401)
    try:
        return jwt.decode(token.removeprefix(LINK_PREFIX), _key(), algorithms=["HS256"], audience=AUDIENCE)
    except jwt.PyJWTError as error:
        raise refused("this page link is not valid or has expired", 401) from error


def climbs(path: str) -> bool:
    for _ in range(3):
        path = unquote(path)
        if "\\" in path or any(segment in {".", ".."} for segment in path.split("/")):
            return True
    return False


def directory_of(url: str) -> str:
    path = urlsplit(url).path or "/"
    if "{" in path:
        path = path[: path.index("{")]
    return path[: path.rfind("/") + 1] or "/"


def page_of(widgets: object, widget_id: str, base: str) -> str:
    widget = widgets.get(widget_id) if isinstance(widgets, dict) else None
    if not (isinstance(widget, dict) and widget.get("type") == "iframe" and widget.get("requires_auth") is True):
        raise refused("this widget does not declare requires_auth", 403)
    endpoint = widget.get("endpoint")
    if not isinstance(endpoint, str) or not endpoint:
        raise refused("this widget has no endpoint", 403)
    url = endpoint if endpoint.startswith("http") else f"{base.rstrip('/')}/{endpoint.lstrip('/')}"
    source, page = urlsplit(base), urlsplit(url)
    if (page.scheme, page.hostname, page.port or 0) != (source.scheme, source.hostname, source.port or 0):
        raise refused("the page is not on the connection's origin", 403)
    return url


def allowed(path: str, prefix: str) -> bool:
    return not climbs(path) and unquote(path).startswith(prefix)


def route(token: str, path: str) -> str:
    return f"{FRAME_ROUTE}{token}{path}"


ACCESS_SECONDS = 30.0
ACCESS_ENTRIES = 4096
_access: dict[tuple, tuple[float, object]] = {}


def cached_access(user_uuid: UUID, source_uuid: UUID):
    held = _access.get((user_uuid, source_uuid))
    if held and time.monotonic() - held[0] < ACCESS_SECONDS:
        return held[1]
    return None


def remember_access(
    user_uuid: UUID, source_uuid: UUID, source, email: str, trusted: bool, granted: frozenset[str] | None
):
    held = (snapshot(source), email, trusted, granted)
    remember(_access, ACCESS_ENTRIES, (user_uuid, source_uuid), (time.monotonic(), held))
    return held
