SERVER_INSTRUCTIONS = "\n".join(
    [
        "Expose the active FINOS Workspace browser session as MCP tools. "
        "All tools require a running local FINOS Workspace browser bridge.",
        "",
        "Conventions:",
        "- Use snake_case payloads.",
        "- Do not invent identifiers: every dashboard_id, widget_uuid, tab_id, "
        "origin, backend_id, and skill slug must come from a previous tool result.",
        "- Use add_generative_widget to add a text note (widget_type='note', "
        "placed as a markdown widget) or an HTML widget.",
        "",
        "Recommended workflow:",
        "1. Call get_workspace_snapshot first to discover valid dashboard_id, "
        "dashboard_composition, and skills from the live FINOS Workspace session.",
        "2. Call manage_dashboard with operation='create' when you need a fresh "
        "dashboard.",
        "3. Call list_available_widgets to enumerate candidate widgets, then "
        "get_widget_schema to inspect one exact widget contract before creating it.",
        "4. If a param returns requires_options_lookup=true, call "
        "get_params_options before create_widget or update_widget and do not "
        "invent values for that param.",
        "5. Call create_widget with explicit dashboard_id, origin, widget_id, "
        "data_args, and ui_args.",
        "",
        "Dashboard targeting:",
        "- Every successful command result includes "
        "session_context.current_dashboard_uuid (and current_tab_id) — reuse that "
        "from the previous response instead of calling get_workspace_snapshot "
        "again. Use get_workspace_snapshot only on the first call, or after a "
        "navigation step that may have invalidated the tracked context.",
        "- Resolve dashboard_id from current_dashboard_uuid before each write. "
        "Provide dashboard_id explicitly when operating on a dashboard other than "
        "the current FINOS Workspace route.",
        "- Never match dashboards by name: duplicates with identical names are "
        'common. "This dashboard" means the current route; resolve via '
        "current_dashboard_uuid, not title.",
        "- Widget, navigation, and layout tools operate on an existing dashboard "
        "only; they never create dashboards. Use manage_dashboard with "
        "operation='create' to create a dashboard first. By default it activates "
        "the new dashboard route so follow-up snapshot and widget commands target "
        "it.",
        "",
        "Layout:",
        "- Visible placement is controlled by dashboard composition, not "
        "update_widget. Use manage_dashboard operation='read' or "
        "get_workspace_snapshot.dashboard_composition to inspect tabs and layout, "
        "then use update_widget_layout for x, y, w, h, and tab_id.",
        "- The grid is 40 columns wide: full width is w=40, half width is w=20, "
        "one quarter is w=10. Typical minimums are about min_w=8 and min_h=4. If "
        "a navigation_bar is present it usually occupies y=0 with h=2, so the "
        "first content row usually starts at y=2.",
        "",
        "New-tab workflow:",
        "- add_generative_widget's inner_tab does not create tabs. To put content "
        "on a new tab: call manage_navigation_bar operation='add_tabs' with tabs "
        'such as [{"name":"Q3 Review"}], then navigate_workspace to the '
        "generated slug tab_id (e.g. q3-review), then create the widget "
        "without inner_tab or move an existing widget with update_widget_layout.",
        "",
        "Data availability:",
        "- Ground every dashboard in data the FINOS Workspace already has. Only use "
        "widgets returned by list_available_widgets; do not fetch data from "
        "external sources such as the web or local files, and do not build or "
        "modify a backend to supply missing data.",
        "- If requested data is not available from any existing widget, build the "
        "parts that are available, add a note widget via add_generative_widget "
        "widget_type='note' listing the missing data and where it could come "
        "from, and ask the user how they want to proceed.",
        "- Only follow the app-builder resources to create or extend a backend "
        "when the user explicitly asks for that.",
    ]
)


DASHBOARD_ID_PARAM = (
    "Dashboard UUID. Omit to target the current dashboard route. Never send "
    "placeholder strings such as active_dashboard, current_dashboard, null, or "
    "undefined; reuse session_context.current_dashboard_uuid from your previous "
    "tool result."
)
WIDGET_UUID_PARAM = (
    "Canonical widget instance UUID (preferred identifier). Get it from "
    "manage_dashboard operation='read' or "
    "get_workspace_snapshot.dashboard_composition."
)
WIDGET_ID_FALLBACK_PARAM = (
    "Widget type identifier; fallback only when exactly one matching widget "
    "instance exists on the target dashboard. Never use a widget title as an "
    "identifier."
)
ORIGIN_PARAM = (
    "Widget origin. Pass origin exactly as returned by list_available_widgets."
)


def describe_tool(summary: str, *notes: str) -> str:
    parts = [summary, *notes]
    return " ".join(part for part in parts if part)
