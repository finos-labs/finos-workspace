#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: pin-dev-tags.sh -r REPO -v VALUES -k KEYS -t TAG -s SOURCE

Sets the image tag of each app in an environment's values file in the infra
repository and pushes it to main, which starts that repository's Apps workflow.
Waits for the Apps run. If the run fails, sets the tags back to what they were
and exits non-zero.

Options:
  -r, --repo REPO      infra repository, e.g. <owner>/<infrastructure-repository>
  -v, --values PATH    values file in that repository, e.g. <folder>/dev/apps/values.yaml
  -k, --keys KEYS      comma-separated top-level keys whose image.tag changes, e.g. backend,backendWorker
  -t, --tag TAG        the new image tag
  -s, --source TEXT    what built the tag, used in the commit message
  -h, --help           show this help

Environment:
  GH_TOKEN             token that can push to REPO and read its workflow runs
EOF
}

die() {
  echo "::error::$*" >&2
  exit 1
}

repo="" values="" keys="" tag="" source=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -r | --repo) repo=${2:?missing value for $1}; shift 2 ;;
    -v | --values) values=${2:?missing value for $1}; shift 2 ;;
    -k | --keys) keys=${2:?missing value for $1}; shift 2 ;;
    -t | --tag) tag=${2:?missing value for $1}; shift 2 ;;
    -s | --source) source=${2:?missing value for $1}; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die "Unknown option: $1" ;;
  esac
done

[[ -n $repo && -n $values && -n $keys && -n $tag && -n $source ]] || { usage >&2; die "All options are required"; }
[[ -n ${GH_TOKEN:-} ]] || die "GH_TOKEN is not set"
[[ $tag =~ ^[A-Za-z0-9._-]+$ ]] || die "Invalid tag: $tag"

IFS=, read -r -a key_list <<< "$keys"
for key in "${key_list[@]}"; do
  [[ $key =~ ^[A-Za-z][A-Za-z0-9]*$ ]] || die "Invalid key: $key"
done

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git clone -q "https://x-access-token:${GH_TOKEN}@github.com/${repo}.git" "$work"
git -C "$work" config user.name "github-actions[bot]"
git -C "$work" config user.email "41898282+github-actions[bot]@users.noreply.github.com"
file="$work/$values"

# Top-level keys start in column 0; an app's image tag is the only `tag:` at four spaces under it.
get_tag() {
  local value
  value=$(awk -v key="$1" '
    /^[A-Za-z][A-Za-z0-9]*:/ { in_block = ($0 ~ "^" key ":[[:space:]]*$") }
    in_block && /^    tag: / { sub(/^    tag: */, ""); sub(/[[:space:]]*$/, ""); print; exit }
  ' "$file")
  [[ -n $value ]] || die "No image tag found for $1 in $values"
  echo "$value"
}

set_tag() {
  local tmp
  tmp=$(mktemp)
  awk -v key="$1" -v tag="$2" '
    /^[A-Za-z][A-Za-z0-9]*:/ { in_block = ($0 ~ "^" key ":[[:space:]]*$") }
    in_block && /^    tag: / && !done { print "    tag: " tag; done = 1; next }
    { print }
    END { if (!done) exit 1 }
  ' "$file" > "$tmp" || die "No image tag found for $1 in $values"
  cat "$tmp" > "$file"
  rm -f "$tmp"
}

old_tags=()
pin_new_tag() {
  local key old
  old_tags=()
  for key in "${key_list[@]}"; do
    old=$(get_tag "$key")
    old_tags+=("$old")
    set_tag "$key" "$tag"
  done
}

# The keys were deployed together, so they go back together. If any of them no
# longer has the tag, someone has changed them since, and all are left as is.
restore_old_tags() {
  local i key current
  for key in "${key_list[@]}"; do
    current=$(get_tag "$key")
    if [[ $current != "$tag" ]]; then
      echo "$key has $current instead of $tag, so $short_keys are left as is."
      return 0
    fi
  done
  for i in "${!key_list[@]}"; do
    set_tag "${key_list[$i]}" "${old_tags[$i]}"
  done
}

# Applies an edit on top of the latest main and pushes it, starting over when
# another run pushed first. Sets pushed_sha, or leaves it empty when the edit
# changes nothing.
pushed_sha=""
commit_edit() {
  local edit=$1 message=$2 attempt
  pushed_sha=""
  for attempt in 1 2 3 4 5; do
    git -C "$work" fetch -q origin main
    git -C "$work" reset -q --hard origin/main
    "$edit"
    if git -C "$work" diff --quiet; then
      return 0
    fi
    git -C "$work" commit -q -am "$message"
    if git -C "$work" push -q origin HEAD:main; then
      pushed_sha=$(git -C "$work" rev-parse HEAD)
      return 0
    fi
    echo "Push to $repo was rejected (attempt $attempt of 5)."
    sleep $((attempt * 2))
  done
  die "Could not push to $repo after 5 attempts"
}

# Sets conclusion to how the Apps run for a commit ended.
conclusion=""
wait_for_apps_run() {
  local sha=$1 run_id="" status="" i
  for i in $(seq 1 30); do
    run_id=$(gh run list -R "$repo" -w apps.yml -c "$sha" --json databaseId -q '.[0].databaseId // empty')
    [[ -n $run_id ]] && break
    sleep 10
  done
  [[ -n $run_id ]] || die "The Apps workflow did not start for $sha in $repo"
  echo "Apps run: https://github.com/$repo/actions/runs/$run_id"
  for i in $(seq 1 120); do
    status=$(gh run view "$run_id" -R "$repo" --json status -q .status)
    [[ $status == completed ]] && break
    sleep 15
  done
  [[ $status == completed ]] || die "The Apps run $run_id did not finish within 30 minutes"
  conclusion=$(gh run view "$run_id" -R "$repo" --json conclusion -q .conclusion)
}

short_keys=${keys//,/, }
commit_edit pin_new_tag "Pin $short_keys to $tag in $values

Built from $source"
if [[ -z $pushed_sha ]]; then
  echo "$values already has $tag for $short_keys. Nothing to deploy."
  exit 0
fi
pin_sha=$pushed_sha
echo "Pinned $short_keys to $tag in $repo at $pin_sha"

wait_for_apps_run "$pin_sha"
case "$conclusion" in
  success)
    echo "Deployed $tag."
    ;;
  failure | timed_out)
    echo "The deploy of $tag failed. Setting the tags back."
    commit_edit restore_old_tags "Set $short_keys back after a failed deploy of $tag in $values

The Apps run for $pin_sha failed. Built from $source"
    if [[ -z $pushed_sha ]]; then
      die "The deploy of $tag failed. The tags were changed by someone else and left as is."
    fi
    die "The deploy of $tag failed. Set the tags back in $repo at $pushed_sha"
    ;;
  *)
    die "The Apps run for $pin_sha ended as $conclusion. The tags were left as is."
    ;;
esac
