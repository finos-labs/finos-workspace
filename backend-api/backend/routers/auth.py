"""Authentication routes: the admin panel's sessions, and the account itself"""

from datetime import timedelta
from typing import Annotated

import pyotp
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api import auth_helpers, base, helpers, models, schemas
from api.database import aget_write_db
from api.models import User
from api.rate_limit import LIMIT_DEFAULT, LIMIT_FEW, exempt_service_token, limiter
from routers import app_helpers
from routers.app.index import finish_sign_in, two_factor_required
from utilities.config import settings

router = APIRouter(tags=["auth"])

EXCEPTION_401 = HTTPException(
    status.HTTP_401_UNAUTHORIZED,
    detail="Incorrect username or password",
    headers={"WWW-Authenticate": "Bearer"},
)

# The web app's sign-in that each kind of pending two-factor enrollment finishes
ENROLLED_SIGN_INS = {
    enrollment: sign_in for sign_in, enrollment in auth_helpers.TOTP_ENROLL_SOURCES.items()
}


@router.post("/login", response_model=schemas.AdminSession)
@limiter.limit("5/minute")
async def login(
    request: Request,
    response: Response,
    user: schemas.UserLogin,
    db: AsyncSession = Depends(aget_write_db),
):
    """Signs a superuser in to the admin panel: the session is the `__Host-ws_admin`
    cookie. Two-factor authentication is that of the web app (POST /app/login): the
    authenticator's code when the user has one, and when the organization requires one
    the user has not set up, a 202 with no session (the user sets it up in the web app)."""
    auth_helpers.check_browser_sign_in(request, auth_helpers.ADMIN_CLIENT)
    db_user = (await db.execute(helpers.get_app_user_query(user.email))).first()

    if not db_user or not base.verify_password(user.password, db_user.password):
        raise EXCEPTION_401

    if not db_user.confirmed:
        return JSONResponse(
            content={"message": "User is not confirmed"}, status_code=403
        )

    if not db_user.is_superuser:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Only superusers can sign in to the admin panel",
        )

    if (
        db_user.totp_secret
        and db_user.totp_active
        and not await helpers.verify_totp(
            db, db_user.uuid, db_user.totp_secret, user.totp_token
        )
    ):
        return JSONResponse(content={"message": "Invalid TOTP token"}, status_code=202)

    if db_user.require_authenticator and not db_user.totp_active:
        return two_factor_required()

    lifetime = timedelta(days=30 if user.remember else 7)
    token = await auth_helpers.create_login_token(
        db, db_user.uuid, lifetime, source=auth_helpers.ADMIN_SOURCE
    )
    auth_helpers.set_session_cookie(response, auth_helpers.ADMIN_COOKIE, token, lifetime)
    # Enter the login into our database
    helpers.handle_add_login(db_user.uuid, auth_helpers.ADMIN_SOURCE)
    return schemas.AdminSession(email=db_user.email, is_superuser=True)


@router.get("/session", response_model=schemas.AdminSession)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def get_session(request: Request):
    """Who is signed in to the admin panel, from its session cookie; 401 for nobody."""
    if request.headers.get(auth_helpers.CLIENT_HEADER) != auth_helpers.ADMIN_CLIENT:
        raise auth_helpers.credentials_exception
    user = await auth_helpers.GetCurrentUser(["email", "is_superuser"])(request)
    return schemas.AdminSession(email=user.email, is_superuser=bool(user.is_superuser))


@router.post("/logout", response_model=schemas.SuccessReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(aget_write_db),
):
    """Ends the session of the request: the admin panel's cookie, or the bearer of a
    client that is not a browser. A browser's cookie is cleared even when its session had
    already ended."""
    credential = auth_helpers.read_credential(request)
    session_uuid = (
        await db.execute(
            select(models.Session.uuid)
            .join(models.User, models.User.uuid == models.Session.user_uuid)
            .where(*auth_helpers.session_filters(credential))
        )
    ).scalar_one_or_none()
    if session_uuid is not None:
        await auth_helpers.end_session(db, session_uuid)
    elif credential.kind == "bearer":
        raise auth_helpers.credentials_exception
    if credential.kind != "bearer":
        auth_helpers.clear_session_cookie(
            response, auth_helpers.CLIENT_COOKIES[credential.kind]
        )
    return schemas.SuccessReturn.success_instance()


