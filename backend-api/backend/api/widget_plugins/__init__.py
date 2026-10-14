"""Widget plugins: external packages that add widget types to the Workspace.

The deployer places packages in ``WIDGET_PLUGINS_DIR``. The API reads that directory,
never writes to it, verifies each version, and records what a superuser approved and
what each entity enabled. The SPA runs plugin code in sandboxed frames; nothing here
executes it. Design: ``docs/widget-plugins/``.
"""
