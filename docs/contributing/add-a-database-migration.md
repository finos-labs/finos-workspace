---
title: How to add a database migration
sidebar_position: 3
---

# How to add a database migration

The API's tables are declared as SQLAlchemy models, and a migration of the tool Alembic changes an existing database to match them. When you add a table, add a column or change one, you change the model and write a migration, so that every deployment's database follows the model when its API starts. This guide generates the migration, makes it fit the conventions of the repository and tests it. [How to run database migrations](../technical-guide/deploy/run-database-migrations.mdx) describes how the migrations run in a deployment, and [Database tables](../reference/schemas/database.mdx) lists the tables as the models declare them.

All commands run in `backend-api/backend`, with the environment of the API. The local development stack, which [How to run the development stack](run-the-development-stack.md) describes, provides a database, and its `init` step applies the migrations on every start.

## Change the model

The models are in `backend-api/backend/api/models`, grouped by area: `user_models.py`, `entity_models.py`, `workspace_models.py`, `widget_plugin_models.py` and `general_models.py`. A model derives from the `Base` that `api/database.py` defines. Add the table or the column there, with its type and its foreign keys. The page of database tables is generated from these models, so it needs no edit.

## Generate the revision

1. Bring a database to the current head, so that Alembic compares the models with the schema that the last revision leaves:

   ```bash
   python -m alembic upgrade head
   ```

2. Generate the revision from the difference:

   ```bash
   python -m alembic revision --autogenerate -m "add widget plugin data sources"
   ```

   Alembic writes the file `alembic/versions/<number of seconds since 1970>-<words of the message>.py`, gives the revision a new identifier, and sets its `down_revision` to the current head. When the models and the database agree, the repository's `env.py` writes no file.

Two things go wrong at this step.

- **Generate against MySQL or PostgreSQL, not against SQLite.** SQLite reports every UUID column as a number, so autogenerate lists a type change for each UUID column of every table and writes a revision full of noise.
- **The command prints "Could not find entrypoint console_scripts.black" and the word FAILED** when the tool black is missing. `alembic.ini` runs black on each new file as a post-write hook, and the project does not declare it as a dependency. The file is written all the same. Install black in the environment to have it formatted, or format the file yourself.

## Make the revision fit

Read the generated file and change it before you keep it.

- **Keep only your change.** Delete the operations that do not belong to it.
- **Use `op.batch_alter_table` for a change to an existing table**, as the other revisions do. The environment renders changes as batches so that the same revision works on SQLite, which cannot alter a table in place, and on MySQL and PostgreSQL:

  ```python
  def upgrade():
      with op.batch_alter_table("entity_widget_plugin", schema=None) as batch_op:
          batch_op.add_column(sa.Column("data_sources", api.models.model_helpers.JSONType(), nullable=True))


  def downgrade():
      with op.batch_alter_table("entity_widget_plugin", schema=None) as batch_op:
          batch_op.drop_column("data_sources")
  ```

- **Name the types as the models do.** A UUID column is `sqlalchemy_utils.types.uuid.UUIDType()`, a time is `api.models.model_helpers.AwareDateTime()` and a JSON document is `api.models.model_helpers.JSONType()`.
- **Name the indexes and foreign keys as the models do.** The `Base` names an index `ix_<table>_<column>` and a foreign key `fk_<table>_<column>_<referred table>`, so a revision that creates them spells the same names, such as `op.f("fk_share_request_requester_uuid_user")`.
- **Look before you drop what may be gone.** A revision that removes columns inspects the table with `sa.inspect(op.get_bind())` and drops only the columns that are still there, so that it also runs on a database in which a column is already gone.
- **Write the downgrade for an additive change.** The revisions that add a column or a table drop it again in `downgrade`, and a revision that removes columns or tables often leaves `downgrade` empty.

A revision that moves data, such as one that encrypts a column, runs on the data that deployments hold. Write a test for it with the data that it changes, as the files `tests/test_*_migration.py` do.

## Test the chain and the engines

Run the checks of the migrations from `backend-api/backend`:

```bash
pytest tests/test_migration_chain.py tests/test_migration_dialects.py
```

- **`test_migration_chain.py`** checks that every revision names a parent that exists, that no two revisions share a parent and that the chain has exactly one head. The API does not start when there is more than one head. When another branch has added a revision since you started, change your revision's `down_revision` to the new head and run the test again.
- **`test_migration_dialects.py`** runs the whole chain on a fresh database of each of the three engines, MySQL, PostgreSQL and SQLite, and then reads every table. The MySQL and PostgreSQL tests start containers, so Docker has to run. The SQLite tests need none.

Then upgrade a database that already holds data, from before your change, to the new head and check that the data survives. [How to run the tests](run-the-tests.md) describes the rest of the backend's tests.
