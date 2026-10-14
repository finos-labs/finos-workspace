#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: pin-dev-deploy.sh -r REPO -v VALUES -c SETTINGS -s SOURCE [-k KEYS -t TAG]

Deploys a develop build through the infra repository. In one commit to its main
branch, sets the image tag of each app in the environment's values file and
copies this repository's settings file to app-config.yaml next to it. The push
starts that repository's Apps workflow. Waits for the Apps run. If the run fails,
puts the tags and the settings back as they were and exits non-zero. Without
--keys, deploys the settings alone.

The settings are copied only when SOURCE's commit is the one the current
app-config.yaml came from or newer, so a slow build of an older commit never
replaces newer settings. That check reads this repository's history, so run the
script in a full clone (actions/checkout with fetch-depth: 0).

Options:
  -r, --repo REPO        infra repository, e.g. <owner>/<infrastructure-repository>
  -v, --values PATH      values file in that repository, e.g. <folder>/dev/apps/values.yaml
  -c, --config PATH      this repository's settings file for the environment, e.g. deploy/dev.yaml
  -s, --source REPO@SHA  the commit the images were built from and the settings come from
  -k, --keys KEYS        comma-separated top-level keys whose image.tag changes, e.g. backend,backendWorker
  -t, --tag TAG          the new image tag, required with --keys
  -h, --help             show this help

Environment:
  GH_TOKEN               token that can push to REPO and read its workflow runs
EOF
}

die() {
  echo "::error::$*" >&2
  exit 1
}

repo="" values="" config="" source="" keys="" tag=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -r | --repo) repo=${2:?missing value for $1}; shift 2 ;;
    -v | --values) values=${2:?missing value for $1}; shift 2 ;;
    -c | --config) config=${2:?missing value for $1}; shift 2 ;;
    -s | --source) source=${2:?missing value for $1}; shift 2 ;;
    -k | --keys) keys=${2:?missing value for $1}; shift 2 ;;
    -t | --tag) tag=${2:?missing value for $1}; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die "Unknown option: $1" ;;
  esac
done

[[ -n $repo && -n $values && -n $config && -n $source ]] || { usage >&2; die "--repo, --values, --config and --source are required"; }
[[ -n ${GH_TOKEN:-} ]] || die "GH_TOKEN is not set"
[[ -f $config ]] || die "No settings file at $config"
source_repo=${source%@*} commit=${source##*@}
[[ $commit =~ ^[0-9a-f]{40}$ && -n $source_repo && $source_repo != "$source" ]] || die "Invalid source, expected REPO@SHA: $source"
[[ $(git rev-parse --is-shallow-repository) == false ]] || die "This clone is shallow. Check out with fetch-depth: 0."
git cat-file -e "$commit^{commit}" 2>/dev/null || die "$commit is not in this clone"

key_list=()
if [[ -n $keys ]]; then
  [[ $tag =~ ^[A-Za-z0-9._-]+$ ]] || die "Invalid tag: $tag"
  IFS=, read -r -a key_list <<< "$keys"
  for key in "${key_list[@]}"; do
    [[ $key =~ ^[A-Za-z][A-Za-z0-9]*$ ]] || die "Invalid key: $key"
  done
fi

work=$(mktemp -d)
saved=$(mktemp -d)
trap 'rm -rf "$work" "$saved"' EXIT
git clone -q "https://x-access-token:${GH_TOKEN}@github.com/${repo}.git" "$work"
git -C "$work" config user.name "github-actions[bot]"
git -C "$work" config user.email "41898282+github-actions[bot]@users.noreply.github.com"
file="$work/$values"
settings_path="$(dirname "$values")/app-config.yaml"
settings_file="$work/$settings_path"

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

# The commit the current app-config.yaml was copied from, if it names one.
settings_commit() {
  [[ -f $settings_file ]] || return 0
  sed -n -E '1s/^# Copied from .*@([0-9a-f]{40}):.*$/\1/p' "$settings_file"
}

# Whether this commit may replace the current settings: they name no commit,
# this one, or one before it.
settings_are_older() {
  local current status=0
  current=$(settings_commit)
  [[ -n $current ]] || return 0
  git merge-base --is-ancestor "$current" "$commit" 2>/dev/null || status=$?
  case $status in
    0) return 0 ;;
    1) return 1 ;;
    *)
      echo "app-config.yaml was copied from $current, which is not in this repository's history. Replacing it."
      return 0
      ;;
  esac
}

