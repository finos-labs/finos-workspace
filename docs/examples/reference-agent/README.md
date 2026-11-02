# Reference agent

An agent for FINOS Workspace that answers questions about the widgets of a dashboard without a
model. It serves `/agents.json`, answers `POST /v1/query` with a stream of events, reads the data
of a widget through a function call, and cites the widget. It comes in Python (`python/`) and
TypeScript (`typescript/`), and both answer every request the same way.

The docs build it step by step: [Build your own agent](../../tutorials/agents/build-your-own-agent.md).

## Run it

Python 3.10 or later:

```bash
cd python
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 6060
```

Or Node.js 22.18 or later, with nothing to install:

```bash
cd typescript
node main.ts
```

Then add `http://localhost:6060` in FINOS Workspace under AI, AI Agents, Add Agent. `PORT`
sets the port of the TypeScript version.

## Test it

The test starts both versions and checks that they answer alike:

```bash
PYTHON=python/.venv/bin/python node --test test/parity.test.mjs
```
