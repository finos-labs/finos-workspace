import argparse
import sys
from datetime import UTC, datetime, timedelta

import jwt

from api.auth_helpers import ALGORITHM, METERING_SUBJECT
from utilities.config import settings

DEFAULT_DAYS = 365


def create_metering_token(days: int = DEFAULT_DAYS, now: datetime | None = None) -> tuple[str, datetime]:
    issued = now or datetime.now(UTC)
    expires = issued + timedelta(days=days)
    token = jwt.encode(
        {"sub": METERING_SUBJECT, "iat": issued, "exp": expires},
        settings.JWT_SECRET,
        algorithm=ALGORITHM,
    )
    return token, expires


def main() -> None:
    parser = argparse.ArgumentParser(description=(
            "Print the token that the service serving the Copilot uses to report usage.\n"
            "\n"
            "Usage is written to ``PUT /app/usage`` with this token in the "
            "``X-Metering-Authorization``\n"
            "header, next to the user's own session token. Users cannot create it, because it is "
            "signed\n"
            "with ``JWT_SECRET``, so they cannot change the usage their limits are checked against.\n"
            "\n"
            "The token runs out, and the API refuses one that does not "
            "(``api.auth_helpers.check_metering``):\n"
            "it is pasted into the configuration of another service, so a token that never ran out "
            "could only\n"
            "be withdrawn by changing ``JWT_SECRET``, which signs out every user at the same time. "
            "Mint a new\n"
            "one before this one expires and set ``INES_METERING_TOKEN`` to it; an expired token is "
            "answered\n"
            "with a 403 that says so.\n"
            "\n"
            "    python -m scripts.create_metering_token\n"
            "    python -m scripts.create_metering_token --days 30\n"
        ), formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--days",
        type=int,
        default=DEFAULT_DAYS,
        help=f"how long the token is accepted for, in days (default {DEFAULT_DAYS})",
    )
    args = parser.parse_args()
    if args.days < 1:
        parser.error("--days must be at least 1")

    token, expires = create_metering_token(args.days)
    print(token)  # noqa: T201
    print(f"Expires {expires:%Y-%m-%d %H:%M} UTC — mint a new one before then.", file=sys.stderr)  # noqa: T201


if __name__ == "__main__":
    main()