# The infra chart reads the settings under appConfig.
write_settings() {
  {
    echo "# Copied from $source_repo@$commit:$config by"
    echo "# that repository's Deploy to dev workflow. Change the settings there: the"
    echo "# next deploy replaces this file."
    echo "appConfig:"
    sed -e 's/^\(.\)/  \1/' "$config"
  } > "$settings_file"
}

short_keys=${keys//,/, }

# What the last pin changed, for setting it back, and how to name it.
old_tags=()
settings_written="" settings_existed="" what=""
pin() {
  local i old
  old_tags=()
  for ((i = 0; i < ${#key_list[@]}; i++)); do
    old=$(get_tag "${key_list[$i]}")
    old_tags+=("$old")
    set_tag "${key_list[$i]}" "$tag"
  done
  settings_written="" settings_existed=""
  if settings_are_older; then
    if [[ -f $settings_file ]]; then
      settings_existed=1
      cp "$settings_file" "$saved/app-config.yaml"
    fi
    write_settings
    settings_written=1
  else
    echo "$settings_path has settings from a commit after $commit, so they are left as is."
  fi
  if [[ -n $keys && -n $settings_written ]]; then
    what="$short_keys at $tag and the app settings"
    message="Pin $short_keys to $tag and the app settings in $(dirname "$values")

Built from $source, with the app settings from its $config."
  elif [[ -n $keys ]]; then
    what="$short_keys at $tag"
    message="Pin $short_keys to $tag in $values

Built from $source."
  else
    what="the app settings"
    message="Set the app settings in $settings_path

From $config at $source."
  fi
}

# Everything the pin changed goes back together. If any of it has changed since,
# a later deploy has taken over, and all of it is left as is.
unpin() {
  local i current
  for ((i = 0; i < ${#key_list[@]}; i++)); do
    current=$(get_tag "${key_list[$i]}")
    if [[ $current != "$tag" ]]; then
      echo "${key_list[$i]} has $current instead of $tag, so $what are left as is."
      return 0
    fi
  done
  if [[ -n $settings_written && $(settings_commit) != "$commit" ]]; then
    echo "$settings_path has changed since, so $what are left as is."
    return 0
  fi
  for ((i = 0; i < ${#key_list[@]}; i++)); do
    set_tag "${key_list[$i]}" "${old_tags[$i]}"
  done
  if [[ -n $settings_written ]]; then
    if [[ -n $settings_existed ]]; then
      cp "$saved/app-config.yaml" "$settings_file"
    else
      rm -f "$settings_file"
    fi
  fi
  message="Set $what back after a failed deploy in $(dirname "$values")

The Apps run for $pin_sha failed. From $source"
}

# Applies an edit on top of the latest main and pushes it, starting over when
# another run pushed first. The edit sets message. Sets pushed_sha, or leaves it
# empty when the edit changes nothing.
pushed_sha="" message=""
commit_edit() {
  local edit=$1 attempt
  pushed_sha=""
  for attempt in 1 2 3 4 5; do
    git -C "$work" fetch -q origin main
    git -C "$work" reset -q --hard origin/main
    "$edit"
    git -C "$work" add -A -- "$values" "$settings_path"
    if git -C "$work" diff --cached --quiet; then
      return 0
    fi
    git -C "$work" commit -q -m "$message"
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

commit_edit pin
if [[ -z $pushed_sha ]]; then
  echo "$repo already has $what from $source. Nothing to deploy."
  exit 0
fi
pin_sha=$pushed_sha
echo "Pinned $what in $repo at $pin_sha"

wait_for_apps_run "$pin_sha"
case "$conclusion" in
  success)
    echo "Deployed $what."
    ;;
  failure | timed_out)
    echo "The deploy failed. Setting $what back."
    commit_edit unpin
    if [[ -z $pushed_sha ]]; then
      die "The deploy failed. Someone else has changed $what since, so they were left as is."
    fi
    die "The deploy failed. Set $what back in $repo at $pushed_sha"
    ;;
  *)
    die "The Apps run for $pin_sha ended as $conclusion. Left $what as is."
    ;;
esac
