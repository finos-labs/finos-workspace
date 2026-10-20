# The container's keys, and the file on the data volume that keeps the ones it generated.
# Sourced by entrypoint.sh, credentials.sh and import.sh.
#
# A key passed with -e is used as given and is never written to the volume. A key that is
# not passed is generated at the first start and kept in $SECRETS_FILE, so that it stays the
# same across restarts and upgrades; a copy of the volume then holds it too, and with
# WORKSPACE_AES_KEY whatever decrypts the credentials stored in the database. No password is
# written here or anywhere else: the administrator sets theirs with `credentials`.

SECRETS_FILE="${DATA_DIR:-/data}/secrets.env"
# The keys the volume keeps when they are not passed
GENERATED_KEYS=(JWT_SECRET WORKSPACE_AES_KEY LOCAL_STORAGE_SECRET_KEY)
# The settings of the first start, which later starts reuse when they are not passed
REMEMBERED_SETTINGS=(WORKSPACE_ADMIN_EMAIL WORKSPACE_ENTITY_NAME)

# Exports each value of the file that the environment does not set. Only the names above
# are read from it: the file cannot set anything else.
load_secrets() {
  local key value
  [[ -f "$SECRETS_FILE" ]] || return 0
  while IFS='=' read -r key value; do
    case " ${GENERATED_KEYS[*]} ${REMEMBERED_SETTINGS[*]} " in
      *" $key "*) [[ -n "${!key:-}" ]] || export "$key=$value" ;;
    esac
  done < "$SECRETS_FILE"
}

# Resolves every key: the environment's first, then the file's, then a new random one.
# VOLUME_KEYS names the keys the environment did not pass, which write_secrets keeps.
resolve_secrets() {
  local key
  VOLUME_KEYS=()
  for key in "${GENERATED_KEYS[@]}"; do
    [[ -n "${!key:-}" ]] || VOLUME_KEYS+=("$key")
  done
  load_secrets
  export WORKSPACE_ENTITY_NAME="${WORKSPACE_ENTITY_NAME:-Workspace}"
  # The API refuses keys shorter than 32 bytes; WORKSPACE_AES_KEY must be base64url
  for key in ${VOLUME_KEYS[@]+"${VOLUME_KEYS[@]}"}; do
    [[ -n "${!key:-}" ]] ||
      export "$key=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
  done
}

# Writes the file (mode 600, replaced in one step so that a crash cannot cost a key): the
# keys of VOLUME_KEYS and the remembered settings.
write_secrets() {
  local key
  (
    umask 077
    {
      echo "# Written at every start: the keys this volume generated, which stay the same"
      echo "# across restarts. A key passed with -e is used instead and is not written here."
      for key in ${VOLUME_KEYS[@]+"${VOLUME_KEYS[@]}"} "${REMEMBERED_SETTINGS[@]}"; do
        printf '%s=%s\n' "$key" "${!key:-}"
      done
    } > "$SECRETS_FILE.new"
    mv -f "$SECRETS_FILE.new" "$SECRETS_FILE"
  )
}
