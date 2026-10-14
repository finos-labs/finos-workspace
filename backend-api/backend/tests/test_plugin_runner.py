"""The plugin runner (docs/widget-plugins/SERVER-SIDE.md 5.4, recipe B): its configuration,
its seccomp program, its Landlock attributes, its relays and its integrity check. What only a
Linux sandbox can show is in test_plugin_runner_sandbox.py."""

import asyncio
import errno
import os
import shutil
import struct
import tempfile
from pathlib import Path

import pytest
from pydantic import ValidationError

from plugin_runner import landlock, relays, seccomp
from plugin_runner.__main__ import spec_for, verify
from plugin_runner.config import RunnerConfig
from tests.fixtures.runner_packages import write_backend_package

DIGEST = "sha256-" + "A" * 43


def config(**backend) -> RunnerConfig:
    return RunnerConfig.model_validate(
        {
            "plugins_dir": "/opt/widget-plugins",
            "backends": {
                "sql-explorer": {
                    "version": "1.1.3",
                    "digest": DIGEST,
                    "command": ["/opt/plugin-envs/sql-explorer/bin/python", "-m", "server", "{socket}"],
                    **backend,
                }
            },
        }
    )


# ---------------------------------------------------------------- configuration


def test_a_backend_gets_an_unprivileged_uid_of_its_own():
    two = RunnerConfig.model_validate(
        {
            "plugins_dir": "/opt/widget-plugins",
            "backends": {
                name: {"version": "1.0.0", "digest": DIGEST, "command": ["/usr/bin/true"]}
                for name in ("b-plugin", "a-plugin")
            },
        }
    )
    assert two.backends["a-plugin"].uid == 61000
    assert two.backends["b-plugin"].uid == 61001
    with pytest.raises(ValidationError, match="share a uid"):
        RunnerConfig.model_validate(
            {
                "plugins_dir": "/opt/widget-plugins",
                "backends": {
                    name: {"version": "1.0.0", "digest": DIGEST, "command": ["/usr/bin/true"], "uid": 62000}
                    for name in ("a-plugin", "b-plugin")
                },
            }
        )
    with pytest.raises(ValidationError):
        config(uid=0)


@pytest.mark.parametrize(
    "readonly",
    [
        [{"source": "/data", "target": "/files"}],
        [{"source": "/data/explorer", "target": "/files"}],
        [{"source": "/opt/code", "target": "/files"}],
        [{"source": "/etc", "target": "/files"}],
        [{"source": "/run", "target": "/files"}],
        [{"source": "/srv/files", "target": "/etc/files"}],
        [{"source": "/srv/files", "target": "/tmp"}],  # noqa: S108 - a path the sandbox owns
        [{"source": "/srv/files", "target": "/plugin"}],
        [{"source": "/opt/widget-plugins/other", "target": "/files"}],
        [{"source": "/srv/../data", "target": "/files"}],
        [{"source": "srv/files", "target": "/files"}],
    ],
)
def test_no_mount_reaches_the_deployment_or_covers_the_sandbox(readonly):
    with pytest.raises(ValidationError):
        config(readonly=readonly)


def test_a_data_directory_is_mounted_where_the_backend_expects_it():
    loaded = config(
        readonly=[{"source": "/srv/explorer-files", "target": "/data"}], runtime=["/opt/plugin-envs/sql-explorer"]
    )
    assert loaded.backends["sql-explorer"].readonly[0].target == "/data"
    with pytest.raises(ValidationError):
        config(runtime=["/opt/.venv"])


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://api.example.org",
        "https://10.0.0.5",
        "tcp://192.168.1.4:5432",
        "tcp://db.example.org",
        "https://localhost",
        "tcp://redis.localhost:6379",
        "https://workspace-broker",
        "https://api.example.org/path",
        "https://Api.Example.org",
    ],
)
def test_an_endpoint_is_a_name_and_a_port(endpoint):
    with pytest.raises(ValidationError):
        config(network=[endpoint])


def test_endpoints_and_the_broker_become_names_on_loopback():
    loaded = config(
        network=["https://api.example.org", "tcp://db.example.org:5432", "https://api.example.org:8443"], broker=True
    )
    spec = spec_for(loaded, "sql-explorer", loaded.backends["sql-explorer"], Path("/run/widget-plugins/sql-explorer"))
    assert spec["endpoints"] == [
        {"host": "api.example.org", "port": 443, "address": "127.0.0.2", "socket": "0.sock"},
        {"host": "db.example.org", "port": 5432, "address": "127.0.0.3", "socket": "1.sock"},
        {"host": "api.example.org", "port": 8443, "address": "127.0.0.2", "socket": "2.sock"},
        {"host": "workspace-broker", "port": 80, "address": "127.0.0.4", "socket": "broker.sock"},
    ]
    assert spec["package"] == "/opt/widget-plugins/sql-explorer/1.1.3"
    assert spec["uid"] == spec["gid"] == 61000


