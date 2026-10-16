#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: newest-images.sh -b BACKEND_REPOSITORY -f FRONTEND_REPOSITORY

Prints the newest backend and frontend image tag of the branch that is checked
out, as backend=TAG and frontend=TAG lines (the format of $GITHUB_OUTPUT). The
newest image is the one of the latest commit on the branch whose image
dev-<commit> is in the registry, so a build that finishes late never replaces a
newer one. Run it on a full checkout (fetch-depth: 0), with AWS credentials that
can describe the images.

Options:
  -b, --backend-repository NAME   registry repository of the backend image, e.g. bq/backend
  -f, --frontend-repository NAME  registry repository of the frontend image, e.g. bq/frontend
  -h, --help                      show this help
EOF
}

die() {
  echo "::error::$*" >&2
  exit 1
}

backend_repository="" frontend_repository=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -b | --backend-repository) backend_repository=${2:?missing value for $1}; shift 2 ;;
    -f | --frontend-repository) frontend_repository=${2:?missing value for $1}; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die "Unknown option: $1" ;;
  esac
done

[[ -n $backend_repository && -n $frontend_repository ]] || { usage >&2; die "Both options are required"; }
for tool in aws git; do
  command -v "$tool" > /dev/null || die "$tool is not installed"
done
[[ $(git rev-parse --is-shallow-repository) == false ]] || die "This clone is shallow. Check out with fetch-depth: 0."

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

backend=$(newest_tag "$backend_repository")
frontend=$(newest_tag "$frontend_repository")
echo "backend=$backend"
echo "frontend=$frontend"
