[![badge-labs](https://user-images.githubusercontent.com/327285/230928932-7c75f8ed-e57b-41db-9fb7-a292a13a1e58.svg)](https://community.finos.org/docs/governance/lifecycle-stages/labs)

<h1 align="center">
  <img alt="FINOS Workspace: an open, self-hosted analytics workspace for financial institutions to connect data, tools, and AI agents" src="website/static/img/banner.svg">
</h1>

<div align="center">

**[Run it on your machine](docs/technical-guide/build-from-source/run-the-stack-from-source.md)** · [User Guide](docs/user-guide/index.md) · [Technical Guide](docs/technical-guide/index.md) · [Reference](docs/reference/index.md) · [FAQ](docs/faq/index.md) · [Plugins](docs/plugins/index.md) · [Contribute](docs/contributing/index.md)

</div>

<p align="center">
  <img alt="A FINOS Workspace dashboard with tables of revenue by region, notes and key figures" src="frontend/public/assets/images/features/grouping.png" width="640">
</p>

Users connect their own data backends and arrange the data in dashboards of widgets. An AI agent answers questions about the dashboards, outside AI tools reach them through an MCP server, roles decide who may use what, and plugins add new kinds of widgets.

The code is in `frontend/`, `backend-api/`, `agent/` (Ines and its MCP server), `local/` (the development stack) and `docs/` with `website/` (the documentation).

## License

Copyright 2026 FINOS

Distributed under the [Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0).

SPDX-License-Identifier: [Apache-2.0](https://spdx.org/licenses/Apache-2.0)

Individual components may carry additional notices in their own directories.
