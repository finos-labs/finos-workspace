"""The sandbox of one plugin backend (docs/widget-plugins/SERVER-SIDE.md 5.4, recipe B).

The runner starts this helper as root, with the backend's spec as JSON on stdin. It applies
every layer, in this order, and exits with the name of the first one that cannot be applied
(the runner then refuses to start the backend):

1. ``identity``: the backend's own uid and gid, no groups (R2).
2. ``namespaces``: its own user, mount, network, PID, IPC, UTS and cgroup namespaces, made as
   that uid, which the new user namespace maps to its root (R1, R10).
3. ``mounts``: a private root on tmpfs holding the system's directories read-only, its
   runtime read-only, its package and data read-only without exec, a scratch ``/tmp``
   without exec, the directory of its listening socket and the runner's egress sockets;
   no ``/proc``, and nothing else of the container (R3). Linux before 7.2 refuses a
   ``/proc`` of the sandbox's own processes wherever the container's ``/proc`` is partly
   covered, as Docker's is, so the sandbox has none on any kernel.
4. ``network``: loopback only. Each approved endpoint is a relay on a loopback address that
   its own ``/etc/hosts`` gives the endpoint's name, to the runner's egress socket (R4).
5. ``landlock``: the same paths again, TCP connections only to the relays' ports, signals
   and abstract unix sockets kept inside (R3, R4).
6. ``seccomp`` after ``no_new_privs``, and no capabilities left (R10).
7. ``limits``: rlimits on the backend's process (R5); the runner's cgroup when the
   deployment delegated one.

The helper stays as the namespace's PID 1: it runs the relays, reaps, and stops the backend
on SIGTERM. Standard library only: nothing is imported after the root is replaced.
"""

from __future__ import annotations

import contextlib
import ctypes
import errno
import fcntl
import json
import os
import platform
import resource
import select
import signal
import socket
import struct
import sys
import tempfile
import threading

from plugin_runner import landlock, seccomp

LISTEN_DIR = "/run/workspace/listen"
EGRESS_DIR = "/run/workspace/egress"
PACKAGE_DIR = "/plugin"
SOCKET = f"{LISTEN_DIR}/backend.sock"
SCRATCH = "/tmp"  # noqa: S108 - the sandbox's own tmpfs, not a file in the container's /tmp
MAX_CONNECTIONS = 32

_CLONE = {
    "user": 0x10000000,
    "mount": 0x00020000,
    "network": 0x40000000,
    "pid": 0x20000000,
    "ipc": 0x08000000,
    "uts": 0x04000000,
    "cgroup": 0x02000000,
}
MS_RDONLY, MS_NOSUID, MS_NODEV, MS_NOEXEC = 1, 2, 4, 8
MS_REMOUNT, MS_BIND, MS_REC, MS_PRIVATE = 32, 4096, 16384, 1 << 18
MS_NOATIME, MS_NODIRATIME, MS_RELATIME = 1024, 2048, 1 << 21
MNT_DETACH = 2
_PIVOT_ROOT = {"aarch64": 41, "x86_64": 155}
_CAPGET = {"aarch64": 90, "x86_64": 125}
_CAPSET = {"aarch64": 91, "x86_64": 126}
PR_SET_PDEATHSIG, PR_SET_DUMPABLE, PR_CAPBSET_READ, PR_CAPBSET_DROP = 1, 4, 23, 24
PR_SET_SECUREBITS, PR_SET_NO_NEW_PRIVS, PR_CAP_AMBIENT = 28, 38, 47
# NOROOT, NO_SETUID_FIXUP, KEEP_CAPS and NO_CAP_AMBIENT_RAISE, each with its lock
SECUREBITS = 0b11101111

_libc = ctypes.CDLL(None, use_errno=True)
_libc.mount.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_ulong, ctypes.c_char_p]
_libc.umount2.argtypes = [ctypes.c_char_p, ctypes.c_int]
_libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
_libc.syscall.restype = ctypes.c_long
_libc.sethostname.argtypes = [ctypes.c_char_p, ctypes.c_size_t]


class LayerError(Exception):
    """A layer that could not be applied: the backend is not started."""

    def __init__(self, layer: str, detail: str):
        super().__init__(f"{layer}: {detail}")
        self.layer = layer


def _oserror(what: str) -> OSError:
    number = ctypes.get_errno()
    return OSError(number, f"{what}: {errno.errorcode.get(number, number)}")


