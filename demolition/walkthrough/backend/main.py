"""Throwaway backend for the Workspace walkthrough (see ../README.md).

Serves one widget of each type that the Workspace renders (markdown, html, pdf, iframe), an app
template, a thumbnail and an RSS feed, with CORS open for local use only.

    pip install fastapi uvicorn
    uvicorn main:app --port 9000
"""
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, Response

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# the smallest valid PDF: one empty page
PDF = (b"%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
       b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\n"
       b"trailer<</Root 1 0 R/Size 4>>\n%%EOF\n")

WIDGETS = {
    "walk_markdown": {"name": "Walk Markdown", "description": "Markdown walkthrough widget", "type": "markdown", "endpoint": "/summary", "gridData": {"w": 20, "h": 8},
                      "params": [{"paramName": "team", "type": "text", "label": "Team", "value": "platform", "description": "Team"}]},
    "walk_html": {"name": "Walk HTML", "description": "HTML walkthrough widget", "type": "html", "endpoint": "/report", "gridData": {"w": 20, "h": 8}},
    "walk_pdf": {"name": "Walk PDF", "description": "PDF walkthrough widget", "type": "pdf", "endpoint": "/doc", "gridData": {"w": 20, "h": 10}},
    "walk_iframe": {"name": "Walk iFrame", "description": "iFrame walkthrough widget", "type": "iframe", "endpoint": "http://localhost:9000/page", "gridData": {"w": 20, "h": 8}},
}

@app.get("/widgets.json")
def widgets():
    return JSONResponse(WIDGETS)

@app.get("/summary", response_class=PlainTextResponse)
def summary(team: str = Query("platform")):
    return f"## {team.title()}: week 17\n\n- Shipped the importer.\n- Two incidents, both resolved.\n"

@app.get("/report", response_class=HTMLResponse)
def report(theme: str = "dark"):
    return "<html><body><h2>HTML report</h2><table><tr><th>Region</th><th>Total</th></tr><tr><td>North</td><td>412</td></tr></table></body></html>"

@app.get("/doc")
def doc():
    return Response(PDF, media_type="application/pdf")

@app.get("/page", response_class=HTMLResponse)
def page():
    return "<html><body><h2>Embedded page</h2></body></html>"


@app.get("/feed.xml")
def feed():
    xml = ('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Walkthrough feed</title>'
           '<link>http://localhost:9000/</link><description>Test</description>'
           '<item><title>First entry</title><link>http://localhost:9000/1</link><description>Hello feed</description>'
           '<pubDate>Wed, 07 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>')
    return Response(xml, media_type="application/rss+xml")


@app.get("/apps.json")
def apps():
    return JSONResponse([{
        "name": "Walkthrough app", "description": "Two widgets on one tab", "img": "", "img_dark": "", "img_light": "",
        "allowCustomization": True, "groups": [], "prompts": [],
        "tabs": {"": {"id": "", "name": "", "layout": [
            {"i": "walk_markdown", "x": 0, "y": 0, "w": 20, "h": 8},
            {"i": "walk_html", "x": 20, "y": 0, "w": 20, "h": 8}]}},
    }])


@app.get("/thumb.svg")
def thumb():
    return Response('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#1d4f7a"/></svg>', media_type="image/svg+xml")
