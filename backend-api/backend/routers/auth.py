"""Authentication routes"""

from datetime import timedelta
from typing import Annotated

import pyotp
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from fastapi_pagination import Page
from fastapi_pagination.ext.sqlalchemy import paginate
from sqlalchemy import delete, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api import auth_helpers, base, crud, helpers, models, schemas
from api.database import aget_read_db, aget_write_db
from api.models import User
from api.rate_limit import LIMIT_DEFAULT, LIMIT_FEW, exempt_user_agent, limiter
from routers import app_helpers
from utilities.config import settings

user_response_fields = [
    "uuid",
    "confirmed",
    "created_date",
    "first_name",
    "last_name",
    "email",
    "username",
    "referral_code",
]

router = APIRouter(tags=["auth"])

EXCEPTION_401 = HTTPException(
    status.HTTP_401_UNAUTHORIZED,
    detail="Incorrect username or password",
    headers={"WWW-Authenticate": "Bearer"},
)


@router.post("/login", response_model=schemas.FullToken)
@limiter.limit("5/minute")
async def login(
    request: Request, user: schemas.UserLogin, db: AsyncSession = Depends(aget_write_db)
):
    query = helpers.get_user_query(user.email)
    db_user = (await db.execute(query)).first()

    if not db_user:
        raise EXCEPTION_401

    if not base.verify_password(user.password, db_user.password):
        raise EXCEPTION_401

    if not db_user.confirmed:
        return JSONResponse(
            content={"message": "User is not confirmed"}, status_code=403
        )

    if db_user.totp_secret and db_user.totp_active:
        valid_secret = int(pyotp.TOTP(db_user.totp_secret).now())
        if valid_secret != user.totp_token:
            return JSONResponse(
                content={"message": "Invalid TOTP token"}, status_code=202
            )

    time_d = timedelta(days=30 if user.remember else 7)
    access_token = await auth_helpers.create_login_token(
        db, db_user.uuid, time_d, source=user.source or ""
    )
    # Enter the login into our database
    helpers.handle_add_login(db_user.uuid, user.ip_address, user.source)

    content = {
        "access_token": access_token,
        "token_type": "bearer",
        "uuid": str(db_user.uuid),
        "email": db_user.email,
        "username": db_user.username,
        "has_app": bool(db_user.permissions_uuid),
    }
    return JSONResponse(content=content, status_code=200)


@router.get("/logout")
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_user_agent)
async def logout(
    request: Request,
    db: AsyncSession = Depends(aget_write_db),
    token: str = Depends(auth_helpers.get_current_token),
):
    query = delete(models.Session).where(models.Session.uuid == token)
    await db.execute(query)
    await db.commit()
    return JSONResponse(content={"success": True}, status_code=200)


@router.get("/user", response_model=schemas.UserReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_user_agent)
def get_user(
    request: Request,
    user=Depends(auth_helpers.GetCurrentUser(user_response_fields)),
):
    return user


@router.put("/user", response_model=schemas.SuccessReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_user_agent)
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

    try:
        query = update(User).where(User.uuid == user.uuid).values(**new_dict)
        await db.execute(query)
        await db.commit()
    except IntegrityError as exc:
        return helpers.handle_user_conflict(exc)
    if user_update.old_password and user_update.new_password:
        query = delete(models.Session).where(
            models.Session.uuid != user.token, models.Session.user_uuid == user.uuid
        )
        await db.execute(query)
        await db.commit()
    return {"success": True}


@router.get("/logout-everywhere", response_model=schemas.MessageReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_user_agent)
async def logout_everywhere(
    request: Request,
    db: AsyncSession = Depends(aget_write_db),
    user=Depends(auth_helpers.GetCurrentUser(["uuid"])),
):
    query = delete(models.Session).where(models.Session.user_uuid == user.uuid)
    await db.execute(query)
    await db.commit()
    return JSONResponse(content={"success": True}, status_code=200)


@router.delete("/user", response_model=schemas.MessageReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_user_agent)
async def delete_user(
    request: Request,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    user: User = Depends(auth_helpers.GetCurrentUser(["uuid"])),
):
    result = await app_helpers.delete_user(db, user.uuid)
    return JSONResponse(content={"success": result}, status_code=200)


