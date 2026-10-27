---
title: Minimal Backend (Python + FastAPI)
uri: workspace://examples/python-fastapi/minimal
use_when: You are starting a new Python backend for FINOS Workspace and want the recommended starter shape.
language_specific: true
related:
  - workspace://contract/backend
  - workspace://specs/widgets-json
  - workspace://specs/apps-json
  - workspace://examples/generic-http/minimal
---

# Minimal Backend — Python + FastAPI

> This is an **implementation example**, not a platform requirement. FINOS Workspace is language-agnostic. If your project already uses a different framework, use that. See `workspace://examples/generic-http/minimal` for the framework-neutral shape.

FastAPI is the recommended Python starter because most current FINOS Workspace examples are written against it.

## Project shape

```
my-backend/
├── main.py            # FastAPI app + routes
├── widgets.json       # Widget metadata (served from /widgets.json)
├── apps.json          # App templates (served from /apps.json)
└── requirements.txt   # fastapi, uvicorn, ...
```

## `main.py` shape

```python
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from pathlib import Path
import json

app = FastAPI()

# CORS: allow the origin your FINOS Workspace is served from, and the local development server
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://<your-workspace-host>",
        "http://localhost:1420",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

WIDGETS_FILE = Path(__file__).parent / "widgets.json"
APPS_FILE    = Path(__file__).parent / "apps.json"

@app.get("/widgets.json")
def get_widgets():
    # encoding="utf-8" is load-bearing — Windows defaults to cp1252 and will
    # silently mangle any non-ASCII content in the JSON file.
    with open(WIDGETS_FILE, encoding="utf-8") as f:
        return JSONResponse(content=json.load(f))

@app.get("/apps.json")
def get_apps():
    with open(APPS_FILE, encoding="utf-8") as f:
        return JSONResponse(content=json.load(f))

@app.get("/summary", response_class=PlainTextResponse)
def summary(team: str = Query("platform")):
    # Replace with a real data source.
    return f"## {team.title()}: week 17\n\n- Shipped the new importer.\n- Two incidents, both resolved within the hour.\n"

@app.get("/teams")
def teams():
    return [
        {"label": "Platform", "value": "platform"},
        {"label": "Support",  "value": "support"},
    ]
```

## `widgets.json` shape

```json
{
  "weekly_summary": {
    "name": "Weekly Summary",
    "description": "The week's activity for one team, as written commentary",
    "type": "markdown",
    "endpoint": "/summary",
    "gridData": { "w": 20, "h": 12 },
    "params": [
      { "paramName": "team", "type": "endpoint", "label": "Team",
        "description": "Team to summarize", "optionsEndpoint": "/teams", "value": "platform" }
    ]
  }
}
```

## `apps.json` shape

```json
[
  {
    "name": "Team Summary",
    "description": "Weekly summary of a team",
    "img": "", "img_dark": "", "img_light": "",
    "allowCustomization": true,
    "tabs": {
      "": {
        "id": "", "name": "",
        "layout": [
          { "i": "weekly_summary", "x": 0, "y": 0, "w": 40, "h": 12, "groups": ["Group 1"] }
        ]
      }
    },
    "groups": [
      {
        "name": "Group 1",
        "type": "endpointParam",
        "paramName": "team",
        "widgetIds": ["weekly_summary"],
        "defaultValue": "platform"
      }
    ],
    "prompts": []
  }
]
```

## Run and register

```text
uvicorn main:app --reload --port 7779
```

Then in FINOS Workspace: Settings → Data Connectors → Connect Backend → `http://localhost:7779`.

## Notes specific to Python

- **Always pass `encoding="utf-8"` to `open()`.** Defaults to OS locale. cp1252 on Windows will mangle non-ASCII characters silently.
- **No title inside the content.** The widget header already shows `name`; a heading that repeats it doubles up.
- **Support `raw=True` on `html` endpoints.** When the widget sets `"raw": true`, return the underlying rows as JSON when `raw=true` is passed, so AI agents can consume the data.
- **Reasonable runButton.** Default to `runButton: false` (or omit). Only set `true` for endpoints that take >5 s.