def _prctl(option: int, arg: int = 0, what: str = "prctl") -> None:
    if _libc.prctl(option, arg, 0, 0, 0) != 0:
        raise _oserror(what)


def _mount(source: str | None, target: str, fstype: str | None, flags: int, data: str | None = None) -> None:
    if _libc.mount(
        source.encode() if source else None,
        target.encode(),
        fstype.encode() if fstype else None,
        flags,
        data.encode() if data else None,
    ):
        raise _oserror(f"mount {target}")


def _locked_flags(path: str) -> int:
    """The flags of the mount holding ``path`` that a user namespace may not drop."""
    flags = os.statvfs(path).f_flag
    out = 0
    for st, ms in (
        (os.ST_RDONLY, MS_RDONLY),
        (os.ST_NOSUID, MS_NOSUID),
        (os.ST_NODEV, MS_NODEV),
        (os.ST_NOEXEC, MS_NOEXEC),
        (os.ST_NOATIME, MS_NOATIME),
        (os.ST_NODIRATIME, MS_NODIRATIME),
        (os.ST_RELATIME, MS_RELATIME),
    ):
        if flags & st:
            out |= ms
    return out


def _bind(source: str, target: str, *, writable: bool = False, executable: bool = False) -> None:
    _mount(source, target, None, MS_BIND | MS_REC)
    flags = MS_BIND | MS_REMOUNT | MS_NOSUID | MS_NODEV | _locked_flags(source)
    if not writable:
        flags |= MS_RDONLY
    if not executable:
        flags |= MS_NOEXEC
    _mount(None, target, None, flags)


def _touch(path: str) -> None:
    with open(path, "w"):
        pass


def _write(path: str, text: str) -> None:
    with open(path, "w") as f:
        f.write(text)


# ------------------------------------------------------------------ layers


def identity(spec: dict) -> None:
    os.setgroups([])
    os.setresgid(spec["gid"], spec["gid"], spec["gid"])
    os.setresuid(spec["uid"], spec["uid"], spec["uid"])
    if os.getresuid() != (spec["uid"],) * 3 or os.getresgid() != (spec["gid"],) * 3 or os.getgroups():
        raise LayerError("identity", "the backend's uid and gid did not hold")
    # Its own /proc files again (a uid change made them root's), and gone with the runner
    _prctl(PR_SET_DUMPABLE, 1)
    _prctl(PR_SET_PDEATHSIG, signal.SIGKILL)


def namespaces(spec: dict) -> None:
    flags = 0
    for value in _CLONE.values():
        flags |= value
    os.unshare(flags)
    _write("/proc/self/setgroups", "deny")
    _write("/proc/self/uid_map", f"0 {spec['uid']} 1")
    _write("/proc/self/gid_map", f"0 {spec['gid']} 1")


class View:
    """The private root being built: a tmpfs, then the parts of the container it holds."""

    def __init__(self) -> None:
        self.root = tempfile.mkdtemp(prefix="ws-plugin-root-")
        _mount("tmpfs", self.root, "tmpfs", MS_NOSUID | MS_NODEV, "size=4m,mode=0755")

    def inside(self, path: str) -> str:
        return self.root + path

    def directory(self, path: str) -> str:
        os.makedirs(self.inside(path), exist_ok=True)
        return self.inside(path)


def _system(view: View) -> None:
    """Programs and libraries, read-only; the merged-/usr links as they are."""
    for top in ("usr", "bin", "sbin", "lib", "lib32", "lib64", "libx32"):
        source = f"/{top}"
        if os.path.islink(source):
            os.symlink(os.readlink(source), view.inside(source))
        elif os.path.isdir(source):
            _bind(source, view.directory(source), executable=True)


def _etc(view: View, spec: dict) -> None:
    """An /etc of its own: names, users and the CA certificates, nothing of the deployment's."""
    etc = view.directory("/etc")
    sealed = MS_NOSUID | MS_NODEV | MS_NOEXEC
    _mount("tmpfs", etc, "tmpfs", sealed, "size=1m,mode=0755")
    hosts = ["127.0.0.1 localhost", "::1 localhost"]
    hosts += [f"{endpoint['address']} {endpoint['host']}" for endpoint in spec["endpoints"]]
    _write(f"{etc}/hosts", "\n".join(dict.fromkeys(hosts)) + "\n")
    _write(f"{etc}/resolv.conf", "")
    _write(f"{etc}/nsswitch.conf", "passwd: files\ngroup: files\nhosts: files\n")
    _write(f"{etc}/passwd", f"root:x:0:0:plugin backend:{SCRATCH}:/usr/sbin/nologin\n")
    _write(f"{etc}/group", "root:x:0:\n")
    _write(f"{etc}/hostname", "plugin\n")
    for name in ("ssl", "ca-certificates"):
        if os.path.isdir(f"/etc/{name}"):
            _bind(f"/etc/{name}", view.directory(f"/etc/{name}"))
    for name in ("ld.so.cache", "localtime", "mime.types"):
        source = f"/etc/{name}"
        if os.path.isfile(source):
            _touch(f"{etc}/{name}")
            _mount(source, f"{etc}/{name}", None, MS_BIND)
            _mount(None, f"{etc}/{name}", None, MS_BIND | MS_REMOUNT | MS_RDONLY | sealed | _locked_flags(source))
    _mount(None, etc, None, MS_REMOUNT | MS_RDONLY | sealed)


