# Backend Integration Tests

## How to run the tests

### Prerequisites

- Docker must be running (testcontainers uses Docker to spin up MySQL and Redis)
- Python 3.13 with the dev dependencies installed
- poetry install --with dev

### Run tests

```bash
cd backend
source venv/Scripts/activate   # or on Windows: venv\Scripts\activate
pytest tests -v
```

That's it! **No manual docker-compose required.** Testcontainers automatically:

1. Starts fresh MySQL and Redis containers with random ports
2. Configures the test environment to use those containers
3. Stops and cleans up containers when tests finish

### Running a specific test file

```bash
pytest tests/test_auth.py -v
```

### Running a specific test class or method

```bash
pytest tests/test_auth.py::TestAppLogin -v
pytest tests/test_auth.py::TestAppLogin::test_login_valid_credentials -v
```

## Database Dialect Migration Tests

Separate from the integration tests, `test_migration_dialects.py` verifies that
`alembic upgrade head` works correctly on a **fresh** database for all three
supported dialects: MySQL, PostgreSQL, and SQLite.

Each test spins up a fresh container (or temp file for SQLite), runs the full
migration chain via subprocess, then introspects every table to verify:

- All tables were created (40+ expected)
- Every column can be reflected without type-mapping errors
- A `SELECT` succeeds on every table
- Seed data is present (2 tiers, 2 default_tiers, 3 data_bundles)
- Alembic version is at `0002`

### Run all dialect tests

```bash
cd backend
python -m pytest tests/test_migration_dialects.py -v
```

### Run a single dialect

```bash
python -m pytest tests/test_migration_dialects.py::TestSQLiteMigrations -v
python -m pytest tests/test_migration_dialects.py::TestMySQLMigrations -v
python -m pytest tests/test_migration_dialects.py::TestPostgreSQLMigrations -v
```

> **Note:** MySQL and PostgreSQL tests require Docker. SQLite runs without Docker.

---

## Test Infrastructure

The test setup uses [testcontainers-python](https://testcontainers-python.readthedocs.io/) to automatically manage:

- **MySQL 8.0** container (random port, auto-configured)
- **Redis Alpine** container (random port, auto-configured)

Environment variables are set dynamically by `conftest.py` based on the container ports.

## Database Seeding

The `/app` endpoints require specific entities and permissions to exist in the database before tests can run. This seeding is handled automatically by the `_seed_entities()` function in `conftest.py`.

### What gets seeded

The seed function creates the following records after database migrations run:

1. **EntityType** - A single entity type record for "app" entities
2. **Entity (Developer)** - The developer-tier entity linked to `DEVELOPER_MAPPING`
3. **PermissionsEntityMap** - The permission mapping that links the entity to its UUID

### UUID References

The seed function uses specific UUIDs that align with the application's settings:

| Record | UUID | Purpose |
|--------|------|---------|
| DEVELOPER_MAPPING | `22222222-2222-2222-2222-222222222222` | Developer tier permission mapping |
| Developer Entity | `33333333-3333-3333-3333-333333333333` | Developer entity record |
| EntityType | `55555555-5555-5555-5555-555555555555` | Entity type record |

### The `app_client` fixture

Tests that hit `/app/*` endpoints must use the `app_client` fixture instead of the base `client` fixture. This is because the `/app` router requires a service JWT in the `X-Workspace-Authorization` header.

```python
@pytest.mark.asyncio
async def test_app_login(app_client):
    response = await app_client.post("/app/login", json={...})
    assert response.status_code == 200
```

The `app_client` fixture:

- Inherits from the base `client` fixture
- Adds `X-Workspace-Authorization: Bearer <service_jwt>` header
- The service JWT has `sub="app"` and `iss="workspace"`

### Cleanup

The test teardown (in `conftest.py`) handles cleanup by:

1. Disabling foreign key checks
2. Truncating all tables except `alembic_version`
3. Re-enabling foreign key checks

This ensures each test run starts with a clean database state.

## Unit Tests (no Docker required)

Some test files are pure unit tests that mock all external dependencies and don't need the integration test infrastructure (MySQL, Redis, Docker). They can be run standalone without Docker:

```bash
pytest tests/scripts/test_create_local_env.py -v
```

### Unit test files

| File | What it covers |
|------|----------------|
| `scripts/test_create_local_env.py` | `scripts.create_local_env`: the settings and the seed config it writes |
