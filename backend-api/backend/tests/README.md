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
- Alembic version is at the head of the migration chain

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

1. **Entity (Default Organization)** - The organization that users without one are put into
2. **PermissionsEntityMap** - Its "User" permissions map, `DEFAULT_USER_MAPPING`

### UUID References

The seed function uses specific UUIDs that align with the application's settings:

| Record | UUID | Purpose |
|--------|------|---------|
| DEFAULT_USER_MAPPING | `22222222-2222-2222-2222-222222222222` | The default organization's User map |
| Default Organization | `33333333-3333-3333-3333-333333333333` | The default organization |

### How the clients authenticate

The clients talk to `https://test`, so that they keep and send the API's secure session
cookies, and send the web app's origin `http://test`, which `pytest.ini` makes the one
entry of `BACKEND_CORS_ORIGINS`.

- `app_client` is the web app before sign-in: the `X-Workspace-Client: web` header and the
  origin. A sign-in (`POST /app/login`, source `app`) sets the `__Host-ws_session` cookie,
  which the client then sends.
- `auth_client`, `admin_client` and `second_user_client` are the web app signed in: each
  has a session in the table (stored as its hash) and sends its cookie, the client header
  and the origin.
- `bearer_client(token)` (`fixtures/base.py`) is a client that is not a browser (the default
  Copilot with an agent token): it sends `Authorization: Bearer <token>`.

```python
@pytest.mark.asyncio
async def test_app_login(app_client):
    response = await app_client.post("/app/login", json={...})
    assert response.status_code == 200
    assert app_client.cookies["__Host-ws_session"]
```

### The `organization` fixture

Tests of what users may do (user types, sharing, role settings, limits) use the
`organization` fixture from `fixtures/organization.py`: the admin's organization with
sharing switched on and the test user in it as a "User", plus helpers that add roles with
their settings, users, dashboards and apps. Everything it adds is removed after the test.

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
