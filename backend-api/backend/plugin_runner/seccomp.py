"""The seccomp filter of a plugin backend (docs/widget-plugins/SERVER-SIDE.md 5.4, R10).

A classic BPF program over ``struct seccomp_data``: the wrong architecture kills the
process; the syscalls that reach outside the sandbox or into the kernel's internals fail
with EPERM; ``clone`` may not make namespaces, ``socket`` makes only unix and IP sockets,
and ``ioctl`` may not push input into a terminal. Everything else is allowed: the mount
view, Landlock and the namespaces do the rest. Standard library only, since the sandbox
helper runs it before it drops its root.
"""

from __future__ import annotations

import ctypes
import errno
import struct

# struct seccomp_data: int nr; __u32 arch; __u64 instruction_pointer; __u64 args[6]
_NR, _ARCH = 0, 4


def _arg(index: int) -> int:
    # The low 32 bits of an argument, on little-endian machines
    return 16 + 8 * index


AUDIT_ARCH = {"aarch64": 0xC00000B7, "x86_64": 0xC000003E}
X32_SYSCALL_BIT = 0x40000000

# From each architecture's kernel headers (linux-libc-dev): asm-generic/unistd.h for
# aarch64, asm/unistd_64.h for x86_64. A name an architecture lacks is left out.
SYSCALLS: dict[str, dict[str, int]] = {
    "aarch64": {
        "mount": 40, "umount2": 39, "pivot_root": 41, "chroot": 51, "unshare": 97,
        "setns": 268, "clone": 220, "clone3": 435, "ptrace": 117, "process_vm_readv": 270,
        "process_vm_writev": 271, "bpf": 280, "perf_event_open": 241, "keyctl": 219,
        "add_key": 217, "request_key": 218, "kexec_load": 104, "kexec_file_load": 294,
        "init_module": 105, "finit_module": 273, "delete_module": 106,
        "open_by_handle_at": 265, "name_to_handle_at": 264, "userfaultfd": 282,
        "io_uring_setup": 425, "io_uring_enter": 426, "io_uring_register": 427,
        "fsopen": 430, "fsconfig": 431, "fsmount": 432, "fspick": 433, "move_mount": 429,
        "open_tree": 428, "mount_setattr": 442, "acct": 89, "swapon": 224, "swapoff": 225,
        "reboot": 142, "syslog": 116, "settimeofday": 170, "clock_settime": 112,
        "quotactl": 60, "quotactl_fd": 443, "lookup_dcookie": 18, "memfd_secret": 447,
        "kcmp": 272, "pidfd_getfd": 438, "socket": 198, "ioctl": 29,
    },
    "x86_64": {
        "mount": 165, "umount2": 166, "pivot_root": 155, "chroot": 161, "unshare": 272,
        "setns": 308, "clone": 56, "clone3": 435, "ptrace": 101, "process_vm_readv": 310,
        "process_vm_writev": 311, "bpf": 321, "perf_event_open": 298, "keyctl": 250,
        "add_key": 248, "request_key": 249, "kexec_load": 246, "kexec_file_load": 320,
        "init_module": 175, "finit_module": 313, "delete_module": 176,
        "open_by_handle_at": 304, "name_to_handle_at": 303, "userfaultfd": 323,
        "io_uring_setup": 425, "io_uring_enter": 426, "io_uring_register": 427,
        "fsopen": 430, "fsconfig": 431, "fsmount": 432, "fspick": 433, "move_mount": 429,
        "open_tree": 428, "mount_setattr": 442, "acct": 163, "swapon": 167, "swapoff": 168,
        "reboot": 169, "syslog": 103, "settimeofday": 164, "clock_settime": 227,
        "quotactl": 179, "quotactl_fd": 443, "lookup_dcookie": 212, "memfd_secret": 447,
        "kcmp": 312, "pidfd_getfd": 438, "iopl": 172, "ioperm": 173, "uselib": 134,
        "socket": 41, "ioctl": 16,
    },
}

DENIED = (
    # The sandbox's own walls
    "mount", "umount2", "pivot_root", "chroot", "unshare", "setns", "fsopen", "fsconfig",
    "fsmount", "fspick", "move_mount", "open_tree", "mount_setattr",
    # Other processes
    "ptrace", "process_vm_readv", "process_vm_writev", "kcmp", "pidfd_getfd",
    # The kernel's internals
    "bpf", "perf_event_open", "keyctl", "add_key", "request_key", "kexec_load",
    "kexec_file_load", "init_module", "finit_module", "delete_module", "open_by_handle_at",
    "name_to_handle_at", "userfaultfd", "io_uring_setup", "io_uring_enter",
    "io_uring_register", "acct", "swapon", "swapoff", "reboot", "syslog", "settimeofday",
    "clock_settime", "quotactl", "quotactl_fd", "lookup_dcookie", "memfd_secret", "iopl",
    "ioperm", "uselib",
)

