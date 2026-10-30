import re
from typing import Annotated, Any, Literal

from pydantic import (
    AfterValidator,
    BaseModel as PydanticBaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from . import (
    csp as csp_rules,
    proxy as proxy_rules,
)
from .proxy import MAX_TIMEOUT_MS, NAME_PATTERN, PROXY_ID_PATTERN, Proxy, RouteArg
from .schema_lint import lint_fragment, lint_settings_schema, validate_settings_values

HOST_API = 1
HOST_AFM = "0.11"

PLUGIN_ID_PATTERN = r"^[a-z][a-z0-9-]{1,47}$"
WIDGET_ID_PATTERN = r"^[a-z][a-z0-9_-]{0,47}$"
VIZ_TYPE_PATTERN = r"^[a-z][a-z0-9_-]{1,31}$"
VERSION_PATTERN = r"^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$"
DIGEST_PATTERN = r"^sha256-[A-Za-z0-9_-]{43}$"

BUILT_IN_TYPES = frozenset({"markdown", "html", "iframe", "newsfeed", "pdf"})

PERMISSIONS = frozenset(
    {
        "core:default",
        "core:data:read",
        "core:params:write",
        "core:state:write",
        "core:copilot:context",
        "core:export:provide",
        "core:ui:notify",
        "core:ui:open-link",
        "core:clipboard:write",
        "core:download:save",
        "core:proxy:call",
        "core:backend:call",
    }
)
PERMISSIONS_LATER = frozenset({"core:data:query"})
MAX_ROUTE_BYTES = 5 * 1024 * 1024


_TRAIT_BINDING = re.compile(
    r"^(data|params|definition|config|adminSettings|state|theme|capabilities|meta)$"
    r"|^param:[A-Za-z_][A-Za-z0-9_.-]{0,63}$"
    r"|^(config|adminSettings):[A-Za-z][A-Za-z0-9_]{0,63}$"
)
_WRITABLE = re.compile(r"^(params|param:.+|state)$")

ShortText = Annotated[str, StringConstraints(min_length=1, max_length=80)]
Sentence = Annotated[str, StringConstraints(max_length=300)]


def _package_path(value: str) -> str:
    parts = value.split("/")
    if (
        not re.fullmatch(r"[A-Za-z0-9._/-]{1,200}", value)
        or value.startswith("/")
        or any(part in {"", ".", ".."} for part in parts)
    ):
        raise ValueError(f"{value!r} is not a relative path inside the package")
    return value


PackagePath = Annotated[str, AfterValidator(_package_path)]

closed = ConfigDict(extra="forbid", frozen=True)


class BaseModel(PydanticBaseModel):
    model_config = closed


class Publisher(BaseModel):
    model_config = closed

    name: Annotated[str, StringConstraints(min_length=1, max_length=100)]
    url: Annotated[str, StringConstraints(pattern=r"^https://[^\s]{1,200}$")] | None = None


class HostTarget(BaseModel):
    model_config = closed

    api: int
    afm: Annotated[str, StringConstraints(max_length=16)]

    @model_validator(mode="after")
    def supported(self):
        if self.api != HOST_API:
            raise ValueError(f"targets host API {self.api}; this FINOS Workspace implements {HOST_API}")
        if self.afm != HOST_AFM:
            raise ValueError(f"follows AFM {self.afm}; this FINOS Workspace implements {HOST_AFM}")
        return self


class Entry(BaseModel):
    model_config = closed

    module: PackagePath
    styles: list[PackagePath] = Field(default_factory=list, max_length=8)

    @field_validator("module")
    @classmethod
    def javascript(cls, value: str) -> str:
        if not value.endswith(".js") or value.startswith("backend/"):
            raise ValueError("the entry module is a .js file outside backend/")
        return value

    @field_validator("styles")
    @classmethod
    def stylesheets(cls, value: list[str]) -> list[str]:
        if any(not s.endswith(".css") or s.startswith("backend/") for s in value):
            raise ValueError("styles are .css files outside backend/")
        return value


class Secret(BaseModel):
    model_config = closed

    name: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,63}$")]
    purpose: Sentence


class DataSource(BaseModel):
    model_config = closed

    id: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_-]{0,63}$")]
    purpose: Sentence


class RouteResponse(BaseModel):
    model_config = closed

    maxBytes: int = Field(default=1024 * 1024, ge=1, le=MAX_ROUTE_BYTES)  # noqa: N815
    timeoutMs: int = Field(default=10_000, ge=100, le=MAX_TIMEOUT_MS)  # noqa: N815


class Route(BaseModel):
    model_config = closed

    id: Annotated[str, StringConstraints(pattern=PROXY_ID_PATTERN)]
    args: dict[Annotated[str, StringConstraints(pattern=NAME_PATTERN)], RouteArg] = Field(
        default_factory=dict, max_length=32
    )
    secrets: list[Annotated[str, StringConstraints(pattern=NAME_PATTERN)]] = Field(default_factory=list, max_length=16)
    response: RouteResponse = Field(default_factory=RouteResponse)


