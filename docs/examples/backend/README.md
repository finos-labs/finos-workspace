# Examples backend

One backend serves the three example plugins, so that a single connection gives a dashboard every widget type and the widgets work on the same data. It is a Starlette application in one container, with a gateway in front and a Postgres beside it.

| Path | Answers | For |
|---|---|---|
| `/widgets.json` | The definitions of the widgets below. | The web app, which adds them as a connection. |
| `/plotly/sales`, `/plotly/trend`, `/plotly/signal`, `/plotly/correlation` | A Plotly figure, drawn in the template of the `theme` the app sends. `/plotly/sales?raw=true` answers with its rows. | The `plotly-charts` plugin. |
| `/ag-grid/explicit`, `records`, `columns`, `split`, `dates`, `grouped`, `multicolumn`, `stream` | One table in each of the shapes the `ag-grid` plugin accepts. `stream` moves every five seconds, so the plugin applies the difference as a transaction. | The `ag-grid` plugin. |
| `/sql/chart` | The first column of the `sql` parameter's query as categories and the others as bars, as a Plotly figure. | The `plotly-charts` plugin. |
| `/.workspace/identity`, `/.workspace/health`, `/.workspace/routes/<route>` | The requests of a plugin backend. | The API, for the `sql-explorer` plugin. |

## How the plugins work together

- The files in the image, `sales.csv`, `deals.csv`, `readings.parquet` and `stations.csv`, hold the data of the charts and grids. The SQL explorer's Files source, its *SQL grid* and the *SQL chart* all read them with the same read-only DuckDB, so a query written in the explorer gives the same rows in the grid and in the chart.
- *SQL grid* is a second widget of the SQL explorer plugin: the explorer's editor, with its tables and its completion, and the result in AgGrid in the same card. *SQL chart* is a widget of type `plotly` that the Plotly plugin draws from `/sql/chart`.
- The SQL explorer declares the parameter `sql` and writes it when a query on its Files source has run. Put the explorer and the *SQL chart* on one dashboard and add their `sql` parameters to one group (the link beside the parameter, then +): the editor with its completion is then the input of the chart.
- *Sales by region* has `raw` and `data.rawType: "ag-grid"`, so the database button of its card shows its rows in the AgGrid plugin ([Widget rows](../../reference/protocols/raw-rows.md)).

## What can reach what

The backend runs as an unprivileged user on a read-only root, without capabilities, on two internal networks. Only the gateway joins the FINOS Workspace network and the host:

- Port 7798 of the gateway, published on `127.0.0.1`, forwards `/widgets.json`, `/plotly/`, `/ag-grid/` and `/sql/`. It never forwards `/.workspace/`, because those routes take a database URL from their caller. The backend allows the web apps at `http://localhost:3000` and `http://localhost:1420`.
- Port 8081 of the gateway, reachable only from the FINOS Workspace network, forwards `/.workspace/` and nothing else.
- The backend reaches the Postgres and the gateway, and not the API or the internet.

`/sql/chart` takes no credentials: they answer anyone who reaches port 7798, with the limits of the SQL explorer's Files source (one SELECT, 15 seconds, 1,000 rows, nothing outside `/data`).

## Run it

Build the SQL explorer package first, because the image carries `docs/examples/sql-explorer/dist/sql-explorer/<version>` and reports its digest as the plugin's identity ([SQL explorer](../sql-explorer/README.md)).

```bash
python3 setup.py
```

writes the Postgres passwords to `.env`, which Compose reads, and the plugin's `postgres_url` secret to `secrets/`, both readable by you only. Then, with `<version>` the package version of the SQL explorer and `<network>` the network of the FINOS Workspace stack (`docker network ls`; `workspace_workspace` for the root `docker-compose.yml`):

```bash
VERSION=<version> WORKSPACE_NETWORK=<network> docker compose up -d --build
```

Place the three built packages in the plugins directory and approve, enable and grant them as [How to deploy a plugin](../../how-to/plugins/deploy-a-plugin.md) describes. For the SQL explorer, list the backend in the API's environment, `WIDGET_PLUGIN_BACKENDS={"sql-explorer": "http://examples-gateway:8081"}`, add `tcp://postgres:5432` to its server network with private hosts confirmed, and set its `postgres_url` secret from `secrets/workspace/sql-explorer/postgres_url`. Then add `http://localhost:7798` under Connections and put the widgets of the categories *Plotly examples* and *AgGrid examples*, and the SQL explorer and SQL grid, on a dashboard.

On Postgres, the SQL explorer has the `demo` schema; on Files it has `sales`, `deals`, `readings` and `stations`. For example:

```sql
SELECT region, sum(units) AS units FROM sales GROUP BY region ORDER BY region
```

`reach.py` shows what the backend can reach: `docker exec -i widget-examples-backend-1 python - postgres:5432 api:8000 < reach.py`.

## Test

```bash
python3 -m venv .venv
```

```bash
.venv/bin/pip install -r requirements.txt pytest==9.1.1 httpx2==2.13.1
```

```bash
.venv/bin/python -m pytest -q tests
```

`tests/test_server.py` runs the application against files it writes. `tests/test_isolation.py` needs Docker and the built SQL explorer package: it starts `compose.yaml` under a project name of its own, beside a stand-in for the API, and checks what each side can reach, what the gateway forwards and that the backend is unprivileged. It removes what it started.