NAMESPACE_FLAGS = (
    0x00000080  # CLONE_NEWTIME
    | 0x00020000  # CLONE_NEWNS
    | 0x02000000  # CLONE_NEWCGROUP
    | 0x04000000  # CLONE_NEWUTS
    | 0x08000000  # CLONE_NEWIPC
    | 0x10000000  # CLONE_NEWUSER
    | 0x20000000  # CLONE_NEWPID
    | 0x40000000  # CLONE_NEWNET
)
SOCKET_FAMILIES = (1, 2, 10)  # AF_UNIX, AF_INET, AF_INET6
TIOCSTI = 0x5412

RET_KILL_PROCESS = 0x80000000
RET_ALLOW = 0x7FFF0000
RET_ERRNO = 0x00050000

# BPF opcodes
_LD_W_ABS = 0x20
_JEQ = 0x15
_JGE = 0x35
_JSET = 0x45
_RET = 0x06

Instruction = tuple[int, int, int, int]  # code, jt, jf, k


def _errno(number: int) -> int:
    return RET_ERRNO | (number & 0xFFFF)


def program(arch: str) -> list[Instruction]:
    """The filter for one architecture, as (code, jt, jf, k) instructions."""
    table = SYSCALLS[arch]
    ins: list[Instruction] = [
        (_LD_W_ABS, 0, 0, _ARCH),
        (_JEQ, 1, 0, AUDIT_ARCH[arch]),
        (_RET, 0, 0, RET_KILL_PROCESS),
        (_LD_W_ABS, 0, 0, _NR),
    ]
    if arch == "x86_64":
        # The x32 ABI is another numbering of the same calls
        ins += [(_JGE, 0, 1, X32_SYSCALL_BIT), (_RET, 0, 0, _errno(errno.ENOSYS))]
    for name in DENIED:
        if name in table:
            ins += [(_JEQ, 0, 1, table[name]), (_RET, 0, 0, _errno(errno.EPERM))]
    # clone3 hides its flags behind a pointer: refuse it, and the C library falls back to clone
    ins += [(_JEQ, 0, 1, table["clone3"]), (_RET, 0, 0, _errno(errno.ENOSYS))]
    ins += [
        (_JEQ, 0, 4, table["clone"]),
        (_LD_W_ABS, 0, 0, _arg(0)),
        (_JSET, 0, 1, NAMESPACE_FLAGS),
        (_RET, 0, 0, _errno(errno.EPERM)),
        (_RET, 0, 0, RET_ALLOW),
    ]
    unix, inet, inet6 = SOCKET_FAMILIES
    ins += [
        (_JEQ, 0, 6, table["socket"]),
        (_LD_W_ABS, 0, 0, _arg(0)),
        (_JEQ, 3, 0, unix),
        (_JEQ, 2, 0, inet),
        (_JEQ, 1, 0, inet6),
        (_RET, 0, 0, _errno(errno.EAFNOSUPPORT)),
        (_RET, 0, 0, RET_ALLOW),
    ]
    ins += [
        (_JEQ, 0, 4, table["ioctl"]),
        (_LD_W_ABS, 0, 0, _arg(1)),
        (_JEQ, 0, 1, TIOCSTI),
        (_RET, 0, 0, _errno(errno.EPERM)),
        (_RET, 0, 0, RET_ALLOW),
    ]
    ins.append((_RET, 0, 0, RET_ALLOW))
    return ins


def pack(instructions: list[Instruction]) -> bytes:
    return b"".join(struct.pack("<HBBI", *instruction) for instruction in instructions)


def install(arch: str) -> None:
    """Loads the filter into this process; ``no_new_privs`` must be set already. It is
    inherited by every process this one starts."""
    code = pack(program(arch))
    buffer = ctypes.create_string_buffer(code, len(code))
    fprog = ctypes.create_string_buffer(struct.pack("<HxxxxxxQ", len(code) // 8, ctypes.addressof(buffer)))
    libc = ctypes.CDLL(None, use_errno=True)
    libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
    pr_set_seccomp, seccomp_mode_filter = 22, 2
    if libc.prctl(pr_set_seccomp, seccomp_mode_filter, ctypes.addressof(fprog), 0, 0) != 0:
        number = ctypes.get_errno()
        raise OSError(number, f"seccomp: {errno.errorcode.get(number, number)}")