def test_the_backend_environment_cannot_replace_the_runners():
    with pytest.raises(ValidationError):
        config(environment={"WORKSPACE_BACKEND_SOCKET": "/elsewhere"})
    with pytest.raises(ValidationError):
        config(environment={"lower": "x"})
    with pytest.raises(ValidationError):
        config(command=["python", "-m", "server"])
    with pytest.raises(ValidationError):
        config(unknown=True)


# ---------------------------------------------------------------- seccomp


def run_filter(arch: str, nr: int, args: tuple[int, ...] = (0,) * 6, audit_arch: int | None = None) -> int:
    """Interprets the program the kernel would run for one system call."""
    data = struct.pack("<iIQ6Q", nr, seccomp.AUDIT_ARCH[arch] if audit_arch is None else audit_arch, 0, *args)
    program = seccomp.program(arch)
    pc = a = 0
    while True:
        code, jt, jf, k = program[pc]
        if code == 0x20:
            a = struct.unpack_from("<I", data, k)[0]
            pc += 1
        elif code == 0x15:
            pc += 1 + (jt if a == k else jf)
        elif code == 0x35:
            pc += 1 + (jt if a >= k else jf)
        elif code == 0x45:
            pc += 1 + (jt if a & k else jf)
        elif code == 0x06:
            return k
        else:
            raise AssertionError(f"unknown instruction {code:#x}")


def errno_of(result: int) -> int:
    assert result & 0xFFFF0000 == seccomp.RET_ERRNO, hex(result)
    return result & 0xFFFF


@pytest.mark.parametrize("arch", sorted(seccomp.SYSCALLS))
def test_the_sandbox_walls_and_the_kernel_internals_are_refused(arch):
    table = seccomp.SYSCALLS[arch]
    for name in seccomp.DENIED:
        if name in table:
            assert errno_of(run_filter(arch, table[name])) == errno.EPERM, name
    # Ordinary calls go through: read, write, openat
    for nr in {"aarch64": (63, 64, 56), "x86_64": (0, 1, 257)}[arch]:
        assert run_filter(arch, nr) == seccomp.RET_ALLOW


@pytest.mark.parametrize("arch", sorted(seccomp.SYSCALLS))
def test_clone_makes_threads_and_processes_but_no_namespace(arch):
    clone = seccomp.SYSCALLS[arch]["clone"]
    thread_flags = 0x3D0F00  # what pthread_create passes
    assert run_filter(arch, clone, (thread_flags, 0, 0, 0, 0, 0)) == seccomp.RET_ALLOW
    assert run_filter(arch, clone, (17, 0, 0, 0, 0, 0)) == seccomp.RET_ALLOW  # fork: SIGCHLD
    for flag in (0x10000000, 0x20000, 0x40000000, 0x20000000, 0x80):
        assert errno_of(run_filter(arch, clone, (17 | flag, 0, 0, 0, 0, 0))) == errno.EPERM
    assert errno_of(run_filter(arch, seccomp.SYSCALLS[arch]["clone3"])) == errno.ENOSYS


@pytest.mark.parametrize("arch", sorted(seccomp.SYSCALLS))
def test_sockets_are_unix_or_ip_and_no_terminal_input_is_pushed(arch):
    socket_nr, ioctl = seccomp.SYSCALLS[arch]["socket"], seccomp.SYSCALLS[arch]["ioctl"]
    for family in (1, 2, 10):
        assert run_filter(arch, socket_nr, (family, 1, 0, 0, 0, 0)) == seccomp.RET_ALLOW
    for family in (16, 17, 38, 40):  # netlink, packet, alg, vsock
        assert errno_of(run_filter(arch, socket_nr, (family, 1, 0, 0, 0, 0))) == errno.EAFNOSUPPORT
    assert errno_of(run_filter(arch, ioctl, (0, seccomp.TIOCSTI, 0, 0, 0, 0))) == errno.EPERM
    assert run_filter(arch, ioctl, (0, 0x5401, 0, 0, 0, 0)) == seccomp.RET_ALLOW


