import gzip
import json
import logging

import sqlalchemy as sa
import sqlalchemy_utils

from alembic import op  # type: ignore
from api.schemas import strip_endpoint_credentials

revision = "7002053173be"
down_revision = "ff59d563599c"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")

UUID_TYPE = sqlalchemy_utils.types.uuid.UUIDType()
CONTENT_TABLES = ("dashboard_item", "dashboard_save", "user_app")
BATCH_SIZE = 200


def upgrade():
    op.execute(sa.table("session").delete())
    with op.batch_alter_table("session", schema=None) as batch_op:
        batch_op.add_column(sa.Column("token_hash", sa.String(length=64), nullable=False))
        batch_op.create_index(
            batch_op.f("ix_session_token_hash"), ["token_hash"], unique=True
        )

    for table_name in CONTENT_TABLES:
        _strip_saved_credentials(table_name)


def _strip_saved_credentials(table_name: str) -> None:
    table = sa.table(
        table_name, sa.column("uuid", UUID_TYPE), sa.column("content", sa.LargeBinary)
    )
    bind = op.get_bind()
    uuids = bind.execute(
        sa.select(table.c.uuid).where(table.c.content.is_not(None))
    ).scalars().all()
    stripped = 0
    for start in range(0, len(uuids), BATCH_SIZE):
        rows = bind.execute(
            sa.select(table.c.uuid, table.c.content).where(
                table.c.uuid.in_(uuids[start : start + BATCH_SIZE])
            )
        ).all()
        for row in rows:
            try:
                content = json.loads(gzip.decompress(row.content).decode("utf-8"))
            except (OSError, EOFError, ValueError):
                continue
            cleaned = strip_endpoint_credentials(content)
            if cleaned != content:
                bind.execute(
                    table.update()
                    .where(table.c.uuid == row.uuid)
                    .values(content=gzip.compress(json.dumps(cleaned).encode("utf-8")))
                )
                stripped += 1
    log.info("%s: data backend credentials removed from %d rows", table_name, stripped)


def downgrade():
    op.execute(sa.table("session").delete())
    with op.batch_alter_table("session", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_session_token_hash"))
        batch_op.drop_column("token_hash")
