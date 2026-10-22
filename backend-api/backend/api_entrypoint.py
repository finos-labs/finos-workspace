"""The API image's command (fastapi.Dockerfile): applies the database migrations, then hands
the process to the API (run.py), whose gunicorn runs and replaces its workers. The image has
no shell, so this is Python."""

import os
import subprocess  # noqa: S404
import sys

print("\nStep 1: Running database migrations...", flush=True)  # noqa: T201
migrations = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=False)  # noqa: S603 (fixed arguments)
if migrations.returncode != 0:
    print("❌ Database migrations failed", flush=True)  # noqa: T201
    sys.exit(1)
print("✅ Database migrations completed successfully", flush=True)  # noqa: T201

print("\nStep 2: Starting the API...", flush=True)  # noqa: T201
print("✅ All initialization steps completed. Starting application services...", flush=True)  # noqa: T201
os.execv(sys.executable, [sys.executable, "run.py"])  # noqa: S606 (fixed arguments)
