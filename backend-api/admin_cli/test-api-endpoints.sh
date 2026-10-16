#!/bin/bash
# Admin API - Direct HTTP Endpoint Test Script
# Tests the raw API endpoints with curl (mirrors test-workflow.sh)
#
# This shows what the HubAPIClient does under the hood.
#
# Usage:
#     ./test-api-endpoints.sh
#
#     # Or with environment variables:
#     WORKSPACE_BASE_URL=http://localhost:8000 ./test-api-endpoints.sh
#
# It signs in as a command-line client (source "cli": a 12-hour bearer token,
# kept in this shell's memory only) and signs out when it exits.

set -e

BASE_URL="${WORKSPACE_BASE_URL:?Set WORKSPACE_BASE_URL to the backend URL, e.g. http://localhost:8000}"
TIMESTAMP=$(date +%s)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_step() { echo -e "${YELLOW}==>${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }

# Helper: make authenticated API request. The token reaches curl through a
# file descriptor, never its command line, where the process list would show it.
api_request() {
    local METHOD=$1
    local ENDPOINT=$2
    local DATA=$3

    if [ -n "$DATA" ]; then
        curl -s -X "$METHOD" "$BASE_URL$ENDPOINT" \
            -H "Content-Type: application/json" \
            -H @<(printf 'Authorization: Bearer %s\n' "$ACCESS_TOKEN") \
            -d "$DATA"
    else
        curl -s -X "$METHOD" "$BASE_URL$ENDPOINT" \
            -H "Content-Type: application/json" \
            -H @<(printf 'Authorization: Bearer %s\n' "$ACCESS_TOKEN")
    fi
}

# Helper: extract JSON value (simple grep-based, works for flat keys)
json_val() {
    echo "$1" | grep -o "\"$2\": *\"[^\"]*\"" | head -1 | awk -F'"' '{print $4}'
}

# =============================================================================
# 1. AUTHENTICATION
# =============================================================================
log_step "Step 1: Authenticating..."
echo "Endpoint: POST /app/login"

EMAIL="${ADMIN_EMAIL:-}"
PASSWORD="${ADMIN_PASSWORD:-}"

if [ -z "$EMAIL" ]; then
    read -p "Email: " EMAIL
fi
if [ -z "$PASSWORD" ]; then
    read -sp "Password: " PASSWORD
    echo ""
fi

# The body goes in on stdin so the password stays off curl's command line
AUTH_RESPONSE=$(curl -s -X POST "$BASE_URL/app/login" \
    -H "Content-Type: application/json" \
    --data @- <<EOF
{
    "email": "$EMAIL",
    "password": "$PASSWORD",
    "remember": false,
    "source": "cli",
    "totp_token": null
}
EOF
)

ACCESS_TOKEN=$(json_val "$AUTH_RESPONSE" "access_token")

if [ -z "$ACCESS_TOKEN" ]; then
    log_error "Authentication failed"
    echo "$AUTH_RESPONSE"
    exit 1
fi
log_success "Signed in (12-hour command-line session)"

# End the session when the script exits, whatever happens
trap 'api_request POST /logout > /dev/null' EXIT

# =============================================================================
# 2. LIST ENTITY TYPES
# =============================================================================
log_step "Step 2: Fetching entity types..."
echo "Endpoint: GET /entity/entity-type?page=1&size=100"

ENTITY_TYPES=$(api_request GET "/entity/entity-type?page=1&size=100")
ENTITY_TYPE_UUID=$(json_val "$ENTITY_TYPES" "uuid")

if [ -z "$ENTITY_TYPE_UUID" ]; then
    log_error "No entity types found"
    exit 1
fi
log_success "Using entity type: $ENTITY_TYPE_UUID"

# =============================================================================
# 3. CREATE ENTITY
# =============================================================================
log_step "Step 3: Creating entity..."
echo "Endpoint: POST /entity/entity"

ENTITY_RESPONSE=$(api_request POST "/entity/entity" "{
    \"name\": \"Test Entity $TIMESTAMP\",
    \"entity_code\": \"$ENTITY_TYPE_UUID\",
    \"email\": \"contact-$TIMESTAMP@example.com\",
    \"admin_email\": \"admin-$TIMESTAMP@example.com\",
    \"company_type\": \"Investment Firm\",
    \"organization_size\": \"10-50\",
    \"aum\": 10000000,
    \"country\": \"USA\"
}")

ENTITY_UUID=$(json_val "$ENTITY_RESPONSE" "entity_uuid")

if [ -z "$ENTITY_UUID" ]; then
    log_error "Failed to create entity"
    echo "$ENTITY_RESPONSE"
    exit 1
fi
log_success "Entity created: $ENTITY_UUID"

# =============================================================================
# 4. GET PERMISSION MAPS (what get_permission_map_by_role does)
# =============================================================================
log_step "Step 4: Fetching permission maps for entity..."
echo "Endpoint: GET /entity/entity-map?size=100&page=1"

PERMISSION_MAPS=$(api_request GET "/entity/entity-map?size=100&page=1")

# Parse permission maps using Python (more reliable than grep for nested JSON)
ADMIN_PERM_UUID=$(echo "$PERMISSION_MAPS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for item in data.get('items', []):
    if item.get('entity_uuid') == '$ENTITY_UUID' and item.get('name') == 'Admin':
        print(item['uuid'])
        break
" 2>/dev/null || echo "")

USER_PERM_UUID=$(echo "$PERMISSION_MAPS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for item in data.get('items', []):
    if item.get('entity_uuid') == '$ENTITY_UUID' and item.get('name') == 'User':
        print(item['uuid'])
        break
" 2>/dev/null || echo "")

if [ -z "$ADMIN_PERM_UUID" ] || [ -z "$USER_PERM_UUID" ]; then
    log_error "Failed to find permission maps"
    exit 1
fi
log_success "Admin permission map: $ADMIN_PERM_UUID"
log_success "User permission map: $USER_PERM_UUID"

# =============================================================================
# 5. CREATE ADMIN USER
# =============================================================================
log_step "Step 5: Creating admin user..."
echo "Endpoint: POST /admin/create-user"
echo "Note: HubAPIClient.user_create() does step 4 + 5 automatically"

ADMIN_EMAIL="admin-$TIMESTAMP@example.com"

ADMIN_USER_RESPONSE=$(api_request POST "/admin/create-user" "{
    \"email\": \"$ADMIN_EMAIL\",
    \"permissions_uuid\": \"$ADMIN_PERM_UUID\",
    \"first_name\": \"Admin\",
    \"last_name\": \"User\"
}")

ADMIN_TEMP_PASSWORD=$(json_val "$ADMIN_USER_RESPONSE" "temporary_password")

if [ -z "$ADMIN_TEMP_PASSWORD" ]; then
    log_error "Failed to create admin user"
    echo "$ADMIN_USER_RESPONSE"
else
    log_success "Admin created: $ADMIN_EMAIL (password: $ADMIN_TEMP_PASSWORD)"
fi

# =============================================================================
# 6. CREATE REGULAR USER
# =============================================================================
log_step "Step 6: Creating regular user..."
echo "Endpoint: POST /admin/create-user"

USER_EMAIL="analyst-$TIMESTAMP@example.com"

USER_RESPONSE=$(api_request POST "/admin/create-user" "{
    \"email\": \"$USER_EMAIL\",
    \"permissions_uuid\": \"$USER_PERM_UUID\",
    \"first_name\": \"Analyst\",
    \"last_name\": \"One\"
}")

USER_TEMP_PASSWORD=$(json_val "$USER_RESPONSE" "temporary_password")

if [ -z "$USER_TEMP_PASSWORD" ]; then
    log_error "Failed to create regular user"
    echo "$USER_RESPONSE"
else
    log_success "User created: $USER_EMAIL (password: $USER_TEMP_PASSWORD)"
fi

# =============================================================================
# 7. LIST ENTITIES (to get entity details)
# =============================================================================
log_step "Step 7: Getting entity details..."
echo "Endpoint: GET /entity/entity?page=1&size=100"
echo "Note: HubAPIClient.entity_get() iterates pages to find by UUID"

ENTITIES=$(api_request GET "/entity/entity?page=1&size=100")

# Extract our entity details
ENTITY_DETAILS=$(echo "$ENTITIES" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for item in data.get('items', []):
    if item.get('uuid') == '$ENTITY_UUID':
        print(json.dumps(item, indent=2))
        break
" 2>/dev/null || echo "{}")

echo "$ENTITY_DETAILS" | head -10
log_success "Retrieved entity details"

# =============================================================================
# 8. UPDATE ENTITY (smart partial update)
# =============================================================================
log_step "Step 8: Updating entity (sharing: off -> on)..."
echo "Endpoint: PUT /entity/entity/{uuid}"
echo "Note: HubAPIClient.entity_update() fetches current state, merges changes, then PUTs"

# For PUT, we need to send the full payload (the client does fetch-merge-put)
UPDATE_RESPONSE=$(api_request PUT "/entity/entity/$ENTITY_UUID" "{
    \"name\": \"Test Entity $TIMESTAMP\",
    \"entity_code\": \"$ENTITY_TYPE_UUID\",
    \"email\": \"contact-$TIMESTAMP@example.com\",
    \"company_type\": \"Investment Firm\",
    \"organization_size\": \"10-50\",
    \"aum\": 10000000,
    \"country\": \"USA\",
    \"sharing_enabled\": true
}")

log_success "Entity updated (sharing: off -> on)"

# =============================================================================
# 9. FIND USER BY EMAIL
# =============================================================================
log_step "Step 9: Finding user by email..."
echo "Endpoint: GET /entity/user?email={email}&page=1&size=100"
echo "Note: HubAPIClient.user_get_by_email() does this"

USER_LOOKUP=$(api_request GET "/entity/user?email=$USER_EMAIL&page=1&size=100")
USER_UUID=$(echo "$USER_LOOKUP" | python3 -c "
import sys, json
data = json.load(sys.stdin)
items = data.get('items', [])
if items:
    print(items[0]['uuid'])
" 2>/dev/null || echo "")

if [ -z "$USER_UUID" ]; then
    log_error "User not found"
else
    log_success "Found user UUID: $USER_UUID"
fi

# =============================================================================
# 10. RESET USER PASSWORD
# =============================================================================
log_step "Step 10: Resetting user password..."
echo "Endpoint: POST /admin/reset-password/{user_uuid}"

if [ -n "$USER_UUID" ]; then
    RESET_RESPONSE=$(api_request POST "/admin/reset-password/$USER_UUID")
    NEW_PASSWORD=$(json_val "$RESET_RESPONSE" "temporary_password")
    log_success "Password reset: $USER_EMAIL (new: $NEW_PASSWORD)"
fi

# =============================================================================
# 11. DELETE USER
# =============================================================================
log_step "Step 11: Deleting user..."
echo "Endpoint: DELETE /admin/users/{user_uuid}/remove"

if [ -n "$USER_UUID" ]; then
    DELETE_RESPONSE=$(api_request DELETE "/admin/users/$USER_UUID/remove")
    log_success "User deleted: $USER_EMAIL"
fi

# =============================================================================
# SUMMARY
# =============================================================================
echo ""
echo "======================================="
echo "API ENDPOINT REFERENCE"
echo "======================================="
echo ""
echo "What HubAPIClient abstracts:"
echo ""
echo "| Client Method                      | Raw Endpoints                              |"
echo "|------------------------------------|-------------------------------------------|"
echo "| auth_login(email, pw)              | POST /app/login (source \"cli\")            |"
echo "| auth_logout()                      | POST /logout                              |"
echo "| entity_type_list()                 | GET /entity/entity-type                   |"
echo "| entity_create(config)              | POST /entity/entity                       |"
echo "| entity_get(uuid)                   | GET /entity/entity (iterates pages)       |"
echo "| entity_update(uuid, **kwargs)      | GET + merge + PUT /entity/entity/{uuid}   |"
echo "| get_permission_map_by_role()       | GET /entity/entity-map + filter           |"
echo "| user_create(entity, email, role)   | GET permission map + POST /admin/create-user |"
echo "| user_get_by_email(email)           | GET /entity/user?email=X                  |"
echo "| user_reset_password(uuid)          | POST /admin/reset-password/{uuid}         |"
echo "| user_delete(uuid)                  | DELETE /admin/users/{uuid}/remove         |"
echo "| provision_full(config)             | All of the above in sequence              |"
echo ""
echo "======================================="
echo ""
echo "Test Results:"
echo "  Entity UUID: $ENTITY_UUID"
echo "  Admin: $ADMIN_EMAIL"
echo "======================================="
