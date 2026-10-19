"""The Content-Security-Policy model of widget plugin frames.

A policy is a map of directive to sources, never a raw string. Authors declare one,
a superuser approves or overrides it per directive, an entity admin may only narrow
it, and the platform owns a floor nobody can remove (docs/widget-plugins/SECURITY.md
section 4). The same rules are implemented in ``frontend/src/plugins/csp.ts``; both
run the cases in ``frontend/src/plugins/csp-cases.json``.
"""

import ipaddress
import re
from dataclasses import dataclass, field

# Directives a plugin may ask for, or an admin may override
POLICY_DIRECTIVES = (
    "connect-src",
    "img-src",
    "font-src",
    "media-src",
    "style-src",
    "script-src",
    "worker-src",
    "frame-src",
)
MAX_SOURCES = 32
MAX_PORT = 65535
MAX_SOURCE_LENGTH = 255

# Confirmations a superuser gives in an override for sources an author may not request
INSECURE_SCHEME = "insecure-scheme"
PRIVATE_HOST = "private-host"
REMOTE_SCRIPT = "remote-script"

# What every frame gets. The host adds the hash of its shell script to script-src.
FLOOR: dict[str, list[str]] = {
    "default-src": ["'none'"],
    "base-uri": ["'none'"],
    "object-src": ["'none'"],
    "form-action": ["'none'"],
    "script-src": ["blob:"],
    "style-src": ["'unsafe-inline'", "blob:"],
    "img-src": ["data:", "blob:"],
    "font-src": ["data:", "blob:"],
    "media-src": ["data:", "blob:"],
    "worker-src": ["blob:"],
    "connect-src": ["'none'"],
    "frame-src": ["'none'"],
}

_LABEL = r"(?!-)[a-z0-9-]{1,63}(?<!-)"
_HOST = re.compile(rf"^(\*\.)?{_LABEL}(\.{_LABEL})*$")
_URL = re.compile(r"^(?P<scheme>https|wss|http|ws)://(?P<host>[^/:?#@]+)(?P<port>:\d{1,5})?(?P<path>/[^?#]*)?$")
_HASH = re.compile(r"^'sha(256|384|512)-[A-Za-z0-9+/]+={0,2}'$")
_SCHEME = re.compile(r"[a-z][a-z0-9+.-]*")
_BAD_CHARACTERS = set(' \t\r\n\f\v,;"<>&\\`')
_PRIVATE_SUFFIXES = (".local", ".internal", ".localhost", ".home.arpa", ".lan")


@dataclass
class PolicyCheck:
    """The result of checking a policy: errors, and the confirmations it needs."""

    errors: list[str] = field(default_factory=list)
    needs: set[str] = field(default_factory=set)

    @property
    def ok(self) -> bool:
        return not self.errors


def _is_ip(host: str) -> bool:
    candidate = host.strip("[]")
    try:
        ipaddress.ip_address(candidate)
        return True
    except ValueError:
        return bool(re.fullmatch(r"[0-9.]+", candidate))


def _check_url(directive: str, source: str, check: PolicyCheck) -> None:
    match = _URL.match(source)
    if not match:
        check.errors.append(f"{directive}: {source!r} is not a valid source")
        return
    scheme, host = match["scheme"], match["host"]
    if scheme in {"wss", "ws"} and directive != "connect-src":
        check.errors.append(f"{directive}: {scheme}:// sources are only valid in connect-src")
        return
    if scheme in {"http", "ws"}:
        check.needs.add(INSECURE_SCHEME)
    if _is_ip(host):
        check.needs.add(PRIVATE_HOST)
    elif not _HOST.match(host):
        check.errors.append(f"{directive}: {source!r} has a host that is not a lowercase DNS name")
        return
    else:
        bare = host.removeprefix("*.")
        if host.startswith("*.") and "." not in bare:
            check.errors.append(f"{directive}: a wildcard needs at least two labels")
            return
        if bare == "localhost" or "." not in bare or bare.endswith(_PRIVATE_SUFFIXES):
            check.needs.add(PRIVATE_HOST)
    if match["port"] and not 0 < int(match["port"][1:]) <= MAX_PORT:
        check.errors.append(f"{directive}: {source!r} has an invalid port")
    if directive == "script-src":
        check.needs.add(REMOTE_SCRIPT)


