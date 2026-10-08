"""Allow us to configure rate limiting for the API."""

from fastapi import Request
from fastapi.security.utils import get_authorization_scheme_param
from loguru import logger
from slowapi import Limiter
from slowapi.util import get_remote_address

from api import auth_helpers
from utilities.config import settings

settings.setup_logging()
storage_uri = None if settings.is_test() else settings.get_redis_url()


logger.info(f"Initializing rate limiter with storage_uri: {storage_uri}")


def get_remote_address_w_logging(request: Request) -> str:
    """Log rate limit information for debugging."""
    ip = get_remote_address(request)
    x_forwarded_for = request.headers.get("x-forwarded-for", None)
    logger.info(
        f"Rate limit check - IP: {ip}, User-Agent: {request.headers.get('User-Agent')}"
    )
    logger.info(f"Request headers: {dict(request.headers)}")
    return x_forwarded_for or ip


limiter = Limiter(key_func=get_remote_address_w_logging, storage_uri=storage_uri)
LIMIT_DEFAULT = "50/minute"
LIMIT_FEW = "10/minute"


def exempt_user_agent(request: Request) -> bool:
    """Exempt frontend from rate limiting. This is done by providing a custom
    user agent in the header.
    """
    user_agent = request.headers.get("X-Workspace-User-Agent") or request.headers.get(
        "User-Agent"
    )
    frontend = settings.WORKSPACE_FRONTEND_USER_AGENT
    if user_agent is None or not frontend:
        return False
    return frontend in user_agent


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
    except auth_helpers.credentials_exception:
        return False

    return False
