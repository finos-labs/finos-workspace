"""Plugin routes

A superuser installs (approves a released version of) or uninstalls a plugin for the
whole Workspace; an admin enables or disables an installed plugin for their organization;
every signed-in user reads which plugins are installed, at which version, and which of
them their organization enabled. The web app checks the plugin host's releases against
the installed versions before it loads a plugin.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from sqlalchemy import Row, delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api import auth_helpers, base, models, schemas
from api.database import aget_read_db, aget_write_db
from api.models import EntityPlugin, PluginInstallation
from api.rate_limit import LIMIT_DEFAULT, exempt_service_token, limiter
from routers import app_helpers

router = APIRouter(prefix="/plugins", tags=["plugins"])

PluginIdPath = Annotated[
    str, Path(pattern=schemas.PLUGIN_ID_PATTERN, max_length=schemas.PLUGIN_ID_LENGTH)
]
CurrentUser = Annotated[
    Row, Depends(auth_helpers.GetCurrentUser(["uuid"], app_session=True))
]


def installation_return(item: PluginInstallation) -> schemas.PluginInstallationReturn:
    return schemas.PluginInstallationReturn(
        plugin_id=item.plugin_id,
        version=item.version,
        digest=item.digest,
        files=item.release.get("files", {}),
        requests=item.release.get("requests"),
        release_notes=item.release.get("release_notes"),
        source=item.release.get("source"),
        approved_at=item.approved_at,
    )


async def admin_entity_uuid(db: AsyncSession, admin: Row) -> UUID:
    entity_uuid = await app_helpers.get_entity_uuid(db, admin.uuid)
    if entity_uuid is None:
        raise HTTPException(403, detail="You are not in an organization")
    return entity_uuid


async def get_installation(db: AsyncSession, plugin_id: str) -> PluginInstallation | None:
    query = select(PluginInstallation).where(PluginInstallation.plugin_id == plugin_id)
    return (await db.execute(query)).scalar_one_or_none()


@router.get("/installations", response_model=list[schemas.PluginInstallationReturn])
async def get_installations(
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    _: CurrentUser,
):
    """The installed plugins, each at its approved version."""
    query = select(PluginInstallation).order_by(PluginInstallation.plugin_id)
    return [installation_return(item) for item in (await db.execute(query)).scalars()]


@router.put(
    "/installations/{plugin_id}", response_model=schemas.PluginInstallationReturn
)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def put_installation(
    request: Request,
    plugin_id: PluginIdPath,
    release: schemas.PluginInstallationPut,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    superuser: Annotated[models.User | None, Depends(auth_helpers.get_current_superuser)],
):
    """Installs a released version of a plugin, or approves another version of an
    installed one. The organizations that enabled it keep it."""
    snapshot = {
        "files": {path: file.model_dump() for path, file in release.files.items()},
        "requests": release.requests,
        "release_notes": release.release_notes,
        "source": release.source.model_dump() if release.source else None,
    }
    values = dict(
        version=release.version,
        digest=release.digest,
        release=snapshot,
        approved_at=base.get_now(),
        approved_by_uuid=superuser.uuid if superuser else None,
    )
    item = await get_installation(db, plugin_id)
    if item is None:
        item = PluginInstallation(plugin_id=plugin_id, **values)
        db.add(item)
    else:
        for key, value in values.items():
            setattr(item, key, value)
    try:
        await db.commit()
    except IntegrityError as error:
        await db.rollback()
        raise HTTPException(409, detail="The plugin was installed meanwhile") from error
    return installation_return(item)


@router.delete("/installations/{plugin_id}", response_model=schemas.SuccessReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def delete_installation(
    request: Request,
    plugin_id: PluginIdPath,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    _: Annotated[models.User | None, Depends(auth_helpers.get_current_superuser)],
):
    """Uninstalls a plugin: it leaves every organization. Uninstalling a plugin that is
    not installed changes nothing."""
    # The foreign key cascades too; deleting first keeps it independent of the dialect
    await db.execute(delete(EntityPlugin).where(EntityPlugin.plugin_id == plugin_id))
    await db.execute(
        delete(PluginInstallation).where(PluginInstallation.plugin_id == plugin_id)
    )
    await db.commit()
    return schemas.SuccessReturn.success_instance()


@router.get("/entity", response_model=schemas.EntityPluginsReturn)
async def get_entity_plugins(
    db: Annotated[AsyncSession, Depends(aget_read_db)],
    user: CurrentUser,
):
    """The installed plugins enabled for the user's organization."""
    entity_uuid = await app_helpers.get_entity_uuid(db, user.uuid)
    if entity_uuid is None:
        return schemas.EntityPluginsReturn(plugin_ids=[])
    query = (
        select(EntityPlugin.plugin_id)
        .join(PluginInstallation, PluginInstallation.plugin_id == EntityPlugin.plugin_id)
        .where(EntityPlugin.entity_uuid == entity_uuid)
        .order_by(EntityPlugin.plugin_id)
    )
    return schemas.EntityPluginsReturn(
        plugin_ids=list((await db.execute(query)).scalars())
    )


@router.put("/entity/{plugin_id}", response_model=schemas.SuccessReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def put_entity_plugin(
    request: Request,
    plugin_id: PluginIdPath,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    admin: Annotated[Row, Depends(auth_helpers.get_current_admin)],
):
    """Enables an installed plugin for the admin's organization."""
    if await get_installation(db, plugin_id) is None:
        raise HTTPException(
            404,
            detail="The plugin is not installed. A superuser must install it first.",
        )
    entity_uuid = await admin_entity_uuid(db, admin)
    existing = select(EntityPlugin.uuid).where(
        EntityPlugin.entity_uuid == entity_uuid, EntityPlugin.plugin_id == plugin_id
    )
    if (await db.execute(existing)).first() is None:
        db.add(
            EntityPlugin(
                entity_uuid=entity_uuid, plugin_id=plugin_id, enabled_by_uuid=admin.uuid
            )
        )
        try:
            await db.commit()
        except IntegrityError:
            # Enabled meanwhile, or uninstalled meanwhile: what is stored now stands
            await db.rollback()
            if await get_installation(db, plugin_id) is None:
                raise HTTPException(404, detail="The plugin is not installed") from None
    return schemas.SuccessReturn.success_instance()


@router.delete("/entity/{plugin_id}", response_model=schemas.SuccessReturn)
@limiter.limit(LIMIT_DEFAULT, exempt_when=exempt_service_token)
async def delete_entity_plugin(
    request: Request,
    plugin_id: PluginIdPath,
    db: Annotated[AsyncSession, Depends(aget_write_db)],
    admin: Annotated[Row, Depends(auth_helpers.get_current_admin)],
):
    """Disables a plugin for the admin's organization."""
    entity_uuid = await admin_entity_uuid(db, admin)
    await db.execute(
        delete(EntityPlugin).where(
            EntityPlugin.entity_uuid == entity_uuid, EntityPlugin.plugin_id == plugin_id
        )
    )
    await db.commit()
    return schemas.SuccessReturn.success_instance()