@router.put("/user", response_model=schemas.SuccessReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def put_user(
    request: Request,
    user_update: schemas.UserUpdate,
    db: AsyncSession = Depends(aget_write_db),
    user=Depends(auth_helpers.GetCurrentUser(["uuid", "password"])),
):
    update_data = user_update.model_dump()
    if len(str(update_data)) > settings.MAX_DICT_LEN:
        raise HTTPException(400, detail="Dictionary exceeds maximum length")
    try:
        new_dict = user_update.validated_dict(user.password)
    except ValueError as e:
        raise HTTPException(401, detail="Invalid password") from e

    query = update(User).where(User.uuid == user.uuid).values(**new_dict)
    await db.execute(query)
    await db.commit()
    if user_update.old_password and user_update.new_password:
        # A new password ends every other session of the user
        query = delete(models.Session).where(
            models.Session.uuid != user.session_uuid,
            models.Session.user_uuid == user.uuid,
        )
        await db.execute(query)
        await db.commit()
    return {"success": True}


@router.delete("/user", response_model=schemas.MessageReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def delete_user(
    request: Request,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user: User = Depends(auth_helpers.GetCurrentUser(["uuid"])),
):
    result = await app_helpers.delete_user(db, user.uuid)
    await auth_helpers.revoke_agent_tokens(user.session_uuid)
    response = JSONResponse(content={"success": result}, status_code=200)
    if cookie := auth_helpers.CLIENT_COOKIES.get(
        request.headers.get(auth_helpers.CLIENT_HEADER, "")
    ):
        auth_helpers.clear_session_cookie(response, cookie)
    return response


@router.post("/totp", response_model=schemas.TotpGenerateReturn)
@limiter.limit(LIMIT_FEW, exempt_when=exempt_service_token)
async def generate_totp(
    request: Request,
    user: User = Depends(
        auth_helpers.GetCurrentUser(
            ["uuid", "email", "totp_secret", "totp_active"], enrollment=True
        )
    ),
    db: AsyncSession = Depends(aget_write_db),
):
    if user.totp_secret and user.totp_active:
        raise HTTPException(400, detail="TOTP already enabled")
    totp = pyotp.TOTP(pyotp.random_base32())
    # Stored encrypted (api/crypto.py); the codes of a new secret start a new replay record
    query = (
        update(User)
        .where(User.uuid == user.uuid)
        .values(totp_secret=totp.secret, totp_last_step=None)
    )
    await db.execute(query)
    await db.commit()
    uri = totp.provisioning_uri(name=user.email, issuer_name="Workspace")
    return schemas.TotpGenerateReturn(uri=uri, secret=totp.secret)


@router.post(
    "/totp/activate",
    response_model=schemas.AppTokenWithContext | schemas.SuccessReturn,
)
@limiter.limit(LIMIT_FEW, exempt_when=exempt_service_token)
async def confirm_totp(
    request: Request,
    response: Response,
    totp_submit: schemas.TotpActivate,
    user: User = Depends(
        auth_helpers.GetCurrentUser(
            ["uuid", "email", "totp_secret", "totp_active"], enrollment=True
        )
    ),
    db: AsyncSession = Depends(aget_write_db),
):
    """Activates the user's authenticator with a code of it. A pending enrollment (the
    `__Host-ws_totp` cookie) then finishes the sign-in it interrupted: its session ends,
    and the web app's session starts and is answered as POST /app/login answers."""
    if not user.totp_secret:
        raise HTTPException(400, detail="TOTP secret has not been generated")

    if not await helpers.verify_totp(
        db, user.uuid, user.totp_secret, totp_submit.totp_token
    ):
        raise HTTPException(401, detail="Invalid TOTP token")

    query = update(User).where(User.uuid == user.uuid).values(totp_active=True)
    await db.execute(query)
    await db.commit()
    if (source := ENROLLED_SIGN_INS.get(user.session_source)) is None:
        return schemas.SuccessReturn.success_instance()

    await auth_helpers.end_session(db, user.session_uuid)
    db_user = schemas.AppUserSchema.model_validate(
        (await db.execute(helpers.get_app_user_query(user.email))).first()
    )
    return await finish_sign_in(
        request,
        response,
        db,
        db_user,
        await app_helpers.get_user_access(db, user.uuid),
        source=source,
        remember=totp_submit.remember,
        version=totp_submit.version,
    )
