from prometheus_client import Counter, Histogram

DISCOVERIES = Counter(
    "widget_plugin_discoveries_total",
    "Plugin versions a rescan recorded, by what it found",
    ["outcome"],
)
BLOCKS = Counter(
    "widget_plugin_blocks_total",
    "Plugin versions blocked, by reason",
    ["reason"],
)
APPROVALS = Counter("widget_plugin_approvals_total", "Plugin versions approved")
FILE_FETCHES = Counter(
    "widget_plugin_file_fetches_total",
    "Plugin files asked for, by outcome",
    ["outcome"],
)
PROXY_CALLS = Counter(
    "widget_plugin_proxy_calls_total",
    "Proxy calls, by plugin, outcome and the upstream's status class",
    ["plugin", "outcome", "status_class"],
)
PROXY_SECONDS = Histogram(
    "widget_plugin_proxy_call_seconds",
    "How long proxy calls took, by plugin",
    ["plugin"],
    buckets=(0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30),
)
BACKEND_CALLS = Counter(
    "widget_plugin_backend_calls_total",
    "Backend route calls, by plugin, outcome and the backend's status class",
    ["plugin", "outcome", "status_class"],
)
BACKEND_SECONDS = Histogram(
    "widget_plugin_backend_call_seconds",
    "How long backend route calls took, by plugin",
    ["plugin"],
    buckets=(0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30),
)
BACKEND_IDENTITY = Counter(
    "widget_plugin_backend_identity_checks_total",
    "Identity checks of plugin backends, by plugin and result",
    ["plugin", "state"],
)
BROKER_CALLS = Counter(
    "widget_plugin_broker_calls_total",
    "Data the broker read for plugin backends, by plugin and outcome",
    ["plugin", "outcome"],
)
CSP_REPORTS = Counter(
    "widget_plugin_csp_reports_total",
    "Requests plugin frames reported their policy blocked, by directive",
    ["directive"],
)
FRAME_FAILURES = Counter(
    "widget_plugin_frame_failures_total",
    "Plugin frames that failed, by plugin, version and kind",
    ["plugin", "version", "kind"],
)


def status_class(status: int | None) -> str:
    return f"{status // 100}xx" if status else "none"