class Backend(BaseModel):
    model_config = closed

    protocol: Literal[1]
    routes: list[Route] = Field(min_length=1, max_length=32)


class Server(BaseModel):
    model_config = closed

    network: list[Annotated[str, StringConstraints(max_length=255)]] = Field(default_factory=list, max_length=32)
    proxies: list[Proxy] = Field(default_factory=list, max_length=32)
    backend: Backend | None = None


class SettingsSpec(BaseModel):
    model_config = closed

    schema_: dict[str, Any] = Field(default_factory=dict, alias="schema")
    defaults: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def valid(self):
        problems = lint_settings_schema(self.schema_) if self.schema_ else []
        if not problems and self.defaults:
            problems = validate_settings_values(self.schema_, self.defaults)
        if problems:
            raise ValueError("; ".join(problems))
        return self


class TraitBinding(BaseModel):
    model_config = closed

    bind: Annotated[str, StringConstraints(max_length=80)]
    access: Literal["read", "readwrite"] = "read"

    @model_validator(mode="after")
    def valid(self):
        if not _TRAIT_BINDING.fullmatch(self.bind):
            raise ValueError(f"{self.bind!r} is not a host binding")
        if self.access == "readwrite" and not _WRITABLE.fullmatch(self.bind):
            raise ValueError(f"{self.bind!r} is read-only")
        return self


