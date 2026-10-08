from uuid import UUID

from fastapi import HTTPException
from loguru import logger
from sqlalchemy import insert, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api import base, schemas
from api.models import User, UserInvite
from utilities.config import settings


async def brand_new_account(
    db: AsyncSession,
    user: schemas.UserCreateAdmin | schemas.UserCreateAppAdmin,
    information: schemas.RegisterAppUser,
    from_oauth: bool = False,
) -> None | UUID:
    data = {
        "first_name": user.first_name,
        "last_name": user.last_name,
        "password": base.random_password(),
    }
    select_query = select(UserInvite.uuid).where(
        UserInvite.email == user.email, UserInvite.used.is_(False)
    )
    if (invite_uuid := (await db.execute(select_query)).scalar()) is not None:
        if not from_oauth:
            raise HTTPException(409, detail="This user has already been invited")
        return invite_uuid

    insert_query = insert(UserInvite).values(
        inviting_user_uuid=information.inviting_uuid,
        data=data,
        email=user.email,
        permissions_uuid=user.permissions_uuid,
    )
    try:
        response = await db.execute(insert_query)
        if from_oauth:
            await db.commit()
            return response.inserted_primary_key[0]

    except IntegrityError as e:
        logger.error(f"Error inserting invite:\n{e}")
        await db.rollback()
        raise HTTPException(500, detail="Error inserting invite")
    return None


async def register_app_user(
    db: AsyncSession,
    user: schemas.UserCreateAdmin | schemas.UserCreateAppAdmin,
    information: schemas.RegisterAppUser,
    from_oauth: bool = False,
) -> bool | UUID | None:
    if settings.DISABLE_REGISTRATION:
        raise HTTPException(status_code=403, detail="Registration is disabled")

    query = select(User.uuid).where(User.email == user.email)
    if (await db.execute(query)).first():
        raise HTTPException(409, detail="A user with this email already exists")

    # First check if an active invite exists
    new_invite_uuid = await brand_new_account(db, user, information, from_oauth)
    await db.commit()

    return new_invite_uuid if from_oauth else True
