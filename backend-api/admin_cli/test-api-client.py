"""
Admin API Client - Full Workflow Test Script
Tests the HubAPIClient class directly as a Python library.

This mirrors test-workflow.sh but uses the client class programmatically
instead of invoking the CLI.

Usage:
    python test-api-client.py

    # Or with environment variables:
    WORKSPACE_BASE_URL=http://localhost:8000 ADMIN_EMAIL=admin@example.com python test-api-client.py

It signs in as a command-line client (a 12-hour bearer token kept in memory
only) and ends that session when it exits.
"""

import atexit
import getpass
import os
import sys
import time
from pathlib import Path

# Import HubAPIClient and APIError from the CLI file
# We need to extract just the classes, not run main()
cli_path = Path(__file__).parent / "workspace-admin"
cli_source = cli_path.read_text()

# Extract everything up to the CLI command handlers (line ~540)
# This includes HubAPIClient, APIError, and helper functions
import_end = cli_source.find("def auth_login(args:")
if import_end == -1:
    import_end = cli_source.find("# COMMAND HANDLERS")
if import_end == -1:
    # Fallback: just don't run main by setting __name__
    exec(  # noqa: S102 -- loads classes from the extensionless workspace-admin CLI script
        compile(cli_source, cli_path, "exec"), {"__name__": "workspace_admin_module"}
    )
else:
    exec(  # noqa: S102 -- loads classes from the extensionless workspace-admin CLI script
        compile(cli_source[:import_end], cli_path, "exec")
    )

# Colors for output
RED = "\033[0;31m"
GREEN = "\033[0;32m"
YELLOW = "\033[1;33m"
NC = "\033[0m"


def log_step(msg: str) -> None:
    print(f"{YELLOW}==>{NC} {msg}")


def log_success(msg: str) -> None:
    print(f"{GREEN}✓{NC} {msg}")


def log_error(msg: str) -> None:
    print(f"{RED}✗{NC} {msg}")


