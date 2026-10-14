"""The plugin runner's sandbox on Linux (docs/widget-plugins/SERVER-SIDE.md 5.4, recipe B):
a real runner starts a probe backend, and the probe reports from inside what it can and
cannot do. The runner needs to create namespaces, so these tests run as root in a container
started the way the single image is (lite/plugin-runner-seccomp.json), and only when
PLUGIN_RUNNER_SANDBOX is set:

    docker run --rm --security-opt seccomp=lite/plugin-runner-seccomp.json \\
      -e PLUGIN_RUNNER_SANDBOX=1 -v "$PWD/backend-api/backend:/code:ro" -w /code python:3.13-slim \\
      sh -c 'pip install -q pytest pydantic httpx && python -m pytest -p no:cacheprovider \\
             --noconftest -c /dev/null --rootdir /code tests/test_plugin_runner_sandbox.py'

With PLUGIN_RUNNER_SANDBOX=refused (a container without that profile) they check instead
that the runner refuses to start the backend and says which layer is missing.
"""

import grp
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import textwrap
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

MODE = os.environ.get("PLUGIN_RUNNER_SANDBOX", "")
pytestmark = pytest.mark.skipif(
    not (MODE and sys.platform == "linux" and os.geteuid() == 0),
    reason="a Linux container, as root, with PLUGIN_RUNNER_SANDBOX set",
)

CODE = Path(__file__).resolve().parents[1]
PLUGIN = "runner-probe"
UPSTREAM_NAME = "upstream.runner.test"
LOOPBACK_NAME = "loopback.runner.test"

