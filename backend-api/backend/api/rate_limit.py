"""Allow us to configure rate limiting for the API."""

from fastapi import HTTPException, Request
from fastapi.security.utils import get_authorization_scheme_param
from slowapi import Limiter
from slowapi.util import get_remote_address

from api import auth_helpers
from utilities.config import settings

settings.setup_logging()
storage_uri = None if settings.is_test() else settings.get_redis_url()


# The peers whose X-Forwarded-For the server believes (gunicorn forwarded_allow_ips in
# run.py): loopback and the private networks, which load balancers, ingresses and
# compose networks connect from and a client on the internet cannot.
TRUSTED_PROXIES = "127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7"

# The key is the client address the server resolved: uvicorn takes it from
# X-Forwarded-For only when the peer is one of TRUSTED_PROXIES, so a client cannot
# choose its own rate-limit bucket by sending that header.
limiter = Limiter(key_func=get_remote_address, storage_uri=storage_uri)
LIMIT_DEFAULT = "50/minute"
LIMIT_FEW = "10/minute"


def exempt_service_token(request: Request) -> bool:
    """Exempt the Copilot service from rate limiting.

    Only exempts requests that:
    1. Have a valid Workspace Authorization token
    2. Reach a deployment with RATE_LIMIT_EXEMPT_ENABLED set (development only)

    Returns
    -------
    bool
        True if the request should be exempt from rate limiting
    """
    if not settings.RATE_LIMIT_EXEMPT_ENABLED:
        return False

    try:
        service_auth = request.headers.get("X-Workspace-Authorization")
        service_scheme, service_param = get_authorization_scheme_param(service_auth)

        if service_scheme.lower() == "bearer":
            auth_helpers.check_origin(service_param)
            return True
    except HTTPException:
        return False

    return False