def test_another_architecture_or_abi_is_stopped():
    assert run_filter("aarch64", 63, audit_arch=seccomp.AUDIT_ARCH["x86_64"]) == seccomp.RET_KILL_PROCESS
    assert run_filter("x86_64", 0, audit_arch=seccomp.AUDIT_ARCH["aarch64"]) == seccomp.RET_KILL_PROCESS
    assert errno_of(run_filter("x86_64", seccomp.X32_SYSCALL_BIT | 1)) == errno.ENOSYS


@pytest.mark.parametrize("arch", sorted(seccomp.SYSCALLS))
def test_the_program_is_well_formed(arch):
    program = seccomp.program(arch)
    assert len(program) < 4096
    for index, (code, jt, jf, _) in enumerate(program):
        if code in {0x15, 0x35, 0x45}:
            assert index + 1 + max(jt, jf) < len(program)
    assert program[-1] == (0x06, 0, 0, seccomp.RET_ALLOW)
    assert len(seccomp.pack(program)) == 8 * len(program)


# ---------------------------------------------------------------- landlock


def test_landlock_handles_what_each_abi_knows():
    assert landlock.handled(1) == ((1 << 13) - 1, 0, 0)
    fs, net, scoped = landlock.handled(6)
    assert fs & landlock.TRUNCATE and fs & landlock.REFER and fs & landlock.IOCTL_DEV
    assert net == landlock.NET_BIND_TCP | landlock.NET_CONNECT_TCP
    assert scoped == landlock.SCOPE_ABSTRACT_UNIX_SOCKET | landlock.SCOPE_SIGNAL
    assert [len(landlock.ruleset_attr(v)) for v in (1, 3, 4, 6, 10)] == [8, 8, 16, 24, 24]
    # The kernel's struct is packed: 8 bytes of rights, then the descriptor
    assert landlock.path_rule(landlock.READ, 7) == struct.pack("<Q", landlock.READ) + struct.pack("<i", 7)
    assert not landlock.READ_EXECUTE & (landlock.WRITE_FILE | landlock.MAKE_REG)


# ---------------------------------------------------------------- relays


@pytest.mark.parametrize(
    ("address", "allowed"),
    [
        ("127.0.0.1", False),
        ("127.8.9.1", False),
        ("::1", False),
        ("::ffff:127.0.0.1", False),
        ("169.254.169.254", False),
        ("fe80::1", False),
        ("0.0.0.0", False),  # noqa: S104 - an address checked, never bound
        ("224.0.0.1", False),
        ("10.0.0.5", True),
        ("192.168.1.4", True),
        ("93.184.215.14", True),
        ("2001:db8::1", True),
    ],
)
def test_egress_never_reaches_loopback_or_link_local(address, allowed):
    assert relays.allowed_address(address) is allowed


async def test_egress_to_a_name_on_loopback_is_refused():
    with pytest.raises(ConnectionRefusedError, match="not an allowed address"):
        await relays.connect_checked("localhost", 8000)


@pytest.fixture
def short_dir():
    # A unix socket's path is at most 104 bytes on macOS
    path = Path(tempfile.mkdtemp(prefix="wsr-", dir="/tmp"))
    yield path
    shutil.rmtree(path, ignore_errors=True)


async def test_the_way_in_reaches_the_backend_socket(short_dir):
    async def backend(reader, writer):
        writer.write(b"backend:" + await reader.read(100))
        await writer.drain()
        writer.close()

    inner = await asyncio.start_unix_server(backend, path=str(short_dir / "b.sock"))
    outer = await relays.unix_server(
        str(short_dir / "api.sock"),
        relays.way_in("p", str(short_dir / "b.sock")),
        uid=os.getuid(),
        gid=os.getgid(),
        mode=0o660,
    )
    reader, writer = await asyncio.open_unix_connection(str(short_dir / "api.sock"))
    writer.write(b"hello")
    writer.write_eof()
    assert await reader.read() == b"backend:hello"
    assert (short_dir / "api.sock").stat().st_mode & 0o777 == 0o660
    writer.close()
    outer.close()
    inner.close()


