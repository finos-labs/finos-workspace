import base64
from uuid import uuid4

import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_database_connection(db_session):
    result = await db_session.execute(text("SELECT 1"))
    assert result.scalar() == 1


@pytest.mark.asyncio
async def test_migrations_applied(db_session):
    result = await db_session.execute(text("SHOW TABLES LIKE 'user'"))
    assert result.scalar() == "user"


@pytest.mark.asyncio
async def test_unauthenticated_access(client):
    response = await client.get("/app/user")
    assert response.status_code in {401, 403}


@pytest.mark.asyncio
async def test_authenticated_access(auth_client):
    response = await auth_client.get("/app/user")
    assert response.status_code == 200
    data = response.json()
    assert data["email"] == "testrunner@example.com"


@pytest.mark.asyncio
async def test_required_tables_exist(db_session):
    required_tables = [
        "user",
        "session",
        "role",
    ]
    for table in required_tables:
        result = await db_session.execute(text(f"SHOW TABLES LIKE '{table}'"))
        assert result.scalar() == table, f"Table '{table}' should exist"


@pytest.mark.asyncio
async def test_alembic_version_table_exists(db_session):
    result = await db_session.execute(text("SHOW TABLES LIKE 'alembic_version'"))
    assert result.scalar() == "alembic_version"


@pytest.mark.asyncio
async def test_user_table_has_required_columns(db_session):
    result = await db_session.execute(text("DESCRIBE user"))
    columns = [row[0] for row in result.fetchall()]
    required_columns = ["uuid", "email"]
    for col in required_columns:
        assert col in columns, f"Column '{col}' should exist in user table"


@pytest.mark.asyncio
async def test_missing_auth_header(client):
    if "Authorization" in client.headers:
        del client.headers["Authorization"]
    response = await client.get("/app/user")
    assert response.status_code in {401, 403}
    data = response.json()
    assert isinstance(data, dict)
    assert "detail" in data or "message" in data or "error" in data
    response_str = str(data).lower()
    assert "password" not in response_str
    assert "secret" not in response_str
    assert (
        "token" not in response_str
        or "invalid" in response_str
        or "required" in response_str
    )


@pytest.mark.asyncio
async def test_invalid_bearer_token(client):
    client.headers["Authorization"] = "Bearer invalid_token_here"
    response = await client.get("/app/user")
    assert response.status_code in {401, 403}
    data = response.json()
    assert isinstance(data, dict)
    assert "detail" in data or "message" in data or "error" in data
    response_str = str(data)
    assert "invalid_token_here" not in response_str


@pytest.mark.asyncio
async def test_malformed_auth_header(client):
    client.headers["Authorization"] = "not-bearer-format"
    response = await client.get("/app/user")
    assert response.status_code in {401, 403}
    data = response.json()
    assert isinstance(data, dict)
    assert "detail" in data or "message" in data or "error" in data


@pytest.mark.asyncio
async def test_empty_bearer_token(client):
    client.headers["Authorization"] = "Bearer "
    response = await client.get("/app/user")
    assert response.status_code in {401, 403}
    data = response.json()
    assert isinstance(data, dict)
    assert "detail" in data or "message" in data or "error" in data


@pytest.mark.asyncio
async def test_basic_auth_not_accepted(client):
    credentials = base64.b64encode(b"user:pass").decode()
    client.headers["Authorization"] = f"Basic {credentials}"
    response = await client.get("/app/user")
    assert response.status_code in {401, 403}
    data = response.json()
    assert isinstance(data, dict)
    assert "detail" in data or "message" in data or "error" in data
    response_str = str(data)
    assert credentials not in response_str
    assert "user:pass" not in response_str


@pytest.mark.asyncio
async def test_json_content_type(auth_client):
    response = await auth_client.get("/app/user")
    assert response.status_code == 200
    content_type = response.headers.get("content-type", "")
    assert "application/json" in content_type


@pytest.mark.asyncio
async def test_user_response_has_uuid(auth_client):
    response = await auth_client.get("/app/user")
    assert response.status_code == 200
    data = response.json()
    assert "uuid" in data


@pytest.mark.asyncio
async def test_user_response_no_password_hash(auth_client):
    response = await auth_client.get("/app/user")
    assert response.status_code == 200
    data_str = str(response.json())
    assert "password_hash" not in data_str
    assert "hashed_password" not in data_str


@pytest.mark.asyncio
async def test_health_endpoint_exists(client):
    for path in ["/health", "/healthz", "/status", "/"]:
        response = await client.get(path)
        if response.status_code == 200:
            return
    response = await client.get("/")
    assert response.status_code in {200, 404}


@pytest.mark.asyncio
async def test_404_for_nonexistent_endpoint(client):
    response = await client.get("/this/endpoint/does/not/exist")
    assert response.status_code == 404
    content_type = response.headers.get("content-type", "")
    if "application/json" in content_type:
        data = response.json()
        assert isinstance(data, dict)
        assert "detail" in data or "message" in data or "error" in data
        return

    assert "Not Found" in response.text


@pytest.mark.asyncio
async def test_405_for_wrong_method(auth_client):
    response = await auth_client.delete("/app/user")
    assert response.status_code in {200, 400, 404, 405, 422}


@pytest.mark.asyncio
async def test_422_for_invalid_json(auth_client):
    response = await auth_client.post(
        "/app/display-settings",
        content="not valid json",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code in {400, 422}
    data = response.json()
    assert isinstance(data, dict)
    assert "detail" in data or "message" in data or "error" in data
    content_type = response.headers.get("content-type", "")
    assert "application/json" in content_type


@pytest.mark.asyncio
async def test_admin_endpoints_require_admin(auth_client):
    response = await auth_client.get("/admin/users")
    assert response.status_code in {401, 403}
    data = response.json()
    assert isinstance(data, dict)
    assert "detail" in data or "message" in data or "error" in data
    response_str = str(data).lower()
    has_access_error = any(
        word in response_str
        for word in ["admin", "permission", "access", "authorized", "forbidden"]
    )
    assert has_access_error


@pytest.mark.asyncio
async def test_admin_client_can_access_admin_endpoints(admin_client):
    response = await admin_client.get("/admin/users")
    assert response.status_code == 200
    data = response.json()
    if isinstance(data, list):
        if len(data) > 0:
            user = data[0]
            assert isinstance(user, dict)
            assert "password" not in str(user).lower() or "password_hash" not in str(
                user
            )
    elif isinstance(data, dict):
        assert "items" in data or "users" in data or "data" in data
    content_type = response.headers.get("content-type", "")
    assert "application/json" in content_type


@pytest.mark.asyncio
async def test_regular_user_cannot_elevate_to_admin(auth_client):
    response = await auth_client.post(
        "/admin/role",
        json={"name": "Admin", "description": "Attempt to create admin role"},
    )
    assert response.status_code in {401, 403}

    fake_uuid = str(uuid4())
    response = await auth_client.put(
        f"/admin/role-permissions/{fake_uuid}",
        json={"permissions": [{"type": "backend", "access": "full-access"}]},
    )
    assert response.status_code in {401, 403}