def check_source(directive: str, source: object, check: PolicyCheck) -> None:  # noqa: PLR0911 - one return per rule
    """Check one source of one directive, adding errors and needed confirmations."""
    if not isinstance(source, str) or not source:
        check.errors.append(f"{directive}: sources are non-empty strings")
        return
    if len(source) > MAX_SOURCE_LENGTH:
        check.errors.append(f"{directive}: a source longer than {MAX_SOURCE_LENGTH}")
        return
    if not source.isascii() or any(c in _BAD_CHARACTERS for c in source):
        check.errors.append(f"{directive}: {source!r} contains a character that is not allowed")
        return

    if source in {"data:", "blob:"}:
        return
    if source.startswith("'"):
        if source in {"'unsafe-eval'", "'wasm-unsafe-eval'"}:
            if directive != "script-src":
                check.errors.append(f"{directive}: {source} is only valid in script-src")
            return
        if source == "'unsafe-inline'":
            if directive != "style-src":
                check.errors.append(f"{directive}: 'unsafe-inline' is only valid in style-src")
            return
        if _HASH.match(source):
            if directive not in {"script-src", "style-src"}:
                check.errors.append(f"{directive}: hashes are only valid in script-src and style-src")
            return
        check.errors.append(f"{directive}: {source} is not allowed")
        return
    # A whole scheme, such as "https:"
    if source == "*" or (source.endswith(":") and _SCHEME.fullmatch(source[:-1])):
        check.errors.append(f"{directive}: {source!r} is too broad; name a host")
        return
    _check_url(directive, source, check)


def check_policy(
    policy: object, *, confirmations: frozenset[str] | set[str] | None = None, override: bool = False
) -> PolicyCheck:
    """Check a policy declared by an author (``override=False``) or set by a superuser.

    An author may not request a source that needs a confirmation. A superuser may, when
    the request carries that confirmation.
    """
    check = PolicyCheck()
    if policy is None:
        return check
    if not isinstance(policy, dict):
        check.errors.append("the policy must be an object of directive to sources")
        return check
    for directive, sources in policy.items():
        if directive not in POLICY_DIRECTIVES:
            check.errors.append(f"{directive}: not a directive a plugin policy may set")
            continue
        if not isinstance(sources, list):
            check.errors.append(f"{directive}: must be a list of sources")
            continue
        if len(sources) > MAX_SOURCES:
            check.errors.append(f"{directive}: more than {MAX_SOURCES} sources")
            continue
        if "'none'" in sources:
            if len(sources) > 1:
                check.errors.append(f"{directive}: 'none' must be the only source")
            continue
        for source in sources:
            check_source(directive, source, check)

    given = set(confirmations or ())
    missing = check.needs - given
    if missing:
        if override:
            check.errors.extend(f"needs the confirmation {name!r}" for name in sorted(missing))
        else:
            check.errors.extend(f"needs a superuser override with the confirmation {name!r}" for name in sorted(missing))
    return check


def approved_policy(declared: dict | None, overrides: dict | None) -> dict[str, list[str]]:
    """What a superuser accepted: an override replaces the declared list per directive."""
    # Each bound first: Cython 3.3 crashes inferring `(x or {}).items()` (the single image
    # compiles this module)
    declared_policy = declared or {}
    replaced = overrides or {}
    result = {d: list(s) for d, s in declared_policy.items() if d in POLICY_DIRECTIVES}
    for directive, sources in replaced.items():
        if directive in POLICY_DIRECTIVES:
            result[directive] = list(sources)
    return result


def narrow(policy: dict[str, list[str]], narrowing: dict | None) -> dict[str, list[str]]:
    """Restrict a policy to the sources an entity allows, per narrowed directive."""
    if not narrowing:
        return policy
    result = dict(policy)
    for directive, allowed in narrowing.items():
        if directive in result:
            result[directive] = [s for s in result[directive] if s in set(allowed)]
    return result


def compose(policy: dict[str, list[str]]) -> dict[str, list[str]]:
    """The effective policy: the floor plus what was approved and not narrowed away."""
    effective = {d: list(s) for d, s in FLOOR.items()}
    for directive, sources in policy.items():
        added = [s for s in sources if s != "'none'"]
        if not added or directive not in effective:
            continue
        base = [s for s in effective[directive] if s != "'none'"]
        effective[directive] = base + [s for s in added if s not in base]
    return effective


def hosts(policy: dict[str, list[str]]) -> list[str]:
    """Every host a policy lets a frame reach, for the egress summary."""
    found: list[str] = []
    for sources in policy.values():
        for source in sources:
            match = _URL.match(source)
            if match and match["host"] not in found:
                found.append(match["host"])
    return found


def directive_risk(directive: str, sources: list[str]) -> str:
    """The risk of what a directive permits (SECURITY.md 4.4)."""
    remote = [s for s in sources if _URL.match(s)]
    if any(s.startswith(("http://", "ws://")) for s in remote) or any(
        _is_ip(_URL.match(s)["host"])
        for s in remote  # type: ignore[index]
    ):
        return "critical"
    if directive == "script-src" and remote:
        return "critical"
    if directive in {"connect-src", "frame-src"} and remote:
        return "high"
    if remote or "'unsafe-eval'" in sources:
        return "medium"
    if "'wasm-unsafe-eval'" in sources:
        return "low"
    return "none"