async def broker_exchange(short_dir: Path, request: bytes) -> tuple[bytes, list[bytes]]:
    received: list[bytes] = []

    async def api(reader, writer):
        received.append(await reader.read())
        writer.write(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}")
        await writer.drain()
        writer.close()

    server = await asyncio.start_server(api, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    relay = await relays.unix_server(
        str(short_dir / "broker.sock"),
        relays.broker("p", "127.0.0.1", port),
        uid=os.getuid(),
        gid=os.getgid(),
        mode=0o660,
    )
    reader, writer = await asyncio.open_unix_connection(str(short_dir / "broker.sock"))
    writer.write(request)
    await writer.drain()
    answer = await asyncio.wait_for(reader.read(), 5)
    writer.close()
    relay.close()
    server.close()
    return answer, received


async def test_the_broker_relay_passes_a_broker_call_and_nothing_more(short_dir):
    body = b'{"path": "/api/sales"}'
    call = (
        b"POST /internal/plugin-broker/data/sales HTTP/1.1\r\nHost: workspace-broker\r\n"
        b"X-Workspace-Call: wpc1.token\r\nContent-Type: application/json\r\nCookie: x=1\r\n"
        b"Content-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body
    )
    second = b"GET /plugins HTTP/1.1\r\nHost: api\r\n\r\n"
    answer, received = await broker_exchange(short_dir, call + second)
    assert answer.endswith(b"{}")
    [forwarded] = received
    head, _, sent_body = forwarded.partition(b"\r\n\r\n")
    assert sent_body == body
    lines = head.split(b"\r\n")
    assert lines[0] == b"POST /internal/plugin-broker/data/sales HTTP/1.1"
    assert b"Connection: close" in lines and b"x-workspace-call: wpc1.token" in lines
    # Only the broker's headers go through, and nothing after the one request
    assert not any(line.lower().startswith(b"cookie") for line in lines)
    assert b"/plugins" not in forwarded


@pytest.mark.parametrize(
    "request_line",
    [
        b"GET /internal/plugin-broker/data/sales HTTP/1.1",
        b"POST /plugins HTTP/1.1",
        b"POST /internal/plugin-broker/data/../../plugins HTTP/1.1",
        b"POST /internal/plugin-broker/data/sales?x=1 HTTP/1.1",
        b"POST http://api:8000/internal/plugin-broker/data/sales HTTP/1.1",
    ],
)
async def test_the_broker_relay_refuses_anything_else(short_dir, request_line):
    answer, received = await broker_exchange(short_dir, request_line + b"\r\nContent-Length: 0\r\n\r\n")
    assert answer.startswith(b"HTTP/1.1 403")
    assert received == []


async def test_the_broker_relay_needs_a_bounded_length(short_dir):
    chunked = b"POST /internal/plugin-broker/data/sales HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n"
    answer, received = await broker_exchange(short_dir, chunked)
    assert answer.startswith(b"HTTP/1.1 411") and received == []


# ---------------------------------------------------------------- integrity


def test_only_the_pinned_files_with_a_backend_run(tmp_path):
    root = tmp_path / "plugins"
    _, digest = write_backend_package(root, "runner-test", "1.0.0", {"backend/server.py": b"print('hi')\n"})
    loaded = RunnerConfig.model_validate(
        {
            "plugins_dir": str(root),
            "backends": {"runner-test": {"version": "1.0.0", "digest": digest, "command": ["/usr/bin/python3"]}},
        }
    )
    backend = loaded.backends["runner-test"]
    assert verify(loaded, "runner-test", backend) is None

    # A file changed after the digest was taken
    (root / "runner-test" / "1.0.0" / "backend" / "server.py").write_bytes(b"print('changed')\n")
    assert "checksum" in (verify(loaded, "runner-test", backend) or "")

    # Another pin, or a version that is not there
    _, digest = write_backend_package(root, "runner-test", "1.0.1", {"backend/server.py": b"print('hi')\n"})
    assert verify(loaded, "runner-test", backend.model_copy(update={"version": "1.0.1"})) is not None
    assert verify(loaded, "runner-test", backend.model_copy(update={"version": "1.0.1", "digest": digest})) is None
    assert verify(loaded, "runner-test", backend.model_copy(update={"version": "9.9.9"})) == (
        "runner-test/9.9.9 is not in the plugins directory"
    )


def test_a_package_without_a_backend_does_not_run(tmp_path):
    from tests.fixtures.runner_packages import backend_manifest

    root = tmp_path / "plugins"
    manifest = backend_manifest("runner-test", "1.0.0")
    del manifest["server"]
    manifest["contributes"]["widgets"][0].pop("server")
    manifest["contributes"]["widgets"][0]["permissions"] = []
    _, digest = write_backend_package(root, "runner-test", "1.0.0", {}, manifest)
    loaded = RunnerConfig.model_validate(
        {
            "plugins_dir": str(root),
            "backends": {"runner-test": {"version": "1.0.0", "digest": digest, "command": ["/usr/bin/python3"]}},
        }
    )
    assert verify(loaded, "runner-test", loaded.backends["runner-test"]) == "its manifest declares no backend"
