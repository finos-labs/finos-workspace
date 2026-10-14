"""Landlock rules for a plugin backend (docs/widget-plugins/SERVER-SIDE.md 5.4, R3 and R4).

Inside the sandbox's own mount view, Landlock says again what each path allows, so a
mistake in the view does not open the file system; it also limits TCP to connecting to the
egress relays' ports, and keeps the backend's signals and abstract unix sockets inside its
sandbox. Every access right the running kernel's ABI knows is handled; a right not granted
for a path is refused beneath it. Standard library only.
"""

from __future__ import annotations

import ctypes
import errno
import os
import stat
import struct

_CREATE, _ADD_RULE, _RESTRICT = 444, 445, 446  # the same number on every architecture
_CREATE_RULESET_VERSION = 1
_RULE_PATH_BENEATH, _RULE_NET_PORT = 1, 2
# The ABI versions that added what this module uses
ABI_REFER, ABI_TRUNCATE, ABI_NET, ABI_IOCTL_DEV, ABI_SCOPE = 2, 3, 4, 5, 6

EXECUTE = 1 << 0
WRITE_FILE = 1 << 1
READ_FILE = 1 << 2
READ_DIR = 1 << 3
REMOVE_DIR = 1 << 4
REMOVE_FILE = 1 << 5
MAKE_CHAR = 1 << 6
MAKE_DIR = 1 << 7
MAKE_REG = 1 << 8
MAKE_SOCK = 1 << 9
MAKE_FIFO = 1 << 10
MAKE_BLOCK = 1 << 11
MAKE_SYM = 1 << 12
REFER = 1 << 13  # ABI 2
TRUNCATE = 1 << 14  # ABI 3
IOCTL_DEV = 1 << 15  # ABI 5

NET_BIND_TCP = 1 << 0  # ABI 4
NET_CONNECT_TCP = 1 << 1

SCOPE_ABSTRACT_UNIX_SOCKET = 1 << 0  # ABI 6
SCOPE_SIGNAL = 1 << 1

FILE_RIGHTS = EXECUTE | WRITE_FILE | READ_FILE | TRUNCATE | IOCTL_DEV

READ = READ_FILE | READ_DIR
READ_EXECUTE = READ | EXECUTE
READ_WRITE = (
    READ
    | WRITE_FILE
    | REMOVE_DIR
    | REMOVE_FILE
    | MAKE_DIR
    | MAKE_REG
    | MAKE_SYM
    | MAKE_SOCK
    | MAKE_FIFO
    | REFER
    | TRUNCATE
)

_libc = ctypes.CDLL(None, use_errno=True)
_libc.syscall.restype = ctypes.c_long


def _fail(what: str) -> OSError:
    number = ctypes.get_errno()
    return OSError(number, f"landlock {what}: {errno.errorcode.get(number, number)}")


def abi() -> int:
    """The Landlock ABI of the running kernel, or 0 when it has none (or it is disabled)."""
    version = _libc.syscall(_CREATE, None, ctypes.c_size_t(0), ctypes.c_uint32(_CREATE_RULESET_VERSION))
    return max(int(version), 0)


def handled(version: int) -> tuple[int, int, int]:
    """The file system rights, network rights and scopes an ABI version knows."""
    fs = (1 << 13) - 1
    if version >= ABI_REFER:
        fs |= REFER
    if version >= ABI_TRUNCATE:
        fs |= TRUNCATE
    if version >= ABI_IOCTL_DEV:
        fs |= IOCTL_DEV
    net = NET_BIND_TCP | NET_CONNECT_TCP if version >= ABI_NET else 0
    scoped = SCOPE_ABSTRACT_UNIX_SOCKET | SCOPE_SIGNAL if version >= ABI_SCOPE else 0
    return fs, net, scoped


def ruleset_attr(version: int) -> bytes:
    fs, net, scoped = handled(version)
    attr = struct.pack("<QQQ", fs, net, scoped)
    return attr[:24] if version >= ABI_SCOPE else attr[:16] if version >= ABI_NET else attr[:8]


def path_rule(access: int, fd: int) -> bytes:
    # struct landlock_path_beneath_attr is packed: __u64 allowed_access; __s32 parent_fd
    return struct.pack("<Qi", access, fd)


def restrict(paths: dict[str, int], connect_ports: list[int], version: int) -> None:
    """Restricts this process, and every process it starts, to ``paths`` (a path and the
    rights beneath it) and to TCP connections to ``connect_ports``. ``no_new_privs`` must
    be set already."""
    if version < 1:
        raise OSError(errno.EOPNOTSUPP, "landlock: the kernel has none")
    fs, net, _ = handled(version)
    attr = ruleset_attr(version)
    buffer = ctypes.create_string_buffer(attr, len(attr))
    ruleset = _libc.syscall(_CREATE, buffer, ctypes.c_size_t(len(attr)), ctypes.c_uint32(0))
    if ruleset < 0:
        raise _fail("create_ruleset")
    try:
        for path, access in paths.items():
            fd = os.open(path, os.O_PATH | os.O_CLOEXEC)
            try:
                rights = access & fs
                if not stat.S_ISDIR(os.fstat(fd).st_mode):
                    rights &= FILE_RIGHTS
                rule = ctypes.create_string_buffer(path_rule(rights, fd), 12)
                if _libc.syscall(_ADD_RULE, ruleset, _RULE_PATH_BENEATH, rule, ctypes.c_uint32(0)) != 0:
                    raise _fail(f"add_rule {path}")
            finally:
                os.close(fd)
        if net:
            for port in sorted(set(connect_ports)):
                rule = ctypes.create_string_buffer(struct.pack("<QQ", NET_CONNECT_TCP, port), 16)
                if _libc.syscall(_ADD_RULE, ruleset, _RULE_NET_PORT, rule, ctypes.c_uint32(0)) != 0:
                    raise _fail(f"add_rule port {port}")
        if _libc.syscall(_RESTRICT, ruleset, ctypes.c_uint32(0)) != 0:
            raise _fail("restrict_self")
    finally:
        os.close(ruleset)
