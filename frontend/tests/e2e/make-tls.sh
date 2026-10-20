#!/bin/sh
# TLS material for the end-to-end tests: a certificate authority made for the run
# (ca.pem) and a certificate it signs for one host name (cert.pem, key.pem). The
# authority's key is deleted once it has signed, so nothing else can be signed.
#
# - The stack's: `make-tls.sh tests/e2e/tls/certs localhost`, which the TLS front of
#   docker-compose.e2e.yml serves the web app, the API and Ines with.
# - The plugin proxy test's upstream (plugin-proxies.spec.ts):
#   `make-tls.sh <directory> proxy-upstream.e2e.test`, whose authority the API trusts
#   through WIDGET_PLUGIN_PROXY_CA_FILE.
#
# Usage: make-tls.sh <directory> <host name>
set -eu
dir="$1"
host="$2"
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
