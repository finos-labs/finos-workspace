import json
import logging
import re
import sys
import traceback
from os import environ
from typing import TYPE_CHECKING

from loguru import logger

if TYPE_CHECKING:
    from .config import Settings


LOGURU_FORMAT = (
    "<light-yellow>{time:YYYY-MM-DD HH:mm:ss.SSS}</light-yellow>|"
    "<light-magenta><level>{level}</level></light-magenta>|"
    "<light-red>{name}</light-red>|<green>{function}</green>|<cyan>{line}</cyan> "
    "- <light-magenta><level>{message}</level></light-magenta>"
)


MASK = "********"

# Names whose values never reach a log: credential headers, any key that holds a token,
# secret, password or key, and the signatures of pre-signed URLs (Signature,
# X-Amz-Signature, sig). The lookahead finds the word inside a name; the name
# itself is then taken whole and possessively, so a failed match never backtracks
# through it (every pattern here runs in time linear in the message). "KeyError: 'x'"
# names a missing key, not a credential.
_MASKED_NAME = (
    r"(?!KeyError\b)"
    r"(?=sig(?![\w-])"
    r"|[\w-]*?(?:authorization|cookie|token|secret|password|key|signature))[\w-]++"
)
# A quoted value up to its closing quote, or to the end of the line when it has none
_QUOTED_VALUE = r"""'(?:\\.|[^'\\\n])*+'?|"(?:\\.|[^"\\\n])*+"?"""

# 'name': 'value', "name": "value" and 'name': 123, as in dict reprs and JSON
_QUOTED_PAIR = re.compile(
    rf"""(?P<q>['"])(?P<name>{_MASKED_NAME})(?P=q)(?P<sep>\s*+:\s*+)"""
    rf"""(?P<value>{_QUOTED_VALUE}|(?!['"\[{{(])[^,}}\]\s]++)""",
    re.IGNORECASE,
)
# name: value and name=value: header lines, query strings, form bodies, f-strings
_BARE_PAIR = re.compile(
    rf"""(?<![\w-])(?P<name>{_MASKED_NAME})(?P<sep>\s*+[:=]\s*+)"""
    rf"""(?P<value>{_QUOTED_VALUE}|(?!['"\[{{(*])[^\s,;&'"}}\])]++)""",
    re.IGNORECASE,
)
# The credential of an Authorization value, wherever it appears
_AUTH_SCHEME = re.compile(
    r"\b(?P<scheme>Bearer|Basic|Digest)\s++[A-Za-z0-9\-._~+/]++=*", re.IGNORECASE
)
# Workspace tokens by their prefixes, and the session cookies by their names
_WORKSPACE_TOKEN = re.compile(r"\bws_mcp_[A-Za-z0-9_-]++")
_SESSION_COOKIE = re.compile(r"(?P<name>__Host-ws_\w++)=[^;\s'\",]++")


def _mask_value(match: re.Match) -> str:
    value = match["value"]
    quote = value[0] if value[0] in "'\"" else ""
    closing = quote if quote and len(value) > 1 and value[-1] == quote else ""
    return match.group(0)[: match.start("value") - match.start()] + quote + MASK + closing


def redact(message: str) -> str:
    """The message with every credential it carries masked."""
    message = _AUTH_SCHEME.sub(rf"\g<scheme> {MASK}", message)
    message = _WORKSPACE_TOKEN.sub(MASK, message)
    message = _SESSION_COOKIE.sub(rf"\g<name>={MASK}", message)
    message = _QUOTED_PAIR.sub(_mask_value, message)
    return _BARE_PAIR.sub(_mask_value, message)


def get_secrets() -> dict[str, str]:
    from .config import settings  # noqa: F401, PLC0415

    base_dict = settings.model_dump()
    for key in [
        "UNUSABLE_JSON_CHARACTERS",
        "MAX_DICT_LEN",
        "FRONTENDURL",
        "MODE",
        "DB_PORT",
        "REDIS_PORT",
        "WORKERS",
        "LOGURU_COLORIZE",
        "JSON_LOGS",
        "LOG_LEVEL",
        "REDIS_DB_BOT",
        "REDIS_DB_APP",
        "REDIS_SSL_CERT_REQ",
    ]:
        if key in base_dict:
            del base_dict[key]
    secrets = {}
    for key, value in base_dict.items():
        new_value = str(value)
        if new_value and len(new_value) > 5:  # noqa: PLR2004
            secrets[str(key)] = new_value
    return secrets


def obfuscate_secrets(message: str) -> str:
    for key, value in get_secrets().items():
        message = message.replace(value, key)
    return redact(message)


class InterceptHandler(logging.Handler):
    def emit(self, record):  # noqa: PLR6301
        # Get corresponding Loguru level if it exists
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno

        # Find caller from where originated the logged message
        frame, depth = logging.currentframe(), 2
        while frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back
            depth += 1

        logger.opt(depth=depth, exception=record.exc_info).log(
            level, record.getMessage()
        )


class stdoutSink:
    def write(self, message):  # noqa: PLR6301
        sys.__stdout__.write(obfuscate_secrets(message))

    def flush(self):  # noqa: PLR6301
        sys.__stdout__.flush()

    def isatty(self):  # noqa: PLR6301
        return sys.__stdout__.isatty()


if not environ.get("PYTEST_IS_RUNNING"):
    sys.stdout = stdoutSink()  # type: ignore


def serialize(record: dict) -> str:
    if any(
        record["function"] == skip_func
        for skip_func in ["<module>", "callHandlers", "pre_fork"]
    ):
        return None

    # Redacted before JSON encoding: once quotes are escaped the patterns no longer see
    # the names
    subset = {
        "asctime": record["time"].strftime("%Y-%m-%d %H:%M:%S.%f"),
        "levelname": record["level"].name,
        "name": record["name"],
        "message": obfuscate_secrets(record["message"]),
        "function": record["function"],
        "line": record["line"],
    }

    if exception := record.get("exception"):
        subset["exc_info"] = {
            "type": None if exception.type is None else exception.type.__name__,
            "value": obfuscate_secrets(str(exception.value)),
            "traceback": traceback.format_tb(exception.traceback),
        }

    if extras := record.get("extra"):
        subset.update(extras)

    if extras and "exclude" in extras:
        return None

    return json.dumps(subset)


def jsonsink(message):
    if serialized := serialize(message.record):
        print(obfuscate_secrets(serialized))  # noqa


def setup_logging(settings: "Settings") -> None:

    sys.tracebacklimit = 3

    HANDLERS = [
        {
            "sink": sys.stdout,
            "serialize": settings.JSON_LOGS,
            "colorize": settings.LOGURU_COLORIZE,
            "format": LOGURU_FORMAT,
            "level": settings.LOG_LEVEL,
            # diagnose would print the values of local variables, credentials included
            "diagnose": False,
            "backtrace": False,
        }
    ]

    intercept_handler = InterceptHandler()
    logging.root.setLevel(settings.LOG_LEVEL)

    seen = set()
    for name in [
        *logging.root.manager.loggerDict.keys(),
        "gunicorn.access",
        "gunicorn.error",
        "uvicorn.access",
        "uvicorn.error",
    ]:
        if name not in seen:
            seen.add(name.split(".")[0])
            logging.getLogger(name).handlers = [intercept_handler]
    # The HTTP clients log the full URL of every request at INFO, and a URL can carry a
    # credential: only their warnings and errors are logged
    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)

    logger.configure(handlers=HANDLERS)
    logger.add(jsonsink, diagnose=False, backtrace=False)
