from typing import Annotated

import pyotp
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from api import auth_helpers, helpers, models, schemas
from api.database import aget_write_db
from api.models import User
from api.rate_limit import LIMIT_DEFAULT, LIMIT_FEW, exempt_service_token, limiter
from routers import app_helpers
from routers.app.index import finish_sign_in
from utilities.config import settings

router = APIRouter(tags=["auth"])

ENROLLED_SIGN_INS = {
    enrollment: sign_in for sign_in, enrollment in auth_helpers.TOTP_ENROLL_SOURCES.items()
}


@router.put(
    "/user",
    response_model=schemas.SuccessReturn,
    summary="Change the signed-in user's password",
    description=(
        "Changes the password of the signed-in user when the request carries both `old_password` and `new_password`, "
        "and ends every other session of the user. Answers 401 when the old password is wrong and 400 when the request "
        "is too large."
    ),
)
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
        query = delete(models.Session).where(
            models.Session.uuid != user.session_uuid,
            models.Session.user_uuid == user.uuid,
        )
        await db.execute(query)
        await db.commit()
    return {"success": True}


@router.delete(
    "/user",
    response_model=schemas.MessageReturn,
    summary="Delete the signed-in user's account",
    description=(
        "Deletes the account of the signed-in user: every session ends, the account is marked as deleted, and its "
        "email, username and password are overwritten. The user's agent tokens are revoked and the session cookie is "
        "cleared."
    ),
)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def delete_user(
    request: Request,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user: User = Depends(auth_helpers.GetCurrentUser(["uuid"])),
):
    result = await app_helpers.delete_user(db, user.uuid)
    await auth_helpers.revoke_agent_tokens(user.session_uuid)
    response = JSONResponse(content={"success": result}, status_code=200)
    auth_helpers.clear_session_cookie(response, auth_helpers.SESSION_COOKIE)
    return response


@router.post(
    "/totp",
    response_model=schemas.TotpGenerateReturn,
    summary="Start the setup of two-factor authentication",
    description=(
        "Generates a new authenticator secret for the signed-in user and returns it with the provisioning URI that an "
        "authenticator app reads. The secret has no effect until `POST /totp/activate` confirms it. Answers 400 when "
        "two-factor authentication is already active."
    ),
)
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
    summary="Activate two-factor authentication",
    description=(
        "Checks the code from the authenticator app against the generated secret and activates two-factor "
        "authentication. When the user signed in only to enroll, as a user whose organization requires two-factor "
        "authentication must, the enrollment session ends and the answer is the user's app token with a new session. "
        "Otherwise the answer is a success message. Answers 400 when no secret has been generated and 401 when the code "
        "is wrong."
    ),
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
