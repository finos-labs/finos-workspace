# Reference backend

A data backend for FINOS Workspace with a widget of every built-in type, every kind of
parameter, the widget settings, two linked widgets, a form and an app. It comes in Python
(`python/`) and TypeScript (`typescript/`), and both answer every request the same way.
Every name, number and document in it is invented.

The docs explain each widget with its code: [The reference backend](../../technical-guide/build-a-backend/index.mdx).

## Run it

Python 3.10 or later:

```bash
cd python
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 5050
```

Or Node.js 22.18 or later, with nothing to install:

```bash
cd typescript
node main.ts
```

Then connect `http://localhost:5050` in FINOS Workspace under Connections. `APP_ORIGIN`
sets the web app's address that the backend allows (`http://localhost:3000` by default),
and `PORT` the port.

## Test it

The test starts both versions and checks that they answer alike:

```bash
PYTHON=python/.venv/bin/python node --test test/parity.test.mjs
```
