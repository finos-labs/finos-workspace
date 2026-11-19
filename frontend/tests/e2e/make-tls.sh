#!/bin/sh
set -eu
dir="$1"
host="$2"
shift 2
# Any further arguments are extra names for the certificate, such as *.sandbox.localhost.
names="DNS:$host"
for extra in "$@"; do
  names="$names,DNS:$extra"
done
mkdir -p "$dir"
cd "$dir"

openssl req -x509 -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 2 \
  -subj "/CN=FINOS Workspace end-to-end CA" -keyout ca.key -out ca.pem \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -addext "subjectKeyIdentifier=hash" 2>/dev/null

openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
  -subj "/CN=$host" -keyout key.pem -out cert.csr 2>/dev/null
printf '%s\n' \
  "basicConstraints=critical,CA:FALSE" \
  "keyUsage=critical,digitalSignature" \
  "extendedKeyUsage=serverAuth" \
  "subjectAltName=$names" \
  "subjectKeyIdentifier=hash" \
  "authorityKeyIdentifier=keyid" > cert.ext
openssl x509 -req -in cert.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 2 \
  -extfile cert.ext -out cert.pem 2>/dev/null

rm -f ca.key ca.srl cert.csr cert.ext
chmod 644 ca.pem cert.pem
chmod 600 key.pem
