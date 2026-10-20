#!/bin/bash
# Tests of secrets.sh, the keys of the container and the file of the data volume that keeps
# the generated ones. Needs only bash and python3:
#   bash lite/tests/test_secrets.sh
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SECRETS_SH="$HERE/../secrets.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
failures=0

fail() {
  echo "FAIL: $*" >&2
  failures=$((failures + 1))
}

# Runs a start of the container's secret handling on a volume, with only the variables given
# (env -i: nothing else of this shell leaks in), and prints the environment it resolved.
start() { # <volume> [NAME=value ...]
  local volume="$1"
  shift
  env -i PATH="$PATH" DATA_DIR="$volume" "$@" bash -c '
    set -euo pipefail
    source "$0"
    resolve_secrets
    write_secrets
    env
  ' "$SECRETS_SH"
}

value() { # <name> <env output>
  printf '%s\n' "$2" | sed -n "s/^$1=//p"
}

kept() { # <volume> <name>
  sed -n "s/^$2=//p" "$1/secrets.env"
}

# A first start generates every key, strong enough for the API, and keeps them on the volume
volume="$WORK/first"
mkdir -p "$volume"
first="$(start "$volume" WORKSPACE_ADMIN_EMAIL=admin@mail.test)"
for key in JWT_SECRET WORKSPACE_AES_KEY LOCAL_STORAGE_SECRET_KEY; do
  generated="$(value "$key" "$first")"
  [[ ${#generated} -ge 43 ]] || fail "$key is not a 32-byte random value: '$generated'"
  [[ "$(kept "$volume" "$key")" == "$generated" ]] || fail "$key is not kept on the volume"
done
[[ "$(value WORKSPACE_ENTITY_NAME "$first")" == "Workspace" ]] || fail "the organization has no default name"
[[ "$(kept "$volume" WORKSPACE_ADMIN_EMAIL)" == "admin@mail.test" ]] || fail "the administrator's address is not remembered"
[[ "$(stat -c %a "$volume/secrets.env" 2>/dev/null || stat -f %Lp "$volume/secrets.env")" == "600" ]] ||
  fail "the secrets file is readable by others"
grep -qi password "$volume/secrets.env" && fail "the secrets file holds a password"

# A restart uses the keys the volume keeps
again="$(start "$volume")"
for key in JWT_SECRET WORKSPACE_AES_KEY LOCAL_STORAGE_SECRET_KEY WORKSPACE_ADMIN_EMAIL; do
  [[ "$(value "$key" "$again")" == "$(value "$key" "$first")" ]] || fail "$key changed across a restart"
done

# A key passed in the environment is used as given and is not written to the volume; the
# others stay as they were
passed_key="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
passed="$(start "$volume" WORKSPACE_AES_KEY="$passed_key")"
[[ "$(value WORKSPACE_AES_KEY "$passed")" == "$passed_key" ]] || fail "a passed key was not used"
grep -q '^WORKSPACE_AES_KEY=' "$volume/secrets.env" && fail "a passed key was written to the volume"
grep -qF "$passed_key" "$volume/secrets.env" && fail "a passed key's value is on the volume"
[[ "$(kept "$volume" JWT_SECRET)" == "$(value JWT_SECRET "$first")" ]] || fail "a generated key was lost"

# Keys passed from the first start on never reach the volume
volume="$WORK/passed"
mkdir -p "$volume"
start "$volume" WORKSPACE_ADMIN_EMAIL=admin@mail.test JWT_SECRET="$passed_key" \
  WORKSPACE_AES_KEY="$passed_key" LOCAL_STORAGE_SECRET_KEY="$passed_key" >/dev/null
grep -qF "$passed_key" "$volume/secrets.env" && fail "passed keys were written to a new volume"
grep -qE '^(JWT_SECRET|WORKSPACE_AES_KEY|LOCAL_STORAGE_SECRET_KEY)=' "$volume/secrets.env" &&
  fail "a new volume keeps a key that was passed"

# A value passed in the environment wins over the file's
volume="$WORK/first"
override="$(start "$volume" WORKSPACE_ADMIN_EMAIL=other@mail.test WORKSPACE_ENTITY_NAME="Acme Corp")"
[[ "$(value WORKSPACE_ADMIN_EMAIL "$override")" == "other@mail.test" ]] || fail "the file overrode a passed address"
[[ "$(value WORKSPACE_ENTITY_NAME "$override")" == "Acme Corp" ]] || fail "the file overrode a passed name"

# The file sets nothing but the names it is for
volume="$WORK/tampered"
mkdir -p "$volume"
cat > "$volume/secrets.env" <<'TAMPERED'
WORKSPACE_ADMIN_EMAIL=admin@mail.test
LD_PRELOAD=/data/storage/evil.so
BASH_ENV=/data/storage/evil.sh
WORKSPACE_ADMIN_PASSWORD=Old!Passw0rd
WORKSPACE_AUTH_TOKEN=a.stale.token
TAMPERED
tampered="$(start "$volume")"
for name in LD_PRELOAD BASH_ENV WORKSPACE_ADMIN_PASSWORD WORKSPACE_AUTH_TOKEN; do
  [[ -z "$(value "$name" "$tampered")" ]] || fail "the secrets file set $name"
  grep -q "^$name=" "$volume/secrets.env" && fail "$name stayed in the secrets file"
done
[[ "$(value WORKSPACE_ADMIN_EMAIL "$tampered")" == "admin@mail.test" ]] || fail "the remembered address was not read"

if ((failures)); then
  echo "$failures failure(s)" >&2
  exit 1
fi
echo "secrets.sh: all tests passed"