# The backend: stdlib only, served on the unix socket the runner gives it. Its one route
# tries what a backend must not be able to do and reports each outcome.
PROBE = textwrap.dedent(
    r"""
    import ctypes, errno, json, os, resource, socket, sys, urllib.request
    from http.server import BaseHTTPRequestHandler, HTTPServer
    from socketserver import UnixStreamServer

    def outcome(fn):
        try:
            value = fn()
            return "allowed" if value is None else value
        except socket.gaierror:
            return "gaierror"
        except OSError as error:
            return errno.errorcode.get(error.errno, str(error.errno))
        except Exception as error:
            return type(error).__name__

    libc = ctypes.CDLL(None, use_errno=True)

    def identity():
        # No /proc in the sandbox: what the kernel says through prctl and capget
        capget = {"aarch64": 90, "x86_64": 125}[os.uname().machine]
        header = ctypes.create_string_buffer(b"\x22\x05\x08\x20" + bytes(4), 8)
        sets = ctypes.create_string_buffer(24)
        if libc.syscall(capget, header, sets) != 0:
            raise OSError(ctypes.get_errno(), "capget")
        bounding = [cap for cap in range(64) if libc.prctl(23, cap, 0, 0, 0) == 1]  # PR_CAPBSET_READ
        return {
            "capabilities": sets.raw.hex(),
            "bounding": bounding,
            "no_new_privs": libc.prctl(39, 0, 0, 0, 0),  # PR_GET_NO_NEW_PRIVS
            "seccomp": libc.prctl(21, 0, 0, 0, 0),  # PR_GET_SECCOMP
        }

    def connect(host, port):
        s = socket.create_connection((host, port), timeout=5)
        s.sendall(b"GET / HTTP/1.0\r\nHost: x\r\n\r\n")
        # Until the server closes: the head and the body can come through the relays apart
        data = b""
        while chunk := s.recv(1000):
            data += chunk
        s.close()
        return data.decode(errors="replace").split("\r\n")[-1] or "closed"

    def run_from_tmp():
        path = "/tmp/run.sh"
        with open(path, "w") as f:
            f.write("#!/bin/sh\necho ran\n")
        os.chmod(path, 0o755)
        child = os.fork()
        if child == 0:
            try:
                os.execv(path, [path])
            except OSError as error:
                os._exit(error.errno)
        code = os.waitstatus_to_exitcode(os.waitpid(child, 0)[1])
        if code:
            raise OSError(code, "exec")

    def mount_tmp():
        if libc.mount(b"tmpfs", b"/tmp", b"tmpfs", 0, None) != 0:
            raise OSError(ctypes.get_errno(), "mount")

    def probe():
        return {
            "uid": os.getuid(),
            **identity(),
            "hostname": socket.gethostname(),
            "list_root": outcome(lambda: os.listdir("/") and None),
            "exists": {path: os.path.exists(path) for path in (
                "/usr", "/plugin/plugin.json", "/data", "/tmp", "/opt", "/srv", "/var", "/root", "/home",
                "/run/wsr-test", "/run/workspace/egress", "/etc/shadow", "/etc/os-release", "/proc", "/sys",
            )},
            "etc": sorted(os.listdir("/etc")),
            "dev": sorted(os.listdir("/dev")),
            "passwd": open("/etc/passwd").read().split(":")[0],
            "data": sorted(os.listdir("/data")),
            "write_package": outcome(lambda: open("/plugin/plugin.json", "a").close()),
            "write_usr": outcome(lambda: open("/usr/probe", "w").close()),
            "write_data": outcome(lambda: open("/data/probe", "w").close()),
            "read_init_environ": outcome(lambda: open("/proc/1/environ").read() and None),
            "exec_tmp": outcome(run_from_tmp),
            "container_loopback": outcome(lambda: connect("127.0.0.1", int(sys.argv[2]))),
            "outside": outcome(lambda: socket.create_connection(("8.8.8.8", 53), timeout=3).close()),
            "dns": outcome(lambda: socket.getaddrinfo("example.com", 443) and None),
            "egress": outcome(lambda: connect("upstream.runner.test", int(sys.argv[3]))),
            "egress_to_loopback": outcome(lambda: connect("loopback.runner.test", int(sys.argv[2]))),
            "unapproved_port": outcome(lambda: socket.create_connection(("upstream.runner.test", 9), timeout=3).close()),
            "unshare": outcome(lambda: os.unshare(0x10000000)),
            "mount": outcome(mount_tmp),
            "netlink": outcome(lambda: socket.socket(socket.AF_NETLINK, socket.SOCK_RAW, 0).close()),
            "nproc": resource.getrlimit(resource.RLIMIT_NPROC)[0],
            "nofile": resource.getrlimit(resource.RLIMIT_NOFILE)[0],
            "address_space_mb": resource.getrlimit(resource.RLIMIT_AS)[0] // (1024 * 1024),
            "environment": sorted(os.environ),
        }

    class Handler(BaseHTTPRequestHandler):
        def address_string(self):
            return "api"

        def log_message(self, *args):
            pass

        def answer(self, body):
            data = json.dumps(body).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            self.answer({"plugin": "runner-probe", "path": self.path})

        def do_POST(self):
            self.rfile.read(int(self.headers.get("Content-Length") or 0))
            self.answer(probe())

    class Server(UnixStreamServer, HTTPServer):
        def server_bind(self):
            UnixStreamServer.server_bind(self)
            self.server_name, self.server_port = "backend", 0

    Server(sys.argv[1], Handler).serve_forever()
    """
)