def _dev(view: View, spec: dict) -> None:
    """The harmless devices only, and a shared-memory scratch without exec."""
    dev = view.directory("/dev")
    _mount("tmpfs", dev, "tmpfs", MS_NOSUID | MS_NOEXEC, "size=64k,mode=0755")
    for name in ("null", "zero", "full", "random", "urandom"):
        _touch(f"{dev}/{name}")
        _mount(f"/dev/{name}", f"{dev}/{name}", None, MS_BIND)
    os.makedirs(f"{dev}/shm")
    size = spec["limits"]["scratch_mb"]
    _mount("tmpfs", f"{dev}/shm", "tmpfs", MS_NOSUID | MS_NODEV | MS_NOEXEC, f"size={size}m,mode=1777")
    _mount(None, dev, None, MS_REMOUNT | MS_RDONLY | MS_NOSUID | MS_NOEXEC)


def _own(view: View, spec: dict) -> None:
    """Scratch, its package, its runtime, its data, its socket and the egress sockets."""
    size = spec["limits"]["scratch_mb"]
    _mount("tmpfs", view.directory(SCRATCH), "tmpfs", MS_NOSUID | MS_NODEV | MS_NOEXEC, f"size={size}m,mode=1777")
    _bind(spec["package"], view.directory(PACKAGE_DIR))
    for path in spec["runtime"]:
        _bind(path, view.directory(path), executable=True)
    for bind in spec["readonly"]:
        _bind(bind["source"], view.directory(bind["target"]))
    _bind(spec["listen_dir"], view.directory(LISTEN_DIR), writable=True)
    _bind(spec["egress_dir"], view.directory(EGRESS_DIR))


def mounts(spec: dict, arch: str) -> None:
    _mount(None, "/", None, MS_REC | MS_PRIVATE)
    view = View()
    _system(view)
    _etc(view, spec)
    _dev(view, spec)
    _own(view, spec)
    old = view.directory("/.old")
    if _libc.syscall(_PIVOT_ROOT[arch], view.root.encode(), old.encode()) != 0:
        raise _oserror("pivot_root")
    os.chdir("/")
    if _libc.umount2(b"/.old", MNT_DETACH) != 0:
        raise _oserror("umount the old root")
    os.rmdir("/.old")
    _mount(None, "/", None, MS_REMOUNT | MS_RDONLY | MS_NOSUID | MS_NODEV)
    if _libc.sethostname(b"plugin", 6) != 0:
        raise _oserror("sethostname")


def network(spec: dict) -> list[tuple[socket.socket, str]]:
    """Loopback up, and a listening socket for each endpoint's relay."""
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        siocgifflags, siocsifflags, iff_up = 0x8913, 0x8914, 0x1
        request = struct.pack("16sH22x", b"lo", 0)
        flags = struct.unpack("16sH22x", fcntl.ioctl(probe, siocgifflags, request))[1]
        fcntl.ioctl(probe, siocsifflags, struct.pack("16sH22x", b"lo", flags | iff_up))
    finally:
        probe.close()
    listeners = []
    for endpoint in spec["endpoints"]:
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind((endpoint["address"], endpoint["port"]))
        listener.listen(16)
        listeners.append((listener, f"{EGRESS_DIR}/{endpoint['socket']}"))
    return listeners


