import { readFileSync } from "node:fs";

/**
 * The stack's certificate for localhost, which make-tls.sh made in tls/certs: the backends
 * the web app fetches from the browser serve HTTPS with it, as a deployment's do. A page on
 * HTTPS may not fetch http://localhost in WebKit (Chromium and Firefox allow loopback).
 */
export function localhostTls() {
  return {
    cert: readFileSync(new URL("./tls/certs/cert.pem", import.meta.url)),
    key: readFileSync(new URL("./tls/certs/key.pem", import.meta.url)),
  };
}