class ModelSpec(BaseModel):
    model_config = closed

    traits: dict[
        Annotated[str, StringConstraints(pattern=r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")],
        TraitBinding,
    ] = Field(default_factory=dict, max_length=64)


class Response(BaseModel):
    model_config = closed

    accepts: Literal["json"] = "json"
    description: Sentence = ""
    schema_: dict[str, Any] | None = Field(default=None, alias="schema")


class Handle(BaseModel):
    model_config = closed

    type: Annotated[str, StringConstraints(pattern=VIZ_TYPE_PATTERN)]
    definition: dict[str, Any] | None = None
    response: Response = Field(default_factory=Response)

    @model_validator(mode="after")
    def valid(self):
        if self.type in BUILT_IN_TYPES:
            raise ValueError(f"{self.type!r} is a built-in widget type")
        if self.definition is not None:
            problems = lint_fragment(self.definition)
            if problems:
                raise ValueError("the definition is not closed and bounded: " + "; ".join(problems[:10]))
        return self


class Grid(BaseModel):
    model_config = closed

    w: Annotated[int, Field(ge=1, le=40)] = 20
    h: Annotated[int, Field(ge=1, le=100)] = 12
    minW: Annotated[int, Field(ge=1, le=40)] | None = None  # noqa: N815
    minH: Annotated[int, Field(ge=1, le=100)] | None = None  # noqa: N815


class WidgetServer(BaseModel):
    model_config = closed

    proxies: list[Annotated[str, StringConstraints(max_length=64)]] = Field(default_factory=list, max_length=32)
    routes: list[Annotated[str, StringConstraints(max_length=64)]] = Field(default_factory=list, max_length=32)


class Widget(BaseModel):
    model_config = closed

    id: Annotated[str, StringConstraints(pattern=WIDGET_ID_PATTERN)]
    name: ShortText
    description: Sentence = ""
    category: Annotated[str, StringConstraints(max_length=60)] | None = None
    subCategory: Annotated[str, StringConstraints(max_length=60)] | None = None  # noqa: N815
    handles: list[Handle] = Field(default_factory=list, max_length=8)
    standalone: bool = False
    permissions: list[str] = Field(default_factory=list, max_length=32)
    server: WidgetServer | None = None
    model: ModelSpec | None = None
    params: list[dict[str, Any]] = Field(default_factory=list, max_length=32)
    settings: SettingsSpec | None = None
    grid: Grid = Field(default_factory=Grid)

    @model_validator(mode="after")
    def valid(self):
        if not self.handles and not self.standalone:
            raise ValueError("a widget handles at least one type, or is standalone")
        types = [h.type for h in self.handles]
        if len(set(types)) != len(types):
            raise ValueError("a type is handled twice")
        for permission in self.permissions:
            if permission in PERMISSIONS_LATER:
                raise ValueError(f"{permission} is not available on this FINOS Workspace yet")
            if permission not in PERMISSIONS:
                raise ValueError(f"{permission!r} is not a host permission")
        if len(set(self.permissions)) != len(self.permissions):
            raise ValueError("a permission is listed twice")
        calls_proxies = bool(self.server and self.server.proxies)
        if calls_proxies != ("core:proxy:call" in self.permissions):
            raise ValueError("a widget that names proxies has the permission core:proxy:call, and only then")
        calls_routes = bool(self.server and self.server.routes)
        if calls_routes != ("core:backend:call" in self.permissions):
            raise ValueError("a widget that names backend routes has the permission core:backend:call, and only then")
        names = [p.get("paramName") for p in self.params]
        if not all(isinstance(n, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.-]{0,63}", n) for n in names):
            raise ValueError("every param has a paramName")
        if len(set(names)) != len(names):
            raise ValueError("a paramName is declared twice")
        return self


SKILL_SLUG_PATTERN = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"
SKILL_FILE_PATTERN = r"^skills/[A-Za-z0-9._-]{1,100}\.md$"


class Skill(BaseModel):
    slug: Annotated[str, StringConstraints(pattern=SKILL_SLUG_PATTERN, min_length=2, max_length=50)]
    description: Annotated[str, StringConstraints(min_length=1, max_length=300)]
    file: Annotated[str, StringConstraints(pattern=SKILL_FILE_PATTERN)]


class Contributes(BaseModel):
    model_config = closed

    widgets: list[Widget] = Field(min_length=1, max_length=20)
    skills: list[Skill] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def unique(self):
        ids = [w.id for w in self.widgets]
        if len(set(ids)) != len(ids):
            raise ValueError("widget ids must be unique")
        slugs = [s.slug for s in self.skills]
        if len(set(slugs)) != len(slugs):
            raise ValueError("skill slugs must be unique")
        files = [s.file for s in self.skills]
        if len(set(files)) != len(files):
            raise ValueError("two skills name the same file")
        types = [h.type for w in self.widgets for h in w.handles]
        if len(set(types)) != len(types):
            raise ValueError("two widgets of the plugin handle the same type")
        return self


class Manifest(BaseModel):
    model_config = closed

    manifestVersion: Literal[1]  # noqa: N815
    id: Annotated[str, StringConstraints(pattern=PLUGIN_ID_PATTERN)]
    version: Annotated[str, StringConstraints(pattern=VERSION_PATTERN)]
    name: ShortText
    description: Sentence = ""
    publisher: Publisher
    icon: PackagePath | None = None
    host: HostTarget
    checksum: Annotated[str, StringConstraints(pattern=DIGEST_PATTERN)]
    entry: Entry
    csp: dict[str, list[str]] | None = None
    cspNotes: dict[str, Sentence] | None = None  # noqa: N815
    secrets: list[Secret] = Field(default_factory=list, max_length=16)
    dataSources: list[DataSource] = Field(default_factory=list, max_length=16)  # noqa: N815
    identity: Literal["none", "pseudonymous"] = "none"
    server: Server | None = None
    adminSettings: SettingsSpec | None = None  # noqa: N815
    contributes: Contributes
    signatures: None = None

    @model_validator(mode="after")
    def valid(self):
        check = csp_rules.check_policy(self.csp)
        if not check.ok:
            raise ValueError("csp: " + "; ".join(check.errors))
        for directive in self.cspNotes or {}:
            if directive not in (self.csp or {}):
                raise ValueError(f"cspNotes: {directive} is not in csp")
        self._check_server()
        if self.icon and not self.icon.startswith("assets/"):
            raise ValueError("the icon is a file under assets/")
        return self

    def _check_server(self) -> None:
        secrets = [s.name for s in self.secrets]
        if len(set(secrets)) != len(secrets):
            raise ValueError("a secret is declared twice")
        server = self.server or Server()
        check = proxy_rules.check_network(list(server.network), backend=server.backend is not None)
        problems = list(check.errors)
        ids = [p.id for p in server.proxies]
        if len(set(ids)) != len(ids):
            problems.append("a proxy id is declared twice")
        for proxy in server.proxies:
            problems.extend(proxy_rules.check_proxy(proxy, list(server.network), set(secrets)))
        problems.extend(self._backend_problems(server, set(secrets)))
        routes = [r.id for r in server.backend.routes] if server.backend else []
        for widget in self.contributes.widgets:
            for proxy_id in widget.server.proxies if widget.server else []:
                if proxy_id not in ids:
                    problems.append(f"widget {widget.id}: {proxy_id!r} is not a declared proxy")
            for route_id in widget.server.routes if widget.server else []:
                if route_id not in routes:
                    problems.append(f"widget {widget.id}: {route_id!r} is not a route of the backend")
        if self.secrets and not (server.proxies or server.backend):
            problems.append("secrets are for proxies and backend routes, and this plugin declares neither")
        if problems:
            raise ValueError("; ".join(problems))

    def _backend_problems(self, server: Server, secrets: set[str]) -> list[str]:
        problems: list[str] = []
        sources = [d.id for d in self.dataSources]
        if len(set(sources)) != len(sources):
            problems.append("a data source is declared twice")
        if not server.backend:
            if self.dataSources or self.identity != "none":
                problems.append("data sources and identity are for a plugin backend, and this plugin declares none")
            return problems
        routes = [r.id for r in server.backend.routes]
        if len(set(routes)) != len(routes):
            problems.append("a route id is declared twice")
        for route in server.backend.routes:
            problems.extend(
                f"server.backend.routes[{route.id}]: {name!r} is not a declared secret"
                for name in route.secrets
                if name not in secrets
            )
            if len(set(route.secrets)) != len(route.secrets):
                problems.append(f"server.backend.routes[{route.id}]: a secret is listed twice")
        return problems

    def skill_paths(self) -> set[str]:
        return {skill.file for skill in self.contributes.skills}

    def served_paths(self) -> set[str]:
        paths = {self.entry.module, *self.entry.styles}
        if self.icon:
            paths.add(self.icon)
        return paths
