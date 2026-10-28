---
title: How to style an HTML widget for both themes
sidebar_position: 3
---

# How to style an HTML widget for both themes

An HTML widget draws the document that its endpoint returns, in a frame that shares nothing with the app. The document therefore cannot see the app's theme. FINOS Workspace tells the endpoint which theme is active through the `theme` query parameter, and the endpoint returns the styles for that theme. This guide shows how to write such an endpoint.

1. Declare the widget in `widgets.json` as usual. Do not declare a parameter named `theme`, because the name is reserved and FINOS Workspace adds the parameter to every request of the type.

   ```json
   {
     "report": {
       "name": "Report",
       "description": "A report that follows the theme",
       "type": "html",
       "endpoint": "report"
     }
   }
   ```

2. In the endpoint, read `theme` and choose the palette. FINOS Workspace sends `dark` or `light`:

   ```python
   from fastapi import FastAPI, Query
   from fastapi.responses import HTMLResponse

   app = FastAPI()

   PALETTES = {
       "dark": {"background": "#0b2432", "text": "#e7f2f8", "border": "#355867", "accent": "#00b5e2"},
       "light": {"background": "#ffffff", "text": "#1a3248", "border": "#b7cdd8", "accent": "#005e8a"},
   }


   @app.get("/report", response_class=HTMLResponse)
   def report(theme: str = Query("dark")) -> str:
       colors = PALETTES.get(theme, PALETTES["dark"])
       return f"""<!doctype html>
   <html>
   <head>
   <meta charset="utf-8">
   <style>
     body {{
       margin: 0;
       padding: 16px;
       background: {colors["background"]};
       color: {colors["text"]};
       font: 14px/1.5 system-ui, sans-serif;
     }}
     table {{ border-collapse: collapse; width: 100%; }}
     th, td {{ border: 1px solid {colors["border"]}; padding: 4px 8px; text-align: left; }}
     a {{ color: {colors["accent"]}; }}
   </style>
   </head>
   <body>
   <table><tr><th>Quarter</th><th>Revenue</th></tr><tr><td>Q1</td><td>120</td></tr></table>
   </body>
   </html>"""
   ```

3. Use the values of the app for the colors that you want to match. [Semantic properties](../reference/css/semantic-properties.mdx) lists them for both themes. In the example, `background`, `text` and `border` are the values of `--general-bg-primary`, `--foreground` and `--border`. The accent colors are chosen for contrast on those backgrounds, and the app's own link color, `--link-color`, comes from the brand color.

The document cannot read the theme parameter itself, because the document arrives through `srcdoc`, and it cannot read the app's custom properties. [HTML widgets and artifacts](../reference/css/html-documents.mdx) lists what the frame does and does not add.