def landlock_rules(spec: dict) -> dict[str, int]:
    rules = {
        "/usr": landlock.READ_EXECUTE,
        "/etc": landlock.READ,
        "/dev": landlock.READ,
        "/dev/null": landlock.READ_FILE | landlock.WRITE_FILE,
        "/dev/full": landlock.READ_FILE | landlock.WRITE_FILE,
        "/dev/shm": landlock.READ_WRITE,  # noqa: S108 - the sandbox's own tmpfs
        SCRATCH: landlock.READ_WRITE,
        PACKAGE_DIR: landlock.READ,
        LISTEN_DIR: landlock.READ_WRITE,
        EGRESS_DIR: landlock.READ | landlock.WRITE_FILE,
    }
    for top in ("/bin", "/sbin", "/lib", "/lib32", "/lib64", "/libx32"):
        if os.path.isdir(top) and not os.path.islink(top):
            rules[top] = landlock.READ_EXECUTE
    for path in spec["runtime"]:
        rules[path] = landlock.READ_EXECUTE
    for bind in spec["readonly"]:
        rules[bind["target"]] = landlock.READ
    return rules


def drop_privileges(arch: str) -> None:
    """No capabilities from here on, and none to be had again by any program it runs."""
    _prctl(PR_SET_SECUREBITS, SECUREBITS, "securebits")
    # Every capability the kernel knows: reading past the last one fails
    known = 0
    while _libc.prctl(PR_CAPBSET_READ, known, 0, 0, 0) >= 0:
        _prctl(PR_CAPBSET_DROP, known, "drop a bounding capability")
        known += 1
    _prctl(PR_CAP_AMBIENT, 4, "clear the ambient capabilities")  # PR_CAP_AMBIENT_CLEAR_ALL
    header = ctypes.create_string_buffer(struct.pack("<Ii", 0x20080522, 0), 8)
    data = ctypes.create_string_buffer(bytes(24), 24)
    if _libc.syscall(_CAPSET[arch], header, data) != 0:
        raise _oserror("capset")
    if _libc.syscall(_CAPGET[arch], header, data) != 0:
        raise _oserror("capget")
    left = {
        "effective, permitted, inheritable": data.raw.hex() if any(data.raw) else "",
        "bounding": [cap for cap in range(known) if _libc.prctl(PR_CAPBSET_READ, cap, 0, 0, 0) != 0],
        "ambient": [cap for cap in range(known) if _libc.prctl(PR_CAP_AMBIENT, 1, cap, 0, 0) != 0],  # IS_SET
    }
    if not known or any(left.values()):
        raise LayerError("seccomp", f"capabilities left: {left}")


def limit_backend(spec: dict) -> None:
    limits = spec["limits"]
    mib = 1024 * 1024
    for which, value in (
        (resource.RLIMIT_AS, limits["memory_mb"] * mib),
        (resource.RLIMIT_NPROC, limits["processes"]),
        (resource.RLIMIT_NOFILE, limits["files"]),
        (resource.RLIMIT_FSIZE, limits["scratch_mb"] * mib),
        (resource.RLIMIT_CORE, 0),
    ):
        resource.setrlimit(which, (value, value))


# ------------------------------------------------------------------ PID 1


def _pump(a: socket.socket, b: socket.socket) -> None:
    open_ = {a: b, b: a}
    try:
        while open_:
            ready, _, _ = select.select(list(open_), [], [], 300)
            if not ready:
                return
            for source in ready:
                data = source.recv(65536)
                target = open_[source]
                if data:
                    target.sendall(data)
                    continue
                del open_[source]
                with contextlib.suppress(OSError):
                    target.shutdown(socket.SHUT_WR)
    except OSError:
        return
    finally:
        a.close()
        b.close()


def _relay(listener: socket.socket, path: str, slots: threading.BoundedSemaphore) -> None:
    while True:
        client, _ = listener.accept()
        if not slots.acquire(blocking=False):
            client.close()
            continue

        def bridge(client: socket.socket = client) -> None:
            try:
                upstream = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                try:
                    upstream.settimeout(10)
                    upstream.connect(path)
                    upstream.settimeout(None)
                except OSError:
                    upstream.close()
                    client.close()
                    return
                _pump(client, upstream)
            finally:
                slots.release()

        threading.Thread(target=bridge, daemon=True).start()


def _backend_environment(spec: dict) -> dict[str, str]:
    path = [f"{p}/bin" for p in spec["runtime"]] + ["/usr/local/bin", "/usr/bin", "/bin"]
    return {
        "PATH": ":".join(path),
        "HOME": SCRATCH,
        "TMPDIR": SCRATCH,
        "LANG": "C.UTF-8",
        "WORKSPACE_BACKEND_SOCKET": SOCKET,
        **spec["environment"],
    }


