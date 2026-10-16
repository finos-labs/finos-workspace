# Installation guide: the Workspace Docker image

## Prerequisites

- **Docker** installed and running ([Docker Desktop](https://www.docker.com/products/docker-desktop))
- **AWS CLI** installed ([installation guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html))
- **AWS credentials** provided by the image publisher (access key ID + secret access key)

You do not need an AWS account — the credentials provided only authorize pulling the Workspace container image.

The image publisher also gives you three values used below: `<region>` (the AWS region of the registry), `<registry>` (the registry host) and `<repository>` (the image repository name).

---

## Step 1 — Configure your credentials

```bash
aws configure --profile workspace-image
```

Enter the credentials provided by the image publisher:

```
AWS Access Key ID: <your access key ID>
AWS Secret Access Key: <your secret access key>
Default region name: <region>
Default output format: json
```

---

## Step 2 — Log in to the registry

The token expires every 12 hours — re-run this if you get an authentication error.

```bash
aws ecr get-login-password --region <region> --profile workspace-image | docker login --username AWS --password-stdin <registry>
```

Expected output: `Login Succeeded`

---

## Step 3 — Pull the image

```bash
docker pull <registry>/<repository>:latest
```

---

## Step 4 — Run the Workspace

```bash
docker run -d -p 3000:3000 -v workspace-data:/data -e WORKSPACE_ADMIN_EMAIL=<your-email> --name workspace <registry>/<repository>:latest
```

`WORKSPACE_ADMIN_EMAIL` is the address of the first administrator. The `-v workspace-data:/data` volume stores your data so it survives restarts and upgrades.

Open your browser and go to `http://localhost:3000`.

---

## Step 5 — Get your admin login

The first start creates the administrator with a random password and prints it once in the startup log:

```bash
docker logs workspace
```

Sign in at `http://localhost:3000` with your email and that password, and change the password: nothing keeps a copy of it. If you lose it, give the administrator a new one-time password, printed on your terminal only:

```bash
docker exec workspace credentials
```

The Workspace asks you to choose your own password when you sign in with it.

---

## Configuration (optional)

The Workspace runs with its defaults, so this step is optional. To change a setting of the web
app, pass its variable with `-e` on the `docker run` command. The variables are the `VITE_*`
ones of `frontend/.env`, which lists every setting with a comment and its default (for example
`VITE_AI_API_URL` for the AI service, `VITE_DOCS_URL` for the documentation site,
`VITE_UI_SHOW_MARKETPLACE=false` to hide the marketplace). Settings are read once at container
start: to change one, stop and remove the container and run it again with the new value.

```bash
docker run -d -p 3000:3000 -v workspace-data:/data --name workspace \
  -e WORKSPACE_ADMIN_EMAIL=<your-email> \
  -e VITE_UI_SHOW_MARKETPLACE=false \
  <registry>/<repository>:latest
```

> These settings adjust the interface and client-side behavior. They are not a
> security boundary: anything that must be strictly enforced is handled by the
> backend.

---

## Updating to a newer version

Your data lives in the `workspace-data` volume, so it survives the upgrade, and your password stays the one you chose. The explicit `docker pull` is required — Docker reuses the locally cached `latest` otherwise.

```bash
docker stop workspace && docker rm workspace
aws ecr get-login-password --region <region> --profile workspace-image | docker login --username AWS --password-stdin <registry>
docker pull <registry>/<repository>:latest
docker run -d -p 3000:3000 -v workspace-data:/data -e WORKSPACE_ADMIN_EMAIL=<your-email> --name workspace <registry>/<repository>:latest
```

---

## Troubleshooting

**`Login Succeeded` but `docker pull` fails with `denied`**
Your credentials do not have access to this repository. Contact the image publisher.

**`Error response from daemon: no matching manifest for linux/arm64`**
Add `--platform linux/amd64` to the pull and run commands:
```bash
docker pull --platform linux/amd64 <registry>/<repository>:latest
docker run --platform linux/amd64 -d -p 3000:3000 -v workspace-data:/data -e WORKSPACE_ADMIN_EMAIL=<your-email> --name workspace <registry>/<repository>:latest
```

**Port 3000 is already in use**
Map a different host port and name the address your browser opens — for example `-p 8080:3000 -e BACKEND_CORS_ORIGINS='["http://localhost:8080"]'` (then visit `http://localhost:8080`). The container always listens on 3000 internally; without the address, sign-in is refused.

**Authentication error after 12 hours**
ECR login tokens expire every 12 hours. Re-run the login command from Step 2.
