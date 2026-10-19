"""For helpers that dont import from modules in this repo"""

import enum
import re
import secrets
import string
from datetime import UTC, datetime, timedelta  # type: ignore

import bcrypt


def verify_password(plain_password: str, hashed_password: str | bytes) -> bool:
    """Verifies that the given password matches the given hash

    Parameters
    ----------
    plain_password : str
        The password to be checked
    hashed_password : str | bytes
        The hash to be checked against. PasswordType returns str on MySQL and
        bytes on SQLite/Postgres, so accept either.
    """
    if isinstance(hashed_password, str):
        hashed_password = hashed_password.encode("utf-8")
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password)


def get_password_hash(password: str) -> bytes:
    """Hashes the given password

    Parameters
    ----------
    password : str
        The unhashed password
    """
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt())


def get_midnight() -> datetime:
    return datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)


def get_now() -> datetime:
    return datetime.now(UTC)


def time_ms_now(ts: int | None, default: datetime | None = get_now()) -> datetime:
    """Returns the current timestamp if ts is None, otherwise returns the given timestamp"""
    if isinstance(ts, datetime):
        return ts
    if not ts:
        return default
    return datetime.fromtimestamp(ts / 1000, UTC)


def get_result_ttl(delta: timedelta | float) -> int:
    if isinstance(delta, int | float):
        delta = timedelta(seconds=delta)

    current = datetime.now(UTC).replace(second=0, microsecond=0)
    diff = current + delta
    return int(max(0, (diff - current).total_seconds()))


def random_string(n: int = 8) -> str:
    options = string.digits + string.ascii_lowercase + string.ascii_uppercase
    return "".join(secrets.choice(options) for _ in range(n))


def random_password() -> str:
    """16 random characters with an upper-case letter, a lower-case letter, a digit and
    a special character, as the password rules require."""
    specials = "!#$%&*+-/<=>?@^"
    required = [
        secrets.choice(string.ascii_uppercase),
        secrets.choice(string.ascii_lowercase),
        secrets.choice(string.digits),
        secrets.choice(specials),
    ]
    alphabet = string.ascii_letters + string.digits + specials
    characters = required + [secrets.choice(alphabet) for _ in range(12)]
    secrets.SystemRandom().shuffle(characters)
    return "".join(characters)


def get_systems() -> list[str]:
    os_list = ["darwin", "windows"]  # "linux",
    arch_list = ["x86_64", "aarch64"]  # , "i686", "armv7"
    systems = [f"{x}-{y}" for x in os_list for y in arch_list]
    return systems


def check_email(email: str) -> bool:
    """Checks whether the given username meets requirements

    Parameters
    ----------
    email : str
        The email to be checked

    Returns
    ----------
    valid : bool
        Whether the email is valid
    """
    # The below is a RFC 5322 compliant regex: https://uibakery.io/regex-library/email-regex-python
    pattern = "(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|\"(?:[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x21\\x23-\\x5b\\x5d-\\x7f]|\\\\[\\x01-\\x09\\x0b\\x0c\\x0e-\\x7f])*\")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x21-\\x5a\\x53-\\x7f]|\\\\[\\x01-\\x09\\x0b\\x0c\\x0e-\\x7f])+)\\])"  # noqa: E501
    return bool(re.match(pattern, email.lower()))


class PermissionEnum(enum.Enum):
    view = "view"
    comment = "comment"
    edit = "edit"


class ChatMessageRole(enum.Enum):
    ai = "ai"
    human = "human"
    summary = "summary"
    system = "system"
    tool = "tool"


def clean_email(email: str) -> str:
    if email.count("@") != 1:
        raise ValueError("The email should only have one '@'")
    first, second = email.split("@")
    first_no_periods = first.replace(".", "")
    first_clean = first_no_periods.split("+")[0]
    return first_clean + "@" + second
