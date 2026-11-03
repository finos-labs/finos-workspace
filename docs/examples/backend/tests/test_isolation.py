import json
import os
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

import pytest
from identity import version_digest

ROOT = Path(__file__).resolve().parent.parent
PLUGINS = {name: ROOT.parent / name for name in ("sql-explorer", "ag-grid")}
VERSIONS = {name: json.loads((path / "package.json").read_text(encoding="utf-8"))["version"] for name, path in PLUGINS.items()}
BUILT = {name: path / "dist" / name / VERSIONS[name] for name, path in PLUGINS.items()}
REACH = (ROOT / "reach.py").read_text(encoding="utf-8")
BASE = next(line.split()[1] for line in (ROOT / "Dockerfile").read_text().splitlines() if line.startswith("FROM "))


def _docker() -> bool:
    if not shutil.which("docker"):
        return False
    return subprocess.run(["docker", "info"], capture_output=True).returncode == 0


pytestmark = [
    pytest.mark.skipif(not _docker(), reason="no Docker"),
    pytest.mark.skipif(not all(path.is_dir() for path in BUILT.values()), reason="the packages are not built"),
]

INSPECT_SELF = """
import json, os, subprocess

def write(path):
    try:
        with open(path, "w") as file:
            file.write("#!/bin/sh\\n")
        return "written"
    except OSError as error:
        return error.strerror

def run(path):
    try:
        os.chmod(path, 0o755)
        subprocess.run([path], check=True)
        return "ran"
    except OSError as error:
        return error.strerror

status = dict(line.split(":\\t", 1) for line in open("/proc/self/status").read().splitlines() if ":\\t" in line)
print(json.dumps({
    "uid": os.getuid(),
    "package": write("/opt/plugins/sql-explorer/backend/planted.py"),
    "data": write("/data/planted.csv"),
    "tmp": write("/tmp/planted.sh"),
    "tmp_exec": run("/tmp/planted.sh"),
    "capabilities": status["CapEff"].strip(),
    "no_new_privileges": status["NoNewPrivs"].strip(),
}))
"""

API = """
from http.server import BaseHTTPRequestHandler, HTTPServer

class Api(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"api")

HTTPServer(("", 8000), Api).serve_forever()
"""

FETCH = """
import sys, urllib.error, urllib.request

for url in sys.argv[1:]:
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            print(response.status, response.read().decode())
    except urllib.error.HTTPError as error:
        print(error.code, "")
"""


def _run(args: list[str], **options) -> str:
    done = subprocess.run(args, capture_output=True, text=True, **options)
    assert done.returncode == 0, f"{' '.join(args[:5])}: {done.stderr[-4000:]}"
    return done.stdout


class Stack:
    def __init__(self, directory: Path):
        self.name = f"examples-isolation-{uuid.uuid4().hex[:8]}"
        self.network = f"{self.name}-workspace"
        self.image = f"{self.name}-backend:test"
        self.api = f"{self.name}-api"
        self.examples = directory / "backend"
        shutil.copytree(ROOT, self.examples, ignore=shutil.ignore_patterns("secrets", ".env", "tests", "__pycache__", ".pytest_cache"))
        for name, built in BUILT.items():
            shutil.copytree(built, directory / name / "dist" / name / VERSIONS[name])
        override = self.examples / "isolation.yaml"
        override.write_text(
            f"services:\n  backend:\n    image: {self.image}\n  examples-gateway:\n    ports: !reset []\n",
            encoding="utf-8",
        )
        files = ["-f", str(self.examples / "compose.yaml"), "-f", str(override)]
        self.compose = ["docker", "compose", "-p", self.name, *files]
        self.env = {
            **os.environ,
            "SQL_EXPLORER_VERSION": VERSIONS["sql-explorer"],
            "AG_GRID_VERSION": VERSIONS["ag-grid"],
            "WORKSPACE_NETWORK": self.network,
        }

    def up(self) -> None:
        _run([sys.executable, str(self.examples / "setup.py")])
        _run(["docker", "network", "create", self.network])
        api = ["--name", self.api, "--network", self.network, "--network-alias", "api"]
        _run(["docker", "run", "-d", *api, BASE, "python", "-c", API])
        _run([*self.compose, "up", "-d", "--build", "--wait"], env=self.env)

    def down(self) -> None:
        subprocess.run(["docker", "rm", "-f", self.api], capture_output=True)
        subprocess.run([*self.compose, "down", "-v", "--remove-orphans"], env=self.env, capture_output=True)
        subprocess.run(["docker", "network", "rm", self.network], capture_output=True)
        subprocess.run(["docker", "image", "rm", self.image], capture_output=True)

    def container(self, service: str) -> str:
        return _run([*self.compose, "ps", "-q", service], env=self.env).strip()

    def python(self, container: str, script: str, *args: str) -> str:
        return _run(["docker", "exec", "-i", container, "python", "-", *args], input=script)

    def reach(self, container: str, *targets: str) -> dict[str, str]:
        lines = self.python(container, REACH, *targets).splitlines()
        return dict(line.split(": ", 1) for line in lines)


