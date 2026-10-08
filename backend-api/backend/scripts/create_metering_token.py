"""Print the token that the service serving the Copilot uses to report usage.

Usage is written to ``PUT /app/usage`` with this token in the ``X-Metering-Authorization``
header, next to the user's own session token. Users cannot create it, because it is signed
with ``JWT_SECRET``, so they cannot change the usage their limits are checked against.

    python -m scripts.create_metering_token
"""

import jwt

from api.auth_helpers import ALGORITHM, METERING_SUBJECT
from utilities.config import settings


def main() -> None:
    print(  # noqa: T201
        jwt.encode({"sub": METERING_SUBJECT}, settings.JWT_SECRET, algorithm=ALGORITHM)
    )


if __name__ == "__main__":
    main()
