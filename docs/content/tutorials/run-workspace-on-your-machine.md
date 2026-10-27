---
title: Run Workspace on your machine
sidebar_position: 1
---

# Run Workspace on your machine

In this lesson you start a complete Workspace on your own computer, set a password for its first administrator, and sign in. The stack that you start here is for trying Workspace and for development. It is not how you deploy Workspace: a deployment runs the same images on your own platform and sets the same variables through that platform's configuration.

When you finish, you will have the web app, the API, the background worker, the database and the AI agent running, and you will be signed in as an administrator.

## What you need

You need a clone of the repository and three tools on your computer:

- Docker with Docker Compose, to build and run the containers.
- Python 3, to run the script that writes the configuration.
- About 10 minutes for the first build, because the images are built from source.

## Create the configuration

Workspace needs secrets and addresses before it can start. A script writes all of them for you. Run it from the `backend-api/backend` directory of your clone, and give it the email address that the first administrator will use:

```bash
cd backend-api/backend
python3 -m scripts.create_local_env --admin-email <your-email>
cd ../..
```

The script writes four files that git does not track. It fills `backend-api/backend/envs/.env` with random keys and the addresses of the stack. It writes `backend-api/backend/scripts/cfgs/config.toml`, which names the organization and the administrator that the first start creates. It creates an empty `backend-api/backend/user_create.json` that the first start fills in, and it writes `agent/.env` with the settings of the AI agent. The script refuses to overwrite the first two files unless you pass `--force`.

The AI agent also needs a model. Open `agent/.env`, set `DEFAULT_MODEL` and the key of that model's provider, and save the file. The stack starts without them, but the Copilot then answers "No model is configured" and tells you to set `DEFAULT_MODEL`.

## Start the stack

From the root of the clone, build and start everything:

```bash
docker compose up --build
```

On a computer with Apple silicon, build for your own processor instead:

```bash
PLATFORM=linux/arm64 docker compose up --build
```

Compose builds the images and starts MySQL, Valkey, the API, the worker, the web app, the agent and its tools server. The first build takes several minutes. The stack is ready when `docker compose ps`, run in a second terminal, shows the API as healthy. The first start also creates the organization and the administrator that `config.toml` names. The administrator has no password yet.

You can now reach three addresses. The web app is on [http://localhost:3000](http://localhost:3000), the API is on [http://localhost:8000](http://localhost:8000) and the agent is on [http://localhost:7777](http://localhost:7777).

## Set the administrator's password

Open a second terminal in the root of the clone and run this command. It asks you to type the password twice, and it does not show what you type:

```bash
docker compose run --rm init python -m scripts.init_users --new-password <your-email>
```

Use the same email address that you gave to the script. Nothing prints, logs or stores the password in a file. You can run the command again at any time to set a new password, which ends every session of the account.

## Sign in

Open [http://localhost:3000](http://localhost:3000). Enter your email address and the password, and select Login. You arrive on the Apps page, which is empty because no backend is connected yet.

Look around before you continue. The sidebar on the left holds Apps, Connections, the Widgets and AI libraries, and your dashboards. Because you are an administrator, your account can also open the admin area at [http://localhost:3000/admin](http://localhost:3000/admin), which opens on the Users page. Its sidebar offers Users, Roles and Access, Entities, Widgets, Apps, Theme and Account.

## Stop the stack

Press `Ctrl+C` in the terminal that runs Compose, or run `docker compose down` in the root of the clone. This keeps your data, so the next `docker compose up` continues where you stopped. To remove the databases as well, run `docker compose down -v`.

## Where to go next

You now have a working Workspace to experiment with. [Web app configuration](../reference/configuration/web-app.mdx), [Backend settings](../reference/configuration/backend.mdx) and [Ines and its MCP server](../reference/configuration/agent.mdx) list every setting that you can change. To make the app look like your own, follow [How to design and apply a theme in the admin area](../how-to/customize/design-a-theme-in-the-admin-area.md).