def main():
    base_url = os.getenv("WORKSPACE_BASE_URL")
    if not base_url:
        sys.exit("Set WORKSPACE_BASE_URL to the backend URL, e.g. http://localhost:8000")
    timestamp = int(time.time())

    # =========================================================================
    # 1. AUTHENTICATION
    # =========================================================================
    log_step("Step 1: Authenticating...")

    email = os.getenv("ADMIN_EMAIL") or input("Email: ")
    password = os.getenv("ADMIN_PASSWORD") or getpass.getpass("Password: ")

    client = HubAPIClient(base_url)  # noqa: F821  # type: ignore[unresolved-reference]

    try:
        client.access_token = client.auth_login(email, password)
        log_success("Signed in")
    except APIError as e:  # noqa: F821  # type: ignore[unresolved-reference]
        log_error(f"Authentication failed: {e}")
        sys.exit(1)
    # End the session when the script exits, however it exits
    atexit.register(end_session, client)  # noqa: F821  # type: ignore[unresolved-reference]

    # =========================================================================
    # 2. GET ENTITY TYPE
    # =========================================================================
    log_step("Step 2: Fetching entity types...")

    try:
        entity_types = client.entity_type_list()
        items = entity_types.get("items", [])
        if not items:
            log_error("No entity types found. Create one first.")
            sys.exit(1)

        entity_type_uuid = items[0]["uuid"]
        log_success(f"Using entity type: {entity_type_uuid}")
    except APIError as e:  # noqa: F821  # type: ignore[unresolved-reference]
        log_error(f"Failed to fetch entity types: {e}")
        sys.exit(1)

    # =========================================================================
    # 3. CREATE ENTITY
    # =========================================================================
    log_step("Step 3: Creating entity...")

    entity_config = {
        "name": f"Test Entity {timestamp}",
        "entity_type_uuid": entity_type_uuid,
        "email": f"contact-{timestamp}@example.com",
        "admin_email": f"admin-{timestamp}@example.com",
        "company_type": "Investment Firm",
        "organization_size": "10-50",
        "aum": 10000000,
        "country": "USA",
    }

    try:
        entity_resp = client.entity_create(entity_config)
        entity_uuid = entity_resp["entity_uuid"]
        log_success(f"Entity created: {entity_uuid}")
        print(f"    Name: {entity_config['name']}")
    except APIError as e:  # noqa: F821  # type: ignore[unresolved-reference]
        log_error(f"Failed to create entity: {e}")
        sys.exit(1)

    # =========================================================================
    # 4. CREATE ADMIN USER (High-level method with role name)
    # =========================================================================
    log_step("Step 4: Creating admin user...")

    admin_email = f"admin-{timestamp}@example.com"

    try:
        # Note: We just pass role="admin", not a permission_uuid!
        admin_resp = client.user_create(
            entity_uuid=entity_uuid,
            email=admin_email,
            first_name="Admin",
            last_name="User",
            role="admin",
        )
        log_success(f"Admin created: {admin_email}")
        print(f"    Link that sets the password: {admin_resp.get('link')}")
        print(f"    Role: {admin_resp.get('role')}")
    except APIError as e:  # noqa: F821  # type: ignore[unresolved-reference]
        log_error(f"Failed to create admin: {e}")
        sys.exit(1)

    # =========================================================================
    # 5. CREATE REGULAR USER
    # =========================================================================
    log_step("Step 5: Creating regular user...")

    user_email = f"analyst-{timestamp}@example.com"

    try:
        user_resp = client.user_create(
            entity_uuid=entity_uuid,
            email=user_email,
            first_name="Analyst",
            last_name="One",
            role="user",
        )
        log_success(f"User created: {user_email}")
        print(f"    Link that sets the password: {user_resp.get('link')}")
        print(f"    Role: {user_resp.get('role')}")
    except APIError as e:  # noqa: F821  # type: ignore[unresolved-reference]
        log_error(f"Failed to create user: {e}")
        sys.exit(1)

    # =========================================================================
    # 6. UPDATE ENTITY (Partial update via high-level method)
    # =========================================================================
    log_step("Step 6: Updating entity (sharing: off -> on)...")

    try:
        # Smart partial update - only specify what you want to change
        _ = client.entity_update(entity_uuid, sharing_enabled=True)
        log_success("Entity updated")

        # Verify
        entity_details = client.entity_get(entity_uuid)
        sharing_enabled = entity_details.get("sharing_enabled")
        if sharing_enabled is True:
            log_success(f"Verified: sharing_enabled = {sharing_enabled}")
        else:
            log_error(f"Verification failed: expected True, got {sharing_enabled}")
    except APIError as e:  # noqa: F821  # type: ignore[unresolved-reference]
        log_error(f"Failed to update entity: {e}")

    # =========================================================================
    # 7. ADD DATA BACKEND
    # =========================================================================
    log_step("Step 7: Adding a data backend to the entity...")

    try:
        db_resp = client.data_backend_add(
            entity_uuid=entity_uuid,
            name="test-backend",
            url="https://api.example.com",
        )
        log_success("Data backend added: test-backend")
        print(f"    Response: {db_resp}")
    except APIError as e:  # noqa: F821  # type: ignore[unresolved-reference]
        log_error(f"Failed to add data backend: {e}")

    # =========================================================================
    # 8. LIST DATA BACKENDS
    # =========================================================================
    log_step("Step 8: Listing data backends...")

    try:
        backends = client.data_backend_list(entity_uuid)
        log_success(f"Found {len(backends)} data backend(s)")
        for b in backends:
            print(f"    {b.get('name')} | {b.get('url')}")
    except APIError as e:  # noqa: F821  # type: ignore[unresolved-reference]
        log_error(f"Failed to list data backends: {e}")

    # =========================================================================
    # 9. DELETE DATA BACKEND
    # =========================================================================
    log_step("Step 9: Deleting data backend...")

    try:
        client.data_backend_delete(entity_uuid, "test-backend")
        log_success("Data backend deleted: test-backend")
    except APIError as e:  # noqa: F821  # type: ignore[unresolved-reference]
        log_error(f"Failed to delete data backend: {e}")

    # =========================================================================
    # 10. VERIFY DATA BACKENDS EMPTY
    # =========================================================================
    log_step("Step 10: Verifying data backends removed...")

    try:
        backends = client.data_backend_list(entity_uuid)
        if len(backends) == 0:
            log_success("Verified: 0 data backends remaining")
        else:
            log_error(f"Expected 0 backends, found {len(backends)}")
    except APIError as e:  # noqa: F821  # type: ignore[unresolved-reference]
        log_error(f"Failed to list data backends: {e}")

    # =========================================================================
    # 11. GET USER BY EMAIL (High-level method)
    # =========================================================================
    log_step("Step 11: Looking up user by email...")

    try:
        user = client.user_get_by_email(user_email)
        user_uuid = user["uuid"]
        log_success(f"Found user: {user_uuid}")
    except APIError as e:  # noqa: F821  # type: ignore[unresolved-reference]
        log_error(f"Failed to find user: {e}")
        user_uuid = None

    # =========================================================================
    # 12. RESET USER PASSWORD
    # =========================================================================
    log_step("Step 12: Resetting user password...")

    if user_uuid:
        try:
            reset_resp = client.user_reset_password(user_uuid)
            log_success(f"Password reset for {user_email}")
            print(f"    Link that sets a new password: {reset_resp.get('link')}")
        except APIError as e:  # noqa: F821  # type: ignore[unresolved-reference]
            log_error(f"Failed to reset password: {e}")

    # =========================================================================
    # 13. GET PERMISSION MAP BY ROLE (High-level helper)
    # =========================================================================
    log_step("Step 13: Testing permission map lookup...")

    try:
        admin_map = client.get_permission_map_by_role(entity_uuid, "admin")
        developer_map = client.get_permission_map_by_role(entity_uuid, "developer")
        user_map = client.get_permission_map_by_role(entity_uuid, "user")
        log_success(f"Admin permission map: {admin_map['uuid']}")
        log_success(f"Developer permission map: {developer_map['uuid']}")
        log_success(f"User permission map: {user_map['uuid']}")
    except APIError as e:  # noqa: F821  # type: ignore[unresolved-reference]
        log_error(f"Failed to get permission maps: {e}")

    # =========================================================================
    # 14. DELETE USERS
    # =========================================================================
    log_step("Step 14: Deleting users...")

    users_deleted = 0
    for email_to_delete in [admin_email, user_email]:
        try:
            user = client.user_get_by_email(email_to_delete)
            client.user_delete(user["uuid"])
            log_success(f"Deleted: {email_to_delete}")
            users_deleted += 1
        except APIError as e:  # noqa: F821  # type: ignore[unresolved-reference]
            print(f"{YELLOW}!{NC} Could not delete {email_to_delete}: {e}")

    # =========================================================================
    # 15. TEST BULK PROVISIONING (High-level workflow)
    # =========================================================================
    log_step("Step 15: Testing bulk provisioning (provision_full)...")

    provision_config = {
        "entity": {
            "name": f"Bulk Test Entity {timestamp}",
            "entity_type_uuid": entity_type_uuid,
            "email": f"bulk-contact-{timestamp}@example.com",
            "admin_email": f"bulk-admin-{timestamp}@example.com",
            "company_type": "Hedge Fund",
            "organization_size": "50-100",
            "aum": 50000000,
            "country": "UK",
        },
        "users": [
            {
                "email": f"bulk-admin-{timestamp}@example.com",
                "first_name": "Bulk",
                "last_name": "Admin",
                "role": "admin",
            },
            {
                "email": f"bulk-user1-{timestamp}@example.com",
                "first_name": "Bulk",
                "last_name": "User1",
                "role": "user",
            },
            {
                "email": f"bulk-user2-{timestamp}@example.com",
                "first_name": "Bulk",
                "last_name": "User2",
                "role": "user",
            },
        ],
    }

    try:
        # Single call creates entity + all users
        results = client.provision_full(provision_config)

        bulk_entity_uuid = results["entity"]["entity_uuid"]
        log_success(f"Bulk entity created: {bulk_entity_uuid}")

        for user in results["users"]:
            log_success(f"  User created: {user['email']} ({user['role']})")

        for failed in results.get("failed_users", []):
            log_error(f"  User failed: {failed['email']} - {failed['error']}")

        # Cleanup bulk users
        log_step("Cleaning up bulk provisioned users...")
        for user in results["users"]:
            try:
                u = client.user_get_by_email(user["email"])
                client.user_delete(u["uuid"])
                log_success(f"  Deleted: {user['email']}")
            except APIError:  # noqa: F821  # type: ignore[unresolved-reference]
                pass

    except APIError as e:  # noqa: F821  # type: ignore[unresolved-reference]
        log_error(f"Bulk provisioning failed: {e}")

    # =========================================================================
    # SUMMARY
    # =========================================================================
    print()
    print("=" * 50)
    print("API CLIENT TEST SUMMARY")
    print("=" * 50)
    print()
    print("High-level methods tested:")
    print("  - auth_login(email, password)")
    print("  - auth_logout() (at exit)")
    print("  - entity_type_list()")
    print("  - entity_create(config)")
    print("  - entity_get(uuid)")
    print("  - entity_update(uuid, **kwargs)")
    print("  - user_create(entity_uuid, email, first_name, last_name, role)")
    print("  - user_get_by_email(email)")
    print("  - user_reset_password(user_uuid)")
    print("  - user_delete(user_uuid)")
    print("  - get_permission_map_by_role(entity_uuid, role)")
    print("  - data_backend_add(entity_uuid, name, url)")
    print("  - data_backend_list(entity_uuid)")
    print("  - data_backend_delete(entity_uuid, backend_name)")
    print("  - provision_full(config)")
    print()
    print("Key benefits of HubAPIClient:")
    print("  - Pass role='admin' instead of looking up permission_uuid")
    print("  - entity_update() does smart partial updates (fetch-merge-put)")
    print("  - provision_full() creates entity + all users in one call")
    print("  - user_get_by_email() abstracts pagination")
    print()
    print("Test entities created:")
    print(f"  - {entity_uuid}")
    if "bulk_entity_uuid" in dir():
        print(f"  - {bulk_entity_uuid}")
    print()
    print("=" * 50)


if __name__ == "__main__":
    main()
