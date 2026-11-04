import { readFileSync } from "node:fs";

export function localhostTls() {
  return {
    cert: readFileSync(new URL("./tls/certs/cert.pem", import.meta.url)),
    key: readFileSync(new URL("./tls/certs/key.pem", import.meta.url)),
  };
}
