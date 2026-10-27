---
title: Abuse cases and their tests
sidebar_position: 8
---

# Abuse cases and their tests

This page lists the abuse cases that the plugin runtime defends against. For each case it names the defense and the test that checks it. The Playwright specs generate their packages into a temporary plugins directory, and they run in Chromium, Firefox and WebKit. [About the widget plugin security model](../../explanation/widget-plugin-security.md) explains the reasoning behind the defenses.

| Abuse | Defense | Test |
|---|---|---|
| Read the parent or top document, `window.opener`, storage or cookies; `window.open`, top navigation, `alert`; `eval` | Opaque origin, sandbox, policy | `plugins.spec.ts`, plugin-cannot-leave-its-frame |
| `fetch`, WebSocket, `sendBeacon`, images and remote `import` to any host, from the frame and from nested and `data:` workers | Policy, in workers too | `plugins.spec.ts`, plugin-cannot-leave-its-frame and plugin-policy-violations-reach-the-administrator |
| Forged host messages through `window.postMessage`; a write to an undeclared param | The host ignores window messages; the authority | `plugins.spec.ts`, plugin-cannot-leave-its-frame |
| An ungranted or unknown command, `core:mcp:call`, reading the widget's `mcp_tool`, a `javascript:` link, markup in a notice, prototype pollution | Authority, host-only link, plain text, separate realm | `plugins.spec.ts`, plugin-cannot-leave-its-frame |
| Forged violation events; requests to 250 origins | `isTrusted`; caps; text only | `plugin-admin-journey.spec.ts` |
| Messages outside the protocol; protocol violations | Schema; three in ten seconds end the frame | `frame.test.ts`, `authority.test.ts` |
| A frame document with more than the shell, or without its policy first | The document's shape; the canary | `frame.test.ts`, `shell.conformance.test.ts` |
| Symbolic links, odd names, too many or too large files, an id or version unlike its directory, a wrong checksum or pin, a served path outside the version, `backend/` served | Discovery and file delivery | `test_widget_plugin_rules.py` |
| Policy sources that are too broad, private or insecure, with and without confirmations | The validator | `csp-cases.json`, in `csp.test.ts` and `test_widget_plugin_rules.py` |
| An organization admin approves or sets a secret; a role of another organization grants access | Authorization | `test_widget_plugins_api.py`, `test_widget_plugin_server_side.py` |
| A file edited after approval; a new version; a version whose files changed before approval; an old digest | Re-hash on serving; explicit approval bound to the reviewed digest | `test_widget_plugins_api.py`, `plugin-admin-journey.spec.ts` |
| A route that uploads or writes plugin files | None exists | `test_widget_plugins_api.py` |
| A proxy aimed at a private or metadata address, a name that resolves to several addresses or changes, a bad certificate; arguments or secrets outside their places | Template rules and the outbound guard | `test_widget_plugin_proxies.py` |
| Reading a secret from the frame or the page; calls after narrowing or revoking; calls by users without access | Server-side secrets; availability on every call | `test_widget_plugin_server_side.py`, `plugin-proxies.spec.ts` |
| A backend that reads data the user may not read, with a forged, changed or expired token, or after a version change | Token, broker and identity check | `test_widget_plugin_backends.py`, `plugin-backends.spec.ts` |
| A widget that cites another backend's MCP server as its own | The link resolves against its own backend | `backendConnector.invalidItems.test.ts`, `mcpLink.test.ts` |

Four things have no automated test. They are a frame that navigates itself, the watchdog that ends a frozen frame, two frames that claim each other's port, and the host refusing bytes whose digest differs. The server's refusal of such bytes is tested. The isolation of a backend container has no test either, because the deployer provides it.
