# Walkthrough

The manual check of section 9 of [`DEMOLITION-PLAN.md`](../../DEMOLITION-PLAN.md), run on 2026-10-07 against the
compose stack (`docker compose up`, fresh volumes, web app on 3000, admin panel on 3001, API on 8000). The data it
created was deleted by recreating the stack's volumes.

## What was checked, and what came out

| Step | How | Result |
| :-- | :-- | :-- |
| Sign in with a password | Playwright setup project (`frontend/tests/e2e/global.setup.ts`) | works |
| Connect a backend | Connections > Connect Backend, name and `http://localhost:9000`, Test, Add | "4 Widgets found", then listed with its 4 widgets and 1 app |
| One widget of each kept type | Dashboard > Add widgets: the four backend widgets, Iframe, Navigation Bar, RSS / Atom Feed | Markdown text, HTML report in a sandboxed frame, PDF page on a canvas, the backend's iFrame page, the Iframe widget's "No URL" prompt, and the RSS reader with its entry (the feed survives a reload) |
| Create a user | Admin > Users > Add users | listed as Verified and Active |
| Create a role | Admin > Roles and Access > Create new role | listed |
| Marketplace listing | My Apps > the app card's menu > List app to marketplace: vendor profile, app details, the three previews, Submit App; then Admin > Marketplace > the row > Re-verify > Publish | "Submitted for review", then "App published"; the app shows as Live in Apps Marketplace and as published in the admin list |
| 13 pages | [`crawl.mjs`](crawl.mjs) | no console errors, page errors or failed requests |
| SSO buttons | the page's `/config.js` answered with the three providers configured with test values | "Sign in with Google", "Sign in with Microsoft" and "Sign in with Okta" render and start their flows; a real sign-in needs the provider's credentials and was not run |
| MCP token gate | sign in, create a token, `tools/list` and `tools/call` on `/mcp`, revoke, call again | 200 with 18 tools; the tool call answers 200 with `unavailable` (no browser connected); after the revoke, 401 |

## Reproducing it

1. Start the throwaway backend: `cd demolition/walkthrough/backend && pip install fastapi uvicorn && uvicorn main:app --port 9000`.
2. Connect it as above. For the marketplace step the API container has to reach the same URL on its own
   `localhost`, so run a second copy in the API container's network namespace:
   `docker run -d --network container:workspace-api-1 -v "$PWD/demolition/walkthrough/backend:/walk" -w /walk --entrypoint python workspace-api:local -m uvicorn main:app --port 9000`.
   Publishing is refused until a Re-verify has succeeded.
3. Run the crawl from `frontend/`: see the header of [`crawl.mjs`](crawl.mjs).

## Things the walkthrough taught

- A new API login ends the user's other app sessions, so a browser session saved earlier stops working (401 on every
  page). Run the Playwright setup project again.
- Button labels are cased by CSS: the submit button of the Connect backend dialog is the text `add`, and the
  Playwright role name does not match "Add".
- `VITE_OKTA_DOMAIN` is the full issuer URL, for example `https://<your-okta-domain>/oauth2/default`.
- The backend widgets of the throwaway backend log three 404s (`agents.json`, `templates.json` and, before an
  `apps.json` is added, `apps.json`): those files are optional.
