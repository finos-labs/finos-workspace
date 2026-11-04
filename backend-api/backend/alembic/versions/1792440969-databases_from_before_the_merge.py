import sqlalchemy as sa

from alembic import context, op  # type: ignore

revision = "1ded5470241f"
down_revision = "8b5e2d7c1f40"
branch_labels = None
depends_on = None

WEB_SWITCHES = ("search_web", "fetch_from_web")
MARKETPLACE_CLEANUP = "2f6c81b4e7a9"


def upgrade():
    role_columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("role")}
    missing = [switch for switch in WEB_SWITCHES if switch not in role_columns]
    if missing:
        with op.batch_alter_table("role", schema=None) as batch_op:
            for switch in missing:
                batch_op.add_column(
                    sa.Column(switch, sa.Boolean(), server_default=sa.true(), nullable=False)
                )

    context.script.get_revision(MARKETPLACE_CLEANUP).module.upgrade()


def downgrade():
    ...
