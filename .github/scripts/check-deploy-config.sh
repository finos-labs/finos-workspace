#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: check-deploy-config.sh FILE...

Checks an environment's app settings file (deploy/<environment>.yaml) against
the code in this repository, so a change that renames or removes a setting
updates the file in the same pull request:
- the file holds a frontend map and a backend map of plain values, nothing else
- every frontend setting is in the FIELDS table of frontend/render-frontend-config.sh,
  and that script accepts its value
- every backend setting is named somewhere in backend-api/backend (tests aside)

Run it from the repository root. It needs yq (github.com/mikefarah/yq), which
GitHub's Ubuntu runners have.

Options:
  -h, --help   show this help
EOF
}

case "${1:-}" in
  -h | --help) usage; exit 0 ;;
  "") usage >&2; exit 1 ;;
esac
command -v yq > /dev/null || { echo "::error::yq is not installed" >&2; exit 1; }

render="frontend/render-frontend-config.sh"
backend="backend-api/backend"
fields=$(awk "/^FIELDS='/ { table = 1; next } table && /^'/ { exit } table && NF == 4 { print \$3 }" "$render")
[[ -n $fields ]] || { echo "::error::No FIELDS table in $render" >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

errors=0
fail() {
  echo "::error file=$file::$*" >&2
  errors=$((errors + 1))
}

for file in "$@"; do
  if [[ ! -f $file ]]; then
    fail "$file does not exist"
    continue
  fi
  if ! yq -e 'tag == "!!map"' "$file" > /dev/null 2>&1; then
    fail "$file must be a YAML map with a frontend and a backend section"
    continue
  fi
  if grep -q -E '^(---|\.\.\.)' "$file"; then
    fail "$file must be a single YAML document, without --- or ... lines"
  fi
  for key in $(yq -r 'keys | .[] | select(. != "frontend" and . != "backend")' "$file"); do
    fail "$key: only frontend and backend may be set at the top level"
  done
  sections_ok=1
  for section in frontend backend; do
    if ! yq -e ".$section | (tag == \"!!map\" or tag == \"!!null\")" "$file" > /dev/null 2>&1; then
      fail "$section must be a map of settings"
      sections_ok=""
      continue
    fi
    for key in $(yq -r ".$section // {} | to_entries | .[] | select(.value | (tag == \"!!map\" or tag == \"!!seq\" or tag == \"!!null\")) | .key" "$file"); do
      fail "$section.$key must be a string, a number, true or false"
      sections_ok=""
    done
  done
  [[ -n $sections_ok ]] || continue

  # The frontend container writes config.js with the same script at start, and
  # stops if it rejects a value.
  env_args=()
  for key in $(yq -r '.frontend // {} | keys | .[]' "$file"); do
    if grep -q -x -F "$key" <<< "$fields"; then
      env_args+=("$key=$(yq -r ".frontend.\"$key\"" "$file")")
    else
      fail "frontend.$key is not in the FIELDS table of $render, so the frontend ignores it"
    fi
  done
  if ((${#env_args[@]})) && ! env -i PATH="$PATH" APP_CONFIG_PATH="$work/config.js" "${env_args[@]}" sh "$render" > /dev/null 2> "$work/error"; then
    fail "$render rejects a frontend value: $(cat "$work/error")"
  fi

  for key in $(yq -r '.backend // {} | keys | .[]' "$file"); do
    if ! grep -r -q -w --include='*.py' --include='*.sh' --exclude-dir=tests -e "$key" "$backend"; then
      fail "backend.$key is not read anywhere in $backend"
    fi
  done
done

if ((errors)); then
  echo "$errors problem(s) found." >&2
  exit 1
fi
echo "Checked $*: no problems."