@pytest.fixture(scope="module")
def stack(tmp_path_factory):
    deployed = Stack(tmp_path_factory.mktemp("isolation"))
    try:
        deployed.up()
        backend = deployed.container("backend")
        deadline = time.monotonic() + 60
        while deployed.reach(backend, "postgres:5432")["postgres:5432"] != "open":
            assert time.monotonic() < deadline, "Postgres did not start"
            time.sleep(1)
        yield deployed
    finally:
        deployed.down()


def test_the_backend_reaches_its_database_and_gateway_and_nothing_else(stack):
    reached = stack.reach(
        stack.container("backend"),
        "postgres:5432",
        "examples-gateway:8081",
        "examples-gateway:8082",
        "api:8000",
        "1.1.1.1:443",
    )
    assert reached["postgres:5432"] == "open"
    assert reached["examples-gateway:8081"] == "open"
    assert reached["examples-gateway:8082"] == "open"
    assert reached["api:8000"] == "closed (gaierror)"
    assert reached["1.1.1.1:443"].startswith("closed")


def test_the_workspace_side_reaches_the_gateway_and_not_the_backend_or_database(stack):
    reached = stack.reach(
        stack.api, "api:8000", "examples-gateway:8081", "examples-gateway:8082", "backend:8080", "postgres:5432"
    )
    assert reached == {
        "api:8000": "open",
        "examples-gateway:8081": "open",
        "examples-gateway:8082": "open",
        "backend:8080": "closed (gaierror)",
        "postgres:5432": "closed (gaierror)",
    }


def test_the_gateway_forwards_only_the_workspace_routes_and_nothing_back(stack):
    forwarded = stack.python(
        stack.api,
        FETCH,
        "http://examples-gateway:8081/.workspace/identity",
        "http://examples-gateway:8082/.workspace/identity",
        "http://examples-gateway:8081/",
        "http://examples-gateway:8082/plugins/ag-grid/.workspace/identity",
    ).splitlines()
    for line, name in ((forwarded[0], "sql-explorer"), (forwarded[1], "ag-grid")):
        status, body = line.split(" ", 1)
        assert status == "200"
        assert json.loads(body) == {
            "plugin": name,
            "version": VERSIONS[name],
            "digest": version_digest(BUILT[name]),
            "protocol": 1,
        }
    assert forwarded[2:] == ["404 ", "404 "]
    assert stack.python(stack.api, FETCH, "http://api:8000/internal/plugin-broker/data/any") == "200 api\n"
    back = stack.python(
        stack.container("backend"),
        FETCH,
        "http://examples-gateway:8081/internal/plugin-broker/data/any",
        "http://examples-gateway:8081/app/widget-plugins",
        "http://examples-gateway:8081/",
    ).splitlines()
    assert back == ["404 ", "404 ", "404 "]


def test_the_gateway_publishes_the_data_routes_and_keeps_the_workspace_routes_off_them(stack):
    served = stack.python(
        stack.api,
        FETCH,
        "http://examples-gateway:7798/widgets.json",
        "http://examples-gateway:7798/.workspace/identity",
        "http://examples-gateway:7798/.workspace/routes/postgres_query",
        "http://examples-gateway:8081/widgets.json",
        "http://examples-gateway:8081/plotly/sales",
    ).splitlines()
    status, body = served[0].split(" ", 1)
    assert status == "200"
    assert {"plotly_sales", "grid_explicit", "plotly_sql", "grid_live", "grid_ssrm"} <= set(json.loads(body))
    assert served[1:] == ["404 ", "404 ", "404 ", "404 "]


def test_the_backend_runs_unprivileged_on_a_read_only_filesystem(stack):
    backend = stack.container("backend")
    inside = json.loads(stack.python(backend, INSPECT_SELF))
    assert inside == {
        "uid": 65534,
        "package": "Read-only file system",
        "data": "Read-only file system",
        "tmp": "written",
        "tmp_exec": "Permission denied",
        "capabilities": "0000000000000000",
        "no_new_privileges": "1",
    }
    container = json.loads(_run(["docker", "inspect", backend]))[0]
    host = container["HostConfig"]
    assert container["Config"]["User"] == "65534:65534"
    assert host["ReadonlyRootfs"] is True
    assert host["Privileged"] is False
    assert host["CapDrop"] == ["ALL"]
    assert not host["CapAdd"]
    assert "no-new-privileges:true" in host["SecurityOpt"]
    assert host["Memory"] == 512 * 1024 * 1024
    assert host["PidsLimit"] == 128
    assert host["Tmpfs"] == {"/tmp": "size=64m,noexec,nosuid"}
    assert container["Mounts"] == []
    assert set(container["NetworkSettings"]["Networks"]) == {f"{stack.name}_plugin-rpc", f"{stack.name}_plugin-db"}
