import sys
import traceback
from collections.abc import Iterable
from logging.config import fileConfig
from uuid import uuid4

from sqlalchemy import engine_from_config, pool

import api.models  # noqa: F401, PLC0415
from alembic import context  # type: ignore
from api.models.model_helpers import Base
from utilities.config import settings
from utilities.migration_lock import DONE, DONE_EXPIRY, LOCK_KEY, wait_for_migration_lock

POD_NODE = uuid4()
config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

database_url = settings.get_write_url()
config.set_main_option("sqlalchemy.url", database_url)


def run_migrations_offline():
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    is_sqlite = settings.DATABASE_TYPE == "sqlite"
    use_redis_lock = not is_sqlite

    if use_redis_lock:
        redis_key = LOCK_KEY
        check = wait_for_migration_lock(settings.redis_cache, POD_NODE.hex)

        if check == DONE:
            print("Migrations already applied, skipping...")  # noqa: T201
            return

    kwargs = {}
    if ssl_config := settings.get_ssl_config():
        kwargs["connect_args"] = {"ssl": ssl_config}

    connectable = engine_from_config(
        config.get_section(config.config_ini_section),
        prefix="sqlalchemy.",
        poolclass=pool.StaticPool if is_sqlite else pool.NullPool,
        **kwargs,
    )

    with connectable.connect() as connection:
        if is_sqlite:
            connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
            connection.commit()

        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
            process_revision_directives=get_revision_directives_func(),
            user_module_prefix="model_helpers.",
        )

        with context.begin_transaction():
            context.run_migrations()

    if use_redis_lock:
        settings.redis_cache(redis_key, DONE, update=True, expire=DONE_EXPIRY)


def get_revision_directives_func():
    from alembic.environment import MigrationContext  # noqa: PLC0415
    from alembic.operations import MigrationScript, ops  # noqa: PLC0415

    def process_revision_directives(
        context: MigrationContext,
        revision: str | Iterable[str | None] | Iterable[str],
        directives: list[MigrationScript],
    ):
        script = directives[0]
        if config.cmd_opts and getattr(config.cmd_opts, "autogenerate", False):
            if script.upgrade_ops and script.upgrade_ops.is_empty():
                directives[:] = []
            return

        for d in (script.upgrade_ops, script.downgrade_ops):
            tables_dropped = set()
            for op in d.ops:
                if isinstance(op, ops.DropTableOp):
                    tables_dropped.add((op.table_name, op.schema))

            d.ops = list(_filter_drop_indexes(d.ops, tables_dropped))

    def _filter_drop_indexes(directives: list[ops.MigrateOperation], tables_dropped: set[tuple[str, str]]):
        for d in directives:
            if isinstance(d, ops.ModifyTableOps) and (d.table_name, d.schema) in tables_dropped:
                d.ops = list(_filter_drop_indexes(d.ops, tables_dropped))

                if not d.ops:
                    continue
            elif isinstance(d, ops.DropIndexOp) and (d.table_name, d.schema) in tables_dropped:
                continue

            yield d

    return process_revision_directives


try:
    if context.is_offline_mode():
        run_migrations_offline()
    else:
        run_migrations_online()
except (KeyboardInterrupt, Exception) as exc:
    if isinstance(exc, KeyboardInterrupt):
        print("\nMigration interrupted, releasing lock...\n\n")  # noqa: T201
    else:
        traceback.print_exc()
        print("\n🚨🚨🚨 Migration failed, releasing lock...\n\n")  # noqa: T201

    sys.exit(1)
