import json
import re

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI()

AGENTS = {
    "reference_agent": {
        "name": "Reference agent",
        "description": "Answers questions about the widgets of your dashboard, without a model",
        "endpoints": {"query": "/v1/query"},
        "features": {
            "streaming": True,
            "widget-dashboard-select": True,
            "prompt-suggestions": {
                "label": "Follow-up suggestions",
                "default": True,
                "description": "Suggest a question after each answer.",
            },
            "shout": {
                "label": "Answer in capitals",
                "default": False,
                "description": "Write every answer in capitals.",
            },
        },
    }
}


def sse(name: str, data: dict) -> str:
    return f"event: {name}\ndata: {json.dumps(data, separators=(',', ':'), ensure_ascii=False)}\n\n"


def widgets_of(body: dict) -> list[dict]:
    tiers = body.get("widgets") or {}
    return [*tiers.get("primary", []), *tiers.get("secondary", []), *tiers.get("extra", [])]


def input_args(widget: dict) -> dict:
    values = {}
    for param in widget.get("params", []):
        value = param.get("current_value")
        if value is None:
            value = param.get("default_value")
        if value is not None:
            values[param["name"]] = value
    return values


def data_source(widget: dict) -> dict:
    return {
        "widget_uuid": widget["uuid"],
        "origin": widget["origin"],
        "id": widget["widget_id"],
        "input_args": input_args(widget),
    }


def citation(widget: dict, source: dict) -> dict:
    return {
        "id": f"widget-{widget['uuid']}",
        "source_info": {
            "type": "widget",
            "origin": widget["origin"],
            "widget_id": widget["widget_id"],
            "name": widget["name"],
            "metadata": {"input_args": source.get("input_args", {}), "widget_uuid": widget["uuid"]},
            "citable": True,
        },
        "details": [{"Source type": "widget", "Origin": widget["origin"], "Data source": widget["name"]}],
        "signature": "",
    }


def say(text: str, options: dict):
    if options.get("shout") is True:
        text = text.upper()
    words = text.split(" ")
    for index, word in enumerate(words):
        yield sse("copilotMessageChunk", {"delta": word if index == len(words) - 1 else f"{word} "})


def suggest(questions: list[str], options: dict):
    if options.get("prompt-suggestions") is True and questions:
        yield sse("copilotPromptSuggestions", {"suggestions": questions})


def overview(question: str, widgets: list[dict]) -> str:
    if not widgets:
        return "I cannot see a widget. Add a widget to the dashboard and ask again."
    names = ", ".join(widget["name"] for widget in widgets)
    return f'You asked: "{question}". I can see these widgets: {names}. Name one of them and I read its data.'


def answer_from_result(result: dict, widgets: list[dict], options: dict):
    sources = (result.get("input_arguments") or {}).get("data_sources") or []
    source = sources[0] if sources else {}
    widget = next((item for item in widgets if item["uuid"] == source.get("widget_uuid")), None)
    name = widget["name"] if widget else source.get("id", "the widget")
    entries = result.get("data") or []
    entry = entries[0] if entries else {}
    if "error_type" in entry:
        yield from say(f'The browser could not read "{name}": {entry.get("content", "")}', options)
        return
    items = entry.get("items") or []
    content = items[0].get("content", "") if items else ""
    lines = [line for line in re.split(r"\r?\n", str(content)) if line.strip()]
    first = lines[0] if lines else ""
    yield from say(f'"{name}" returned {len(lines)} lines. The first line is: {first}', options)
    if widget:
        yield sse("copilotCitationCollection", {"citations": [citation(widget, source)]})
    yield from suggest(["What is on this dashboard?"], options)


def respond(body: dict):
    options = body.get("workspace_options") or {}
    widgets = widgets_of(body)
    last = body["messages"][-1]
    if last.get("role") == "tool":
        yield from answer_from_result(last, widgets, options)
        return
    question = str(last.get("content", ""))
    named = next((widget for widget in widgets if widget["name"].lower() in question.lower()), None)
    if named is None:
        yield from say(overview(question, widgets), options)
        yield from suggest([f"Read the data of {widgets[0]['name']}"] if widgets else [], options)
        return
    yield sse(
        "copilotStatusUpdate",
        {"eventType": "INFO", "message": f'Reading the data of "{named["name"]}".', "group": "reasoning"},
    )
    yield sse(
        "copilotFunctionCall",
        {"function": "get_widget_data", "input_arguments": {"data_sources": [data_source(named)]}, "extra_state": {}},
    )


def stream(body: dict):
    try:
        yield from respond(body)
    except Exception:
        yield sse("copilotStatusUpdate", {"eventType": "ERROR", "message": "The agent could not read the request."})


@app.get("/agents.json")
def agents() -> dict:
    return AGENTS


@app.post("/v1/query")
async def query(request: Request):
    try:
        body = await request.json()
    except ValueError:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    messages = body.get("messages") if isinstance(body, dict) else None
    if not isinstance(messages, list) or not messages or not isinstance(messages[-1], dict):
        return JSONResponse({"error": "Invalid request"}, status_code=400)
    return StreamingResponse(stream(body), media_type="text/event-stream")
