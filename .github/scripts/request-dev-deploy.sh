#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: request-dev-deploy.sh -r REPO -e ENVIRONMENT -b BACKEND_REPOSITORY -f FRONTEND_REPOSITORY -c SETTINGS

Asks the infrastructure repository to deploy the dev environment, then waits for
the result. Run it on a full checkout of the branch to deploy. The message holds
what the deploy needs from this repository:
- the app settings, from SETTINGS
- the newest backend and frontend image: the latest commit on the branch whose
  image dev-<commit> is in the registry

Nothing is written to the infrastructure repository. The message is built from
the branch's latest state when it is sent, so the order in which builds finish
does not matter: the last message always describes the newest state.

If the Apps run is cancelled because another run replaced it, the script fails.
Run the job again to send a new message.

Options:
  -r, --repo REPO                infrastructure repository, e.g. <owner>/<infrastructure-repository>
  -e, --environment NAME         the environment's folder in it, e.g. BQ/dev
  -b, --backend-repository NAME  registry repository of the backend image, e.g. bq/backend
  -f, --frontend-repository NAME registry repository of the frontend image, e.g. bq/frontend
  -c, --settings PATH            this repository's settings file, e.g. deploy/dev.yaml
  -h, --help                     show this help

Environment:
  GH_TOKEN                token that can send a repository dispatch to REPO and read its workflow runs
  AWS credentials         that can describe images in the registry
  POLL_SECONDS            seconds between checks of the Apps run, default 15
  TIMEOUT_SECONDS         seconds to wait for the Apps run to finish, default 2100
EOF
}

die() {
  echo "::error::$*" >&2
  exit 1
}

repo="" environment="" backend_repository="" frontend_repository="" settings=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -r | --repo) repo=${2:?missing value for $1}; shift 2 ;;
    -e | --environment) environment=${2:?missing value for $1}; shift 2 ;;
    -b | --backend-repository) backend_repository=${2:?missing value for $1}; shift 2 ;;
    -f | --frontend-repository) frontend_repository=${2:?missing value for $1}; shift 2 ;;
    -c | --settings) settings=${2:?missing value for $1}; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die "Unknown option: $1" ;;
  esac
done

[[ -n $repo && -n $environment && -n $backend_repository && -n $frontend_repository && -n $settings ]] \
  || { usage >&2; die "All options are required"; }
[[ -n ${GH_TOKEN:-} ]] || die "GH_TOKEN is not set"
for tool in aws gh git jq yq; do
  command -v "$tool" > /dev/null || die "$tool is not installed"
done
[[ -f $settings ]] || die "No settings file at $settings"
[[ $(git rev-parse --is-shallow-repository) == false ]] || die "This clone is shallow. Check out with fetch-depth: 0."

tip=$(git rev-parse HEAD)

# The newest commit on the branch whose image dev-<commit> is in the registry.
# Only the commits a push builds are on the first-parent line.
newest_tag() {
  local repository=$1 tags sha
  tags=$(aws ecr describe-images --repository-name "$repository" --query 'imageDetails[].imageTags[]' --output text | tr '\t' '\n')
  while read -r sha; do
    if grep -q -x -F "dev-$sha" <<< "$tags"; then
      echo "dev-$sha"
      return 0
    fi
  done < <(git rev-list --first-parent -n 500 HEAD)
  die "No image of $repository is tagged dev-<commit> for one of the last 500 commits on this branch"
}

backend_tag=$(newest_tag "$backend_repository")
frontend_tag=$(newest_tag "$frontend_repository")
settings_json=$(yq -o=json '.' "$settings" | jq -c .)

digest() {
  if command -v sha256sum > /dev/null; then sha256sum; else shasum -a 256; fi
}

# The hash names the state, not the commit, so two jobs that send the same state
# share one Apps run.
payload=$(jq -n -c \
  --arg environment "$environment" \
  --arg backend_tag "$backend_tag" \
  --arg frontend_tag "$frontend_tag" \
  --arg source "${GITHUB_REPOSITORY:-local}@$tip" \
  --argjson settings "$settings_json" \
  '{environment: $environment, backend_tag: $backend_tag, frontend_tag: $frontend_tag, settings: $settings, source: $source}')
hash=$(jq -S -c 'del(.source)' <<< "$payload" | digest | cut -c1-12)
payload=$(jq -c --arg hash "$hash" '. + {hash: $hash}' <<< "$payload")

# Apps runs started by a message with this hash, newest first. They count from a
# minute before this script sent its own: an identical message sent a moment ago
# describes the same state.
runs() {
  gh run list --repo "$repo" --workflow apps.yml --event repository_dispatch --limit 30 \
    --json databaseId,displayTitle,status,conclusion,createdAt,url \
    | jq -c --arg hash "$hash" --argjson since "$since" '
        [ .[] | select((.displayTitle | endswith(" " + $hash)) and ((.createdAt | fromdateiso8601) >= $since)) ]
        | sort_by(.createdAt) | reverse'
}

since=$(( $(date -u +%s) - 60 ))
jq -n -c --argjson p "$payload" '{event_type: "deploy-dev", client_payload: $p}' \
  | gh api --method POST "repos/$repo/dispatches" --input - > /dev/null
echo "Asked $repo to deploy $environment: backend $backend_tag, frontend $frontend_tag (message $hash)."

started=$SECONDS
deadline=$((SECONDS + ${TIMEOUT_SECONDS:-2100}))
announced=""
while ((SECONDS < deadline)); do
  list=$(runs)
  run=$(jq -c '[.[] | select(.conclusion != "cancelled")] | first // empty' <<< "$list")
  if [[ -n $run ]]; then
    if [[ -z $announced ]]; then
      echo "Apps run: $(jq -r .url <<< "$run")"
      announced=1
    fi
    if [[ $(jq -r .status <<< "$run") == completed ]]; then
      conclusion=$(jq -r .conclusion <<< "$run")
      case "$conclusion" in
        success)
          echo "Deployed $environment."
          if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then
            {
              echo "### $environment"
              echo
              echo "- backend and worker image tag: $backend_tag"
              echo "- frontend image tag: $frontend_tag"
              echo "- settings: $settings at $tip"
            } >> "$GITHUB_STEP_SUMMARY"
          fi
          exit 0
          ;;
        failure | timed_out)
          die "The deploy of $environment failed. Helm has put the previous release back. See $(jq -r .url <<< "$run")"
          ;;
        *)
          die "The Apps run ended as $conclusion: $(jq -r .url <<< "$run")"
          ;;
      esac
    fi
  elif jq -e 'length > 0' <<< "$list" > /dev/null; then
    die "The Apps run was cancelled because another run replaced it. Run this job again if $environment is not on the latest build."
  elif ((SECONDS - started > 180)); then
    die "The Apps workflow did not start within 3 minutes. Check that .github/workflows/apps.yml in $repo, on its default branch, runs on repository_dispatch of type deploy-dev."
  fi
  sleep "${POLL_SECONDS:-15}"
done
die "The Apps run did not finish within ${TIMEOUT_SECONDS:-2100} seconds"
