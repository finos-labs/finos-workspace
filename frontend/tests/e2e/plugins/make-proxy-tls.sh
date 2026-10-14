#!/bin/sh
# The TLS material of the plugin proxy test (tests/e2e/plugin-proxies.spec.ts): a
# certificate authority made for the run, which the API trusts through
# WIDGET_PLUGIN_PROXY_CA_FILE, and a certificate it signs for the test upstream's name.
# The authority's key is deleted once it has signed, so nothing else can be signed.
#
# Usage: make-proxy-tls.sh <directory> [<host name>]
set -eu
dir="$1"
host="${2:-proxy-upstream.e2e.test}"
mkdir -p "$dir"
cd "$dir"

openssl req -x509 -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 2 \
  -subj "/CN=Workspace end-to-end CA" -keyout ca.key -out ca.pem \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -addext "subjectKeyIdentifier=hash" 2>/dev/null

openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
  -subj "/CN=$host" -keyout key.pem -out cert.csr 2>/dev/null
printf '%s\n' \
  "basicConstraints=critical,CA:FALSE" \
  "keyUsage=critical,digitalSignature" \
  "extendedKeyUsage=serverAuth" \
  "subjectAltName=DNS:$host" \
  "subjectKeyIdentifier=hash" \
  "authorityKeyIdentifier=keyid" > cert.ext
openssl x509 -req -in cert.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 2 \
  -extfile cert.ext -out cert.pem 2>/dev/null

rm -f ca.key ca.srl cert.csr cert.ext
chmod 644 ca.pem cert.pem
chmod 600 key.pem