@router.post("/login-github-google", response_model=schemas.FullToken)
@limiter.limit("5/minute")
async def login_external(  # noqa: PLR0915
    request: Request,
    user: schemas.ExternalUserLogin,
    db: AsyncSession = Depends(aget_write_db),
):
    status_code = 200
    db_user = (await db.execute(helpers.get_user_query(user.email))).first()
    time_d = 30 if user.remember else 7
    if not db_user:
        status_code = 201
        rand_password = base.random_string(165)
        if await crud.check_new_user(db, user.email):
            raise HTTPException(409, detail="A user with this email already exists")
        query_i = insert(User).values(
            email=user.email,
            clean_email=base.clean_email(user.email),
            source=user.source,
            confirmed=True,
            password=rand_password,
        )
        response = await db.execute(query_i)
        user_uuid = response.inserted_primary_key[0]  # type: ignore
        await db.commit()
        has_app = False

    else:
        if not db_user.confirmed:
            update_query = (
                update(User).where(User.email == user.email).values(confirmed=True)
            )
            await db.execute(update_query)
            await db.commit()
        user_uuid = db_user.uuid
        has_app = db_user.permissions_uuid
        # For right now we are NOT checking ouath for 2FA
        if db_user.totp_secret and False:  # noqa: SIM223
            valid_secret = int(pyotp.TOTP(db_user.totp_secret).now())
            if valid_secret != user.totp_token:
                return JSONResponse(
                    content={"message": "Invalid TOTP token"}, status_code=202
                )

    delta = timedelta(days=time_d)
    access_token = await auth_helpers.create_login_token(
        db, user_uuid, delta, source=user.source or ""
    )
    # Enter the login into our database
    helpers.handle_add_login(user_uuid, user.ip_address, user.source)

    response_data = {
        "access_token": access_token,
        "token_type": "bearer",
        "uuid": str(user_uuid),
        "email": "" if not db_user else db_user.email,
        "has_app": bool(has_app),
        "username": "" if not db_user else db_user.username,
    }
    return JSONResponse(content=response_data, status_code=status_code)


@router.get("/username-list/{username}", response_model=Page[str])
@limiter.limit(LIMIT_FEW, exempt_when=exempt_user_agent)
async def username_list(
    request: Request,
    username: str,
    _: User = Depends(auth_helpers.GetCurrentUser(["email"])),
    db: AsyncSession = Depends(aget_read_db),
):
    query = select(User.username).where(
        User.username.contains(username), User.deleted.is_(False)
    )
    return await paginate(db, query, unwrap_mode="unwrap")


@router.post("/totp", response_model=schemas.TotpGenerateReturn)
@limiter.limit(LIMIT_FEW, exempt_when=exempt_user_agent)
async def generate_totp(
    request: Request,
    user: User = Depends(
        auth_helpers.GetCurrentUser(["uuid", "email", "totp_secret", "totp_active"])
    ),
    db: AsyncSession = Depends(aget_write_db),
):
    if user.totp_secret and user.totp_active:
        raise HTTPException(400, detail="TOTP already enabled")
    totp = pyotp.TOTP(pyotp.random_base32())
    query = update(User).where(User.uuid == user.uuid).values(totp_secret=totp.secret)
    await db.execute(query)
    await db.commit()
    uri = totp.provisioning_uri(name=user.email, issuer_name="Workspace")
    return schemas.TotpGenerateReturn(uri=uri, secret=totp.secret)


@router.post("/totp/activate", response_model=schemas.SuccessReturn)
@limiter.limit(LIMIT_FEW, exempt_when=exempt_user_agent)
async def confirm_totp(
    request: Request,
    totp_submit: schemas.TotpToken,
    user: User = Depends(
        auth_helpers.GetCurrentUser(["uuid", "totp_secret", "totp_active"])
    ),
    db: AsyncSession = Depends(aget_write_db),
):
    if not user.totp_secret:
        raise HTTPException(400, detail="TOTP secret has not been generated")

    valid_secret = int(pyotp.TOTP(user.totp_secret).now())
    if valid_secret != totp_submit.totp_token:
        raise HTTPException(401, detail="Invalid TOTP token")

    query = update(User).where(User.uuid == user.uuid).values(totp_active=True)
    await db.execute(query)
    await db.commit()
    return {"success": True}


@router.delete("/totp", response_model=schemas.SuccessReturn)
@limiter.limit(LIMIT_FEW, exempt_when=exempt_user_agent)
async def delete_totp(
    request: Request,
    user: User = Depends(auth_helpers.GetCurrentUser(["uuid"])),
    db: AsyncSession = Depends(aget_write_db),
):
    query = (
        update(User)
        .where(User.uuid == user.uuid)
        .values(totp_secret=None, totp_active=False)
    )
    await db.execute(query)
    await db.commit()
    return {"success": True}
