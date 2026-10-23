from fastapi import HTTPException, Request
from fastapi.security.utils import get_authorization_scheme_param
from slowapi import Limiter
from slowapi.util import get_remote_address

from api import auth_helpers
from utilities.config import settings

settings.setup_logging()
storage_uri = None if settings.is_test() else settings.get_redis_url()


TRUSTED_PROXIES = "127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7"

limiter = Limiter(key_func=get_remote_address, storage_uri=storage_uri)
LIMIT_DEFAULT = "50/minute"
LIMIT_FEW = "10/minute"


def exempt_service_token(request: Request) -> bool:
    if not settings.RATE_LIMIT_EXEMPT_ENABLED:
        return False

    try:
        service_auth = request.headers.get("X-Workspace-Authorization")
        service_scheme, service_param = get_authorization_scheme_param(service_auth)

        if service_scheme.lower() == "bearer":
            auth_helpers.check_service_token(service_param)
            return True
    except HTTPException:
        return False

    return False