class Upstream(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 - http.server's name
        body = b"upstream ok"
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def serve(address: str) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((address, 0), Upstream)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def http(path: str, method: str, target: str, body: bytes = b"") -> tuple[int, bytes]:
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
        s.settimeout(30)
        s.connect(path)
        head = f"{method} {target} HTTP/1.1\r\nHost: backend\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n"
        s.sendall(head.encode() + body)
        data = b""
        while chunk := s.recv(65536):
            data += chunk
    head, _, payload = data.partition(b"\r\n\r\n")
    return int(head.split(b" ")[1]), payload


@pytest.fixture(scope="module")
def deployment():
    from tests.fixtures.runner_packages import write_backend_package

    # Not under /tmp, which never goes into a sandbox
    base = Path("/srv/runner-test")
    shutil.rmtree(base, ignore_errors=True)
    base.mkdir(parents=True)
    plugins = base / "plugins"
    _, digest = write_backend_package(plugins, PLUGIN, "1.0.0", {"backend/probe.py": PROBE.encode()})
    os.chmod(base, 0o755)  # noqa: S103 - the backend's own uid reads its package
    for path in plugins.rglob("*"):
        os.chmod(path, 0o755 if path.is_dir() else 0o644)
    data = base / "files"
    data.mkdir()
    (data / "sales.csv").write_text("region,sales\nemea,10\n")
    os.chmod(data, 0o755)  # noqa: S103 - and its data

    # The container's own services listen on loopback; an approved host listens beside them
    own = serve("127.0.0.1")
    address = socket.gethostbyname(socket.gethostname())
    upstream = serve(address)
    hosts = Path("/etc/hosts")
    original = hosts.read_text()
    hosts.write_text(original + f"\n{address} {UPSTREAM_NAME}\n127.0.0.1 {LOOPBACK_NAME}\n")

    socket_dir = Path("/run/wsr-test")
    config = base / "runner.toml"
    config.write_text(
        textwrap.dedent(
            f"""
            plugins_dir = "{plugins}"
            socket_dir = "{socket_dir}"
            api_group = "{grp.getgrgid(0).gr_name}"

            [backends.{PLUGIN}]
            version = "1.0.0"
            digest = "{digest}"
            command = [
                "{sys.executable}", "/plugin/backend/probe.py", "{{socket}}",
                "{own.server_port}", "{upstream.server_port}",
            ]
            readonly = [{{ source = "{data}", target = "/data" }}]
            network = ["tcp://{UPSTREAM_NAME}:{upstream.server_port}", "tcp://{LOOPBACK_NAME}:{own.server_port}"]
            environment = {{ PROBE_SETTING = "on" }}
            memory_mb = 512
            processes = 64
            files = 256
            """
        )
    )
    runner = subprocess.Popen(  # noqa: S603 - the runner under test
        [sys.executable, "-m", "plugin_runner", str(config)],
        cwd=CODE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    log: list[str] = []
    threading.Thread(target=lambda: log.extend(iter(runner.stdout.readline, "")), daemon=True).start()
    yield {"socket": str(socket_dir / f"{PLUGIN}.sock"), "log": log, "runner": runner, "data": data}
    runner.terminate()
    runner.wait(30)
    hosts.write_text(original)
    shutil.rmtree(base, ignore_errors=True)
    own.shutdown()
    upstream.shutdown()


def backend_uid_map() -> list[str]:
    """The backend's user namespace, read from the container's /proc."""
    for pid in filter(str.isdigit, os.listdir("/proc")):
        try:
            if b"/plugin/backend/probe.py" in Path(f"/proc/{pid}/cmdline").read_bytes():
                return Path(f"/proc/{pid}/uid_map").read_text().split()
        except OSError:
            continue
    raise AssertionError("no backend process")


def wait_for_backend(deployment, seconds=30):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            return http(deployment["socket"], "GET", "/.workspace/identity")
        except OSError:
            time.sleep(0.2)
    raise AssertionError("the backend never answered:\n" + "".join(deployment["log"]))


@pytest.mark.skipif(MODE != "1", reason="a container that allows the sandbox")
class TestTheSandbox:
    @pytest.fixture(scope="class")
    def probe(self, deployment):
        status, body = wait_for_backend(deployment)
        assert status == 200 and json.loads(body)["plugin"] == PLUGIN
        try:
            status, body = http(deployment["socket"], "POST", "/.workspace/routes/probe", b"{}")
        except (OSError, IndexError) as error:
            raise AssertionError("".join(deployment["log"])) from error
        assert status == 200, body
        return json.loads(body)

    def test_the_api_reaches_it_through_the_runners_socket_only(self, deployment, probe):
        mode = os.stat(deployment["socket"]).st_mode & 0o777
        assert mode == 0o660
        assert any("sandbox ready" in line for line in deployment["log"]), deployment["log"]

    def test_it_runs_as_its_own_unprivileged_user_with_nothing_to_gain(self, probe):
        assert probe["uid"] == 0
        # Its root is the backend's own uid outside, as the container sees the process
        assert backend_uid_map() == ["0", "61000", "1"]
        assert int(probe["capabilities"], 16) == 0 and probe["bounding"] == []
        assert probe["no_new_privs"] == 1
        assert probe["seccomp"] == 2  # a filter
        assert probe["hostname"] == "plugin"

    def test_it_sees_its_own_view_and_nothing_of_the_container(self, probe):
        # Landlock grants no reading of the root itself; the view shows through what exists
        assert probe["list_root"] == "EACCES"
        present = {path for path, exists in probe["exists"].items() if exists}
        assert present == {"/usr", "/plugin/plugin.json", "/data", "/tmp", "/run/workspace/egress"}  # noqa: S108
        own_etc = {"hosts", "resolv.conf", "nsswitch.conf", "passwd", "group", "hostname"}
        from_container = {"ssl", "ca-certificates", "ld.so.cache", "localtime", "mime.types"}
        assert set(probe["etc"]) <= own_etc | from_container
        assert set(probe["dev"]) == {"null", "zero", "full", "random", "urandom", "shm"}
        assert probe["passwd"] == "root"
        assert probe["data"] == ["sales.csv"]
        # No /proc: no process of the container, nor its own, to read
        assert probe["read_init_environ"] == "ENOENT"

    def test_it_writes_only_its_scratch_and_runs_nothing_from_there(self, probe):
        assert probe["write_package"] in {"EROFS", "EACCES"}
        assert probe["write_usr"] in {"EROFS", "EACCES"}
        assert probe["write_data"] in {"EROFS", "EACCES"}
        assert probe["exec_tmp"] == "EACCES"

    def test_it_reaches_the_approved_host_and_nothing_else(self, probe):
        assert probe["egress"] == "upstream ok"
        assert probe["container_loopback"] == "ECONNREFUSED"
        assert probe["outside"] in {"ENETUNREACH", "EACCES"}
        assert probe["dns"] == "gaierror"
        # An approved name that leads to the container's loopback is refused by the relay
        assert probe["egress_to_loopback"] in {"closed", "ECONNRESET"}
        # Landlock allows TCP connections to the relays' ports only
        assert probe["unapproved_port"] == "EACCES"

    def test_it_cannot_leave_its_namespaces_or_reach_the_kernel(self, probe):
        assert probe["unshare"] == "EPERM"
        assert probe["mount"] == "EPERM"
        assert probe["netlink"] == "EAFNOSUPPORT"

    def test_its_limits_and_environment_are_the_configured_ones(self, probe):
        assert probe["nproc"] == 64
        assert probe["nofile"] == 256
        assert probe["address_space_mb"] == 512
        names = {"HOME", "LANG", "PATH", "TMPDIR", "WORKSPACE_BACKEND_SOCKET", "PROBE_SETTING"}
        assert set(probe["environment"]) == names


@pytest.mark.skipif(MODE != "refused", reason="a container that does not allow the sandbox")
def test_without_the_rights_the_backend_is_refused(deployment):
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline and not any("sandbox refused" in line for line in deployment["log"]):
        time.sleep(0.2)
    refusals = [line for line in deployment["log"] if "sandbox refused" in line]
    assert refusals, deployment["log"]
    assert "namespaces" in refusals[0]
    with pytest.raises(OSError):
        http(deployment["socket"], "GET", "/.workspace/identity")
    assert platform.system() == "Linux"
