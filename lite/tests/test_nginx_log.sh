#!/bin/bash
# Tests that the image's nginx keeps no query string in its access log: a query can carry a
# credential (the signature of a pre-signed file URL, an OAuth code). Runs nginx as the image
# does, from Debian's package on the image's base, with nginx.conf.template rendered the way
# entrypoint.sh renders it. Needs Docker:
#   bash lite/tests/test_nginx_log.sh
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BASE_IMAGE="${BASE_IMAGE:-python:3.13-slim}"

log="$(
  docker run --rm -v "$HERE/../nginx.conf.template:/etc/nginx/templates/default.conf.template:ro" \
    "$BASE_IMAGE" bash -c '
      set -euo pipefail
      apt-get update -qq >/dev/null
      apt-get install -qq --no-install-recommends -y nginx gettext-base >/dev/null 2>&1
      mkdir -p /usr/share/nginx/html && echo app > /usr/share/nginx/html/index.html
      PORT=3000 envsubst "\${PORT}" < /etc/nginx/templates/default.conf.template \
        > /etc/nginx/sites-available/default
      ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default
      nginx -t -q
      nginx
      python - <<PY
import urllib.error, urllib.request
for path, referer in [
    ("/api/app/files/presigned/a.pdf?Expires=1&Signature=SIGNED-SECRET", None),
    ("/oauth/callback?code=CODE-SECRET&state=STATE-SECRET", None),
    ("/api/app/user", "http://localhost:3000/oauth/callback?code=REFERER-SECRET"),
]:
    request = urllib.request.Request("http://127.0.0.1:3000" + path)
    if referer:
        request.add_header("Referer", referer)
    try:
        urllib.request.urlopen(request, timeout=5)
    except urllib.error.HTTPError:
        pass  # /api has no backend here; the line is logged all the same
PY
      nginx -s quit
      sleep 1
      cat /var/log/nginx/access.log
    '
)"

failures=0
fail() {
  echo "FAIL: $*" >&2
  failures=$((failures + 1))
}

printf '%s\n' "$log"
[[ "$(printf '%s\n' "$log" | grep -c .)" -eq 3 ]] || fail "expected one access log line per request"
printf '%s\n' "$log" | grep -q '"GET /api/app/files/presigned/a.pdf HTTP/1.1"' ||
  fail "the path of a request is not logged"
printf '%s\n' "$log" | grep -q '"http://localhost:3000/oauth/callback"' ||
  fail "the path of the Referer is not logged"
printf '%s\n' "$log" | grep -q 'SECRET' && fail "a query string reached the access log"
printf '%s\n' "$log" | grep -q '?' && fail "a query string reached the access log"

if ((failures)); then
  echo "$failures failure(s)" >&2
  exit 1
fi
echo "nginx access log: all tests passed"
