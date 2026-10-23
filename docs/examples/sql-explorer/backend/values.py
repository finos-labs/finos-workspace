import math
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from uuid import UUID

MAX_TEXT = 10_000
MAX_BYTES = 256
MAX_ITEMS = 1_000
MAX_DEPTH = 8
EXACT_INTEGER = 2**53


def cell(value: object, depth: int = 0) -> object:  # noqa: PLR0911
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value if abs(value) <= EXACT_INTEGER else str(value)
    if isinstance(value, float):
        return value if math.isfinite(value) else str(value)
    if isinstance(value, str):
        return value if len(value) <= MAX_TEXT else value[:MAX_TEXT] + "…"
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime | date | time):
        return value.isoformat()
    if isinstance(value, timedelta | UUID):
        return str(value)
    if isinstance(value, bytes | bytearray | memoryview):
        raw = bytes(value)
        return "\\x" + raw[:MAX_BYTES].hex() + ("…" if len(raw) > MAX_BYTES else "")
    if depth >= MAX_DEPTH:
        return str(value)[:MAX_TEXT]
    if isinstance(value, dict):
        return {str(key): cell(item, depth + 1) for key, item in list(value.items())[:MAX_ITEMS]}
    if isinstance(value, list | tuple):
        return [cell(item, depth + 1) for item in value[:MAX_ITEMS]]
    return cell(str(value), depth)
