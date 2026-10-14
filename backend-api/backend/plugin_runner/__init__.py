"""The plugin runner (docs/widget-plugins/SERVER-SIDE.md 5.4, recipe B): a supervisor program
of its own that runs plugin backends in a single-image deployment, each in a sandbox of
namespaces, a private mount view, Landlock, seccomp and resource limits, reached only through
the runner's relays. It refuses to start a backend when any layer cannot be applied.

    python -m plugin_runner /etc/workspace/plugin-runner.toml
"""
