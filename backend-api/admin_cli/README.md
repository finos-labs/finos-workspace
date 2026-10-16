# Admin CLI & Python Client

A single-file Python tool for managing entities and users. Zero dependencies (Python 3.8+ stdlib only).

**Two ways to use:**
1. **CLI** - Command-line interface for shell scripts and manual operations
2. **Python Client** - `HubAPIClient` class for programmatic access

## Quick Start

**Note:** On Windows, replace `./workspace-admin` with `py workspace-admin` or `python workspace-admin` in all commands below.

```bash
# Sign in once for this shell
eval "$(./workspace-admin auth login --api-url https://your.backend.url)"

# Check status
./workspace-admin auth status

# Sign out when done
eval "$(./workspace-admin auth logout)"
```

## Sessions

The CLI signs in as a command-line client: a bearer token that lasts 12 hours
and leaves your browser sessions signed in. The token lives only in memory —
in the CLI process, or in your shell's environment. The CLI never writes it to
disk and never logs request headers or bodies.

Two environment variables carry the session:

- `WORKSPACE_BASE_URL` - API endpoint URL (default `https://localhost:8080`)
- `WORKSPACE_ADMIN_TOKEN` - the session token

**Several commands:** `auth login` asks for the email and password (or takes
`--email`/`--password`) and prints both variables as `export` lines, so `eval`
loads them into the current shell:

```bash
eval "$(./workspace-admin auth login --api-url http://localhost:8000)"
./workspace-admin entity list
./workspace-admin user list
eval "$(./workspace-admin auth logout)"   # ends the session and unsets the token
```

`auth login --json` prints `{"base_url": ..., "access_token": ...}` instead.

**One command:** without `WORKSPACE_ADMIN_TOKEN`, a command asks for the email
and password on the terminal, signs in for itself and ends that session when it
exits:

```bash
WORKSPACE_BASE_URL=http://localhost:8000 ./workspace-admin entity list
```

A script without a terminal must set `WORKSPACE_ADMIN_TOKEN` first.

When the session has ended or expired, commands answer `401`; sign in again.

## Documentation

The CLI is self-documenting. Use `-h` for details on any command.

```bash
./workspace-admin -h
./workspace-admin entity -h
```

## Common Operations

### 1. List Entities

```bash
# List all entities
./workspace-admin entity list

# With pagination
./workspace-admin entity list --page 2 --size 50

# JSON output
./workspace-admin entity list --json
```

### 2. Create an Entity

First, get available entity types:

```bash
./workspace-admin entity-type list
```

Create a config file `new-entity.json`:

```json
{
  "name": "<entity name>",
  "entity_type_uuid": "your-entity-type-uuid-here",
  "email": "<contact-email>",
  "company_type": "Investment Firm",
  "organization_size": "10-50",
  "aum": 10000000,
  "country": "USA",
  "sharing_enabled": false,
  "admin_email": "<admin-email>"
}
```

**Available Entity Fields:**

- `name` (string, required) - Entity name
- `entity_type_uuid` (UUID, required) - Entity type identifier
- `email` (email, required) - General contact email
- `admin_email` (email, required) - Primary admin email
- `company_type` (string, required) - e.g., "Investment Firm", "Hedge Fund"
- `organization_size` (string, required) - e.g., "10-50", "50-100"
- `aum` (integer, required) - Assets Under Management
- `country` (string, required) - ISO country code or name
- `sharing_enabled` (boolean, optional) - Whether the entity's roles may allow sharing dashboards and apps (default: false)

Every new entity gets three permission maps, one per user type: Admin, Developer and User.

Then create:

```bash
./workspace-admin entity create --config new-entity.json
```

Or generate a template:

```bash
./workspace-admin entity sample > new-entity.json
```

### 3. Update an Entity

**Simple update (inline JSON):**

```bash
# Let the entity's roles allow sharing
./workspace-admin entity update <entity-uuid> --data '{"sharing_enabled": true}'

# Update multiple fields
./workspace-admin entity update <entity-uuid> --data '{"aum": 15000000, "country": "UK"}'
```

