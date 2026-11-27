## Version 0.1.0-alpha.2 - November 26th, 2026

### New Features

- #### Email signup

  Opt-in signup by email, off by default. Turn it on with `SIGNUP_ENABLED` and `AUTHENTICATION_ALLOW_SIGNUP`, and configure a mailer.

---

- #### Disable and remove organizations and apps

  A superuser can disable, remove and restore organizations. Administrators can disable, enable and remove apps.

---

- #### Plugin widget data

  Plugin widgets can query their endpoint with their own request body, accept file responses, and give the agent the rows they parsed.

### Bug Fixes and Improvements

- #### Widget export

  PDF, HTML and Markdown widgets export the original file. Widgets without their own export no longer offer a PNG screenshot.

---

- #### Plugin Settings dialog

  Uses the app's own controls, with searchable presets.

---

- #### Dependency updates

  Updated hono, @hono/node-server and poetry to resolve 16 Dependabot alerts, and SQLAlchemy to 2.1.

## Version 1.0.0 - October 7th, 2026

### New Features

- #### FINOS Workspace as an open source project

  The first release of the FINOS Workspace as an open source project, under the Apache License 2.0. Run all of it with `docker compose up`; the README says how.

---

- #### Dashboards and widgets

  Build dashboards from Markdown, HTML, iFrame, news feed and PDF viewer widgets, and from every widget that your own backends provide. Save a dashboard as an app and share it with others.

---

- #### Your own backends

  Connect any backend that serves `widgets.json` and `apps.json`.

---

- #### Agent and MCP

  Chat with the agent, add custom agents and MCP servers, and keep prompts and skills. Administrators set the daily queries and tokens of each user, and choose the models, MCP servers and tools that a role may use.

---

- #### Users, roles and entities

  Sign in with a password and an authenticator app, or with Google, Microsoft Entra ID or Okta. Administrators manage the users and roles of their organization, and a superuser manages entities with their seats, expiry and entitlements in the Admin area.