def setup(spec: dict, arch: str) -> tuple[list[tuple[socket.socket, str]], int]:
    """Every layer of PID 1, in order: the relays' listeners and the Landlock ABI applied."""
    try:
        mounts(spec, arch)
    except OSError as error:
        raise LayerError("mounts", str(error)) from error
    try:
        listeners = network(spec)
    except OSError as error:
        raise LayerError("network", str(error)) from error
    _prctl(PR_SET_NO_NEW_PRIVS, 1, "no_new_privs")
    try:
        version = landlock.abi()
        landlock.restrict(landlock_rules(spec), [e["port"] for e in spec["endpoints"]], version)
    except OSError as error:
        raise LayerError("landlock", str(error)) from error
    try:
        seccomp.install(arch)
        drop_privileges(arch)
    except OSError as error:
        raise LayerError("seccomp", str(error)) from error
    _prctl(PR_SET_DUMPABLE, 0)
    return listeners, version


def start_backend(spec: dict) -> int:
    command = [part.replace("{socket}", SOCKET) for part in spec["command"]]
    cwd = f"{PACKAGE_DIR}/backend" if os.path.isdir(f"{PACKAGE_DIR}/backend") else PACKAGE_DIR
    environment = _backend_environment(spec)
    backend = os.fork()
    if backend == 0:
        try:
            limit_backend(spec)
            os.setsid()
            os.closerange(3, 65536)
            os.umask(0o007)
            os.chdir(cwd)
            os.execve(command[0], command, environment)  # noqa: S606 - the deployer's command, as argv
        except OSError as error:
            sys.stderr.write(f"sandbox: the backend did not start: {error}\n")
        finally:
            os._exit(127)
    return backend


def init(spec: dict, arch: str) -> int:
    """PID 1 of the namespace: sets the sandbox up, starts the backend, relays, reaps."""
    try:
        listeners, version = setup(spec, arch)
    except LayerError as error:
        sys.stderr.write(f"sandbox refused: {error}\n")
        return 70
    sys.stderr.write(
        f"sandbox ready: landlock abi {version}, {len(spec['endpoints'])} egress endpoint(s), "
        f"limits {spec['limits']}\n"
    )
    sys.stderr.flush()
    backend = start_backend(spec)
    slots = threading.BoundedSemaphore(MAX_CONNECTIONS)
    for listener, path in listeners:
        threading.Thread(target=_relay, args=(listener, path, slots), daemon=True).start()

    def stop(_signum: int, _frame: object) -> None:
        with contextlib.suppress(ProcessLookupError):
            os.kill(backend, signal.SIGTERM)
        signal.alarm(10)

    def kill_all(_signum: int, _frame: object) -> None:
        os.kill(-1, signal.SIGKILL)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGALRM, kill_all)
    while True:
        try:
            pid, status = os.waitpid(-1, 0)
        except ChildProcessError:
            return 0
        if pid == backend:
            code = os.waitstatus_to_exitcode(status)
            with contextlib.suppress(ProcessLookupError):
                os.kill(-1, signal.SIGKILL)  # whatever it left behind
            return code if code >= 0 else 128 - code


def main() -> int:
    spec = json.load(sys.stdin)
    arch = platform.machine()
    try:
        if arch not in _PIVOT_ROOT:
            raise LayerError("identity", f"no sandbox for {arch}")
        if spec.get("cgroup"):
            try:
                _write(f"{spec['cgroup']}/cgroup.procs", str(os.getpid()))
            except OSError as error:
                raise LayerError("limits", f"cgroup: {error}") from error
        try:
            identity(spec)
        except OSError as error:
            raise LayerError("identity", str(error)) from error
        try:
            namespaces(spec)
        except OSError as error:
            raise LayerError("namespaces", str(error)) from error
    except LayerError as error:
        sys.stderr.write(f"sandbox refused: {error}\n")
        return 70

    child = os.fork()
    if child == 0:
        try:
            _prctl(PR_SET_PDEATHSIG, signal.SIGKILL)
            os._exit(init(spec, arch))
        except BaseException as error:  # noqa: BLE001 - whatever stops PID 1 ends the sandbox
            sys.stderr.write(f"sandbox: {error}\n")
            os._exit(70)

    signal.signal(signal.SIGTERM, lambda *_: os.kill(child, signal.SIGTERM))
    signal.signal(signal.SIGINT, lambda *_: os.kill(child, signal.SIGTERM))
    _, status = os.waitpid(child, 0)
    return os.waitstatus_to_exitcode(status) if os.WIFEXITED(status) else 70


if __name__ == "__main__":
    sys.exit(main())