Turning `sharing_enabled` off revokes every share in the entity.

**Update from file:**

Create `update-entity.json`:

```json
{
  "sharing_enabled": true,
  "aum": 15000000
}
```

```bash
./workspace-admin entity update <entity-uuid> --config update-entity.json
```

**Available Update Fields** (all optional, only include what you want to change):

- `name` - Entity name
- `entity_code` - Entity type UUID
- `email` - Contact email
- `company_type` - Company type
- `organization_size` - Organization size
- `aum` - Assets Under Management
- `country` - Country
- `sharing_enabled` - Whether the entity's roles may allow sharing

### 4. List Users

```bash
# List all users
./workspace-admin user list

# Filter by email
./workspace-admin user list --email <user-email>

# With pagination
./workspace-admin user list --page 1 --size 50
```

### 5. Add a User

```bash
# Add regular user
./workspace-admin user create <entity-uuid> \
  --email <user-email> \
  --first-name <first-name> \
  --last-name <last-name> \
  --role user

# Add developer
./workspace-admin user create <entity-uuid> \
  --email <user-email> \
  --first-name <first-name> \
  --last-name <last-name> \
  --role developer

# Add admin user
./workspace-admin user create <entity-uuid> \
  --email <admin-email> \
  --first-name <first-name> \
  --last-name <last-name> \
  --role admin
```

**User Creation Fields:**

- `entity_uuid` (UUID, required) - Target entity
- `--email` (email, required) - User email
- `--first-name` (string, required) - First name
- `--last-name` (string, required) - Last name
- `--role` (admin|developer|user, optional) - User type (default: user). Admins administer the entity; admins and developers may add their own connections (data backends, MCP servers, custom Copilots, file uploads); users work with what the entity's roles give them.

The command returns a temporary password for the new user.

### 6. Remove a User

```bash
./workspace-admin user delete <user-email>
```

**Note:** Regular admins can only delete users within their own entity. Superadmins can delete users from any entity.

### 7. Move User Between Entities

```bash
# Move user to different entity
./workspace-admin user move \
  --entity-uuid <target-entity-uuid> \
  --email <user-email> \
  --role user

# Move and promote to admin
./workspace-admin user move \
  --entity-uuid <target-entity-uuid> \
  --email <user-email> \
  --role admin
```

### 8. Reset User Password

```bash
./workspace-admin user reset-password <user-email>
```

Returns a new temporary password.

### 9. Export a User's Data

Downloads a complete copy of somebody's account as a zip, which they can import
into Lite.

```bash
./workspace-admin user export <user-email> --out ./exports
```

**Superuser only.** Unlike the rest of the `user` commands, this is not
available to entity admins — it is gated on `is_superuser`, and a non-superuser
gets a `403`. A full export carries the account's credentials (sealed, see below),
so the bar is deliberately higher than for commands whose effects are recoverable.

Options:

| Flag | Effect |
| --- | --- |
| `--out` | Directory or file path for the archive (default: current directory) |
| `--with-files` | Download the account's uploaded files. **Slow** — see below. |
| `--include-history` | Include dashboard version history. Much larger archive. |
| `--json` | Print `{"path": ..., "bytes": ..., "export_key": ...}` instead of the human summary |

The account's credentials (backend, copilot and MCP server headers, provider keys)
are sealed in the archive with AES-256-GCM under an export key made for that
archive alone. The command prints the key once; it is stored nowhere, and the
import cannot run without it. Send it to the person importing separately from the
archive.

#### Why files are opt-in

By default the archive carries the *record* of the user's uploads but not the
files themselves. Downloading blobs dominates the export: on a real account,
160 files took 47 seconds of a 53-second export. That is close enough to a
typical 60-second proxy idle timeout that a user with more uploads would see the
request die mid-flight.

Pass `--with-files` when you want the files, and expect it to be slow. If it
times out over HTTP, run the export directly on the backend instead:

