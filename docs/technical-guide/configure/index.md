---
slug: /technical-guide/configure
title: Configuration overview
sidebar_position: 0
---

# Configuration overview

You configure FINOS Workspace with environment variables, one set for each kind of service, and a few files. This page shows which service reads what, which values have to match between services, and where to find the full lists.

## Where each service reads its settings

| Service | What it reads | On the local stack | Full table |
|---|---|---|---|
| API, worker and init step | Environment variables with the names of the settings, without a prefix and without regard to case. A setting without a default is required, and the process does not start without it. | `backend-api/backend/envs/.env` | [Backend settings](../../reference/configuration/backend.mdx) |
| The agent and its MCP server | Environment variables. The table says which of the two processes reads each one. | `agent/.env`, from the template `agent/.env.example` | [The agent and its MCP server](../../reference/configuration/agent.mdx) |
| Web app | The environment of its container, which nginx writes into `/config.js` each time that the container starts. A variable that is not set leaves its setting at the default, and a value that does not fit its type makes `/config.js` and `/healthz` answer with status 500. | The `environment` of the service `web` in `docker-compose.yml` | [Web app configuration](../../reference/configuration/web-app.mdx) |

A few settings of the web app are fixed when its image is built, such as the name of the app that people install on their devices. [White label](../white-label/index.md) lists them.

## Settings that must agree

| Setting | Must match |
|---|---|
| `SELFURL` of the API | `BACKEND_URL` of the web app and `WORKSPACE_PUBLIC_URL` of the agent: the API's public address. |
| `APPURL` and `FRONTENDURL` of the API | The web app's address. Its origin is also `WORKSPACE_ORIGIN` of the agent and one of the origins in `INES_CORS_ORIGINS`. |
| `BACKEND_CORS_ORIGINS` of the API | It includes the web app's origin, which the agent and its MCP server also send as `WORKSPACE_ORIGIN`. |
| `AI_API_URL` of the web app | The public address of the agent. |
| `WORKSPACE_AES_KEY` and `JWT_SECRET` | The same in every API and worker container. |
| `INES_METERING_TOKEN` of the agent | Signed with the API's `JWT_SECRET`. |
| `INES_SCOPE_SECRET` | The same in the agent and in its MCP server. |
| `REDIS_URL` of the agent and its MCP server | The Valkey server of the API, when they share state. |

[How to serve FINOS Workspace over HTTPS and set the addresses](../deploy/serve-over-https-and-cors.mdx) explains the addresses, and [Production setup](../deploy/production-setup.mdx#the-secrets-you-need-to-create) the secrets.

## Files

| File | Read by | Guide |
|---|---|---|
| `scripts/cfgs/config.toml` | The init step, which creates the first organization and administrators from it | [How to run database migrations](../deploy/run-database-migrations.mdx#prepare-a-first-deployment) |
| `user_create.json` | The API and the worker. The init step writes it, and `DEFAULT_USER_MAPPING` stands in for it where they cannot see it | [How to deploy on Kubernetes](../deploy/deploy-on-kubernetes.mdx#run-the-init-step) |
| A file that describes an organization | The script that provisions organizations | [How to provision an organization from a file](../deploy/provision-an-organization.mdx) |
| A theme stylesheet | The web app, at the address that `WL_STYLESHEET` gives | [Create a theme](../white-label/create-a-theme.md) |
| The certificates for the database | The API and the worker, at the paths that `SSL_CA`, `SSL_CERT` and `SSL_KEY` give | [How to connect FINOS Workspace to its database and cache](../deploy/connect-the-database-and-cache.md) |

## Settings by task

- The addresses, TLS and the origins that may call the API: [How to serve FINOS Workspace over HTTPS and set the addresses](../deploy/serve-over-https-and-cors.mdx).
- The database and Valkey: [How to connect FINOS Workspace to its database and cache](../deploy/connect-the-database-and-cache.md).
- Uploaded files: [How to choose where files are stored](../deploy/choose-file-storage.md).
- The agent's model: [How to choose the Agent's model and provider](choose-the-agent-model.mdx).
- The search of documents: [How to switch on the search of documents](enable-document-search.mdx).
- Dictation: [How to switch on dictation](enable-dictation.mdx).
- Single sign-on: [How to set up single sign-on](../deploy/set-up-single-sign-on.md).
- Several replicas of the agent: [How to run the agent on several replicas](../deploy/run-the-agent-on-several-replicas.mdx).
- Logs, metrics and traces: [How to ship logs and metrics](../deploy/ship-logs-and-metrics.mdx) and [How to export traces of the Agent](../deploy/export-traces.mdx).
- The brand: [White label](../white-label/index.md).