```bash
python -m scripts.export_user_data --email <user-email> --with-files --out ./exports
```

#### Running it against a specific environment

Sign in to that environment as your superuser account (see [Sessions](#sessions)):

```bash
eval "$(./workspace-admin auth login --api-url https://dev.your-backend.url)"

# Confirm which environment you are pointed at
./workspace-admin auth status
```

If the account is not a superuser the export returns `401`, even though other
`user` commands work.

To see exactly which tables travel, what is dropped, and what the import resets,
run this on a backend checkout:

```bash
python -m scripts.user_data_scope
```

The same text ships inside every archive as `SCOPE.txt`.

#### Handling the archive

The zip's credentials — the headers of the user's custom backends, copilots and
MCP servers, and their provider keys — are sealed under the export key, which is
not in the zip. The rest of it is not encrypted: treat the file as private and
delete it once the user has it.

The archive also contains a `files/` folder with everything the user uploaded.
Those files are **not** imported into Lite; they are there so the user
keeps their own copy.

#### Importing into Lite

The import runs inside the user's own Lite container, so it needs no token — it
is a local command on a machine they already control. It asks for the export key
on the terminal (hence `-it`) and refuses to run without one.

```bash
docker run -d --name workspace -p 3000:3000 \
    -v workspace-data:/data \
    -v /path/to/exports:/import \
    lite

docker exec -it workspace workspace-import /import/workspace-export-<email>-<stamp>.zip
docker exec workspace credentials   # admin login, then set the user's password
```

The imported account has **no usable password** — none is exported. The Lite
admin sets one after importing.

## Bulk Provisioning

**Create Entity + Users in one operation:**

Generate template:

```bash
./workspace-admin provision sample > provision.json
```

Edit `provision.json`:

```json
{
  "entity": {
    "name": "<entity name>",
    "entity_type_uuid": "<entity-type-uuid>",
    "email": "<contact-email>",
    "company_type": "Investment Firm",
    "organization_size": "10-50",
    "aum": 10000000,
    "country": "USA",
    "sharing_enabled": false,
    "admin_email": "<admin-email>"
  },
  "admins": [
    {
      "email": "<admin-email>",
      "first_name": "<first name>",
      "last_name": "<last name>"
    }
  ],
  "users": [
    {
      "email": "<user-email-1>",
      "first_name": "<first name>",
      "last_name": "<last name>"
    },
    {
      "email": "<user-email-2>",
      "first_name": "<first name>",
      "last_name": "<last name>"
    }
  ]
}
```

Validate and apply:

```bash
# Validate configuration
./workspace-admin provision check --config provision.json

# Apply
./workspace-admin provision apply --config provision.json
```

### 9. Manage Data Backends

Data backends are API sources connected by default to an entity. Users in the entity will have these backends available automatically.

```bash
# Add a data backend to an entity
./workspace-admin data-backend add <entity-uuid> \
  --name "my-backend" \
  --url "<backend-url>"

# Add with authentication headers
./workspace-admin data-backend add <entity-uuid> \
  --name "my-backend" \
  --url "<backend-url>" \
  --header "Authorization:Bearer token123:headers" \
  --header "api-key:mykey123:query"

# List data backends for an entity
./workspace-admin data-backend list <entity-uuid>

# JSON output
./workspace-admin data-backend list <entity-uuid> --json

# Delete a data backend
./workspace-admin data-backend delete <entity-uuid> --name "my-backend"
```

**Header format:** `key:value` or `key:value:location` where location is `headers` (default) or `query`.

**Who can add their own backends:** admins and developers. Users (`--role user`) only see the backends added to their entity.

## Advanced Examples

### Get Entity Details

```bash
# Human-readable format
./workspace-admin entity show <entity-uuid>

# JSON format
./workspace-admin entity show <entity-uuid> --json
```

## CLI Tips

- Use `--json` flag on any command to get machine-readable output
- All update operations support partial updates (only specify fields you want to change)
- Use `--data` for quick inline updates, `--config` for complex multi-field updates
- Generate templates with `sample` commands to see all available fields

---

# Python Client (`HubAPIClient`)

The `HubAPIClient` class provides programmatic access to the Admin API. It's embedded in the same `workspace-admin` file and can be imported directly.

## Quick Start

```python
from pathlib import Path

# Load the client from the CLI file
cli_path = Path("admin_cli/workspace-admin")
cli_source = cli_path.read_text()
exec(compile(cli_source[:cli_source.find("def auth_login(args:")], cli_path, "exec"))

# Create client and authenticate
client = HubAPIClient("<api-url>")
client.access_token = client.auth_login("<your-email>", "your-password")

# Now use the client
entities = client.entity_list()
print(entities)

# End the session when done
client.auth_logout()
```

To reuse a session loaded with `eval "$(workspace-admin auth login)"`, pass
the token instead of signing in:
`HubAPIClient(os.environ["WORKSPACE_BASE_URL"], os.environ["WORKSPACE_ADMIN_TOKEN"])`.

## Client Methods

### Authentication

```python
# Sign in (a 12-hour command-line session) and use its token
client.access_token = client.auth_login(email, password)

# End the session
client.auth_logout()
```

### Entity Operations

```python
# List all entities
entities = client.entity_list(page=1, size=100)

# Get entity by UUID
entity = client.entity_get("entity-uuid")

# Create entity
entity = client.entity_create({
    "name": "<entity name>",
    "entity_type_uuid": "entity-type-uuid",
    "email": "<contact-email>",
    "admin_email": "<admin-email>",
    "company_type": "Investment Firm",
    "organization_size": "10-50",
    "aum": 10000000,
    "country": "USA",
})

# Update entity (smart partial update - only specify changed fields)
client.entity_update("entity-uuid", sharing_enabled=True)
client.entity_update("entity-uuid", aum=15000000, country="UK")
```

### Entity Type Operations

```python
# List entity types
types = client.entity_type_list(page=1, size=100)

# Create entity type
client.entity_type_create(name="Enterprise", code="ENT")
```

### User Operations

```python
# Create user with role name (no need to look up permission UUIDs)
user = client.user_create(
    entity_uuid="entity-uuid",
    email="<user-email>",
    first_name="<first name>",
    last_name="<last name>",
    role="user",  # or "developer" or "admin"
)
print(f"Temp password: {user['temporary_password']}")

# List users
users = client.user_list(page=1, size=100)

# Find user by email
user = client.user_get_by_email("<user-email>")

# Reset password
result = client.user_reset_password("user-uuid")
print(f"New password: {result['temporary_password']}")

# Delete user
client.user_delete("user-uuid")

# Move user to different entity
client.user_update_entity("user-uuid", "new-permissions-uuid")
```

### Permission Map Operations

```python
# List permission maps for an entity
maps = client.permission_map_list("entity-uuid")

# Get permission map by role name
admin_map = client.get_permission_map_by_role("entity-uuid", "admin")
developer_map = client.get_permission_map_by_role("entity-uuid", "developer")
user_map = client.get_permission_map_by_role("entity-uuid", "user")
```

### Data Backend Operations

```python
# Add a data backend to an entity
client.data_backend_add(
    entity_uuid="entity-uuid",
    name="my-backend",
    url="<backend-url>",
)

# Add with authentication headers
client.data_backend_add(
    entity_uuid="entity-uuid",
    name="my-backend",
    url="<backend-url>",
    endpoint_headers=[
        {"key": "Authorization", "value": "Bearer token123", "location": "headers"},
        {"key": "api-key", "value": "mykey123", "location": "query"},
    ],
)

# List data backends for an entity
backends = client.data_backend_list("entity-uuid")

# Delete a data backend
client.data_backend_delete("entity-uuid", "my-backend")
```

### Bulk Provisioning

```python
# Create entity + multiple users in one call
results = client.provision_full({
    "entity": {
        "name": "<entity name>",
        "entity_type_uuid": "entity-type-uuid",
        "email": "<contact-email>",
        "admin_email": "<admin-email>",
        "company_type": "Investment Firm",
        "organization_size": "10-50",
        "aum": 10000000,
        "country": "USA",
    },
    "users": [
        {"email": "<admin-email>", "first_name": "<first name>", "last_name": "<last name>", "role": "admin"},
        {"email": "<user-email-1>", "first_name": "<first name>", "last_name": "<last name>", "role": "user"},
        {"email": "<user-email-2>", "first_name": "<first name>", "last_name": "<last name>", "role": "user"},
    ]
})

print(f"Entity: {results['entity']['entity_uuid']}")
for user in results["users"]:
    print(f"Created: {user['email']} ({user['role']})")
for failed in results["failed_users"]:
    print(f"Failed: {failed['email']} - {failed['error']}")
```

## Complete Example

```python
from pathlib import Path
import getpass

# Load client
cli_path = Path("admin_cli/workspace-admin")
cli_source = cli_path.read_text()
exec(compile(cli_source[:cli_source.find("def auth_login(args:")], cli_path, "exec"))

# Authenticate
client = HubAPIClient("<api-url>")
email = input("Email: ")
password = getpass.getpass("Password: ")
client.access_token = client.auth_login(email, password)

# Get entity type
entity_types = client.entity_type_list()
entity_type_uuid = entity_types["items"][0]["uuid"]

# Create entity
entity = client.entity_create({
    "name": "My New Entity",
    "entity_type_uuid": entity_type_uuid,
    "email": "<contact-email>",
    "admin_email": "<admin-email>",
    "company_type": "Investment Firm",
    "organization_size": "10-50",
    "aum": 10000000,
    "country": "USA",
})
print(f"Created entity: {entity['entity_uuid']}")

# Add users
admin = client.user_create(
    entity_uuid=entity["entity_uuid"],
    email="<admin-email>",
    first_name="Admin",
    last_name="<last name>",
    role="admin",
)
print(f"Admin password: {admin['temporary_password']}")

analyst = client.user_create(
    entity_uuid=entity["entity_uuid"],
    email="<user-email>",
    first_name="<first name>",
    last_name="<last name>",
    role="user",
)
print(f"Analyst password: {analyst['temporary_password']}")

# Update entity
client.entity_update(entity["entity_uuid"], sharing_enabled=True)
print("Turned sharing on")

# Sign out
client.auth_logout()
```

## Error Handling

```python
try:
    user = client.user_get_by_email("<unknown-email>")
except APIError as e:
    print(f"Error {e.status_code}: {e.message}")
```

## CLI vs Python Client

| Operation | CLI | Python Client |
|-----------|-----|---------------|
| Create user with role | `--role admin` | `role="admin"` |
| Partial entity update | `--data '{"sharing_enabled": true}'` | `entity_update(uuid, sharing_enabled=True)` |
| Bulk provisioning | `provision apply --config file.json` | `provision_full(config_dict)` |
| Find user by email | `user list --email X` | `user_get_by_email(email)` |
| Add data backend | `data-backend add <uuid> --name X --url Y` | `data_backend_add(uuid, name, url)` |

**Key benefits of the Python client:**
- No need to look up permission UUIDs - just use role names (`"admin"`, `"developer"` or `"user"`)
- `entity_update()` does smart partial updates (fetches current state, merges changes)
- `provision_full()` creates entity + all users in a single call
- Proper error handling with `APIError` exceptions

## Testing

Run the test scripts to verify everything works. Each signs in (or, for
`test-workflow.sh`, uses a session already loaded into the shell) and ends the
session it opened when it exits.

```bash
# Test CLI
bash admin_cli/test-workflow.sh

# Test Python client
python admin_cli/test-api-client.py

# Test the raw endpoints with curl
bash admin_cli/test-api-endpoints.sh
```
