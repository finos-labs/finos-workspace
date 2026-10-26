---
title: How to style an HTML widget for both themes
---

# How to style an HTML widget for both themes

An HTML widget draws the document that its endpoint returns, in a frame that shares nothing with the app. Workspace tells the endpoint which theme is active with the `theme` query parameter, so the endpoint returns the styles for that theme.

1. Declare the widget in `widgets.json` as usual. Do not declare a parameter named `theme`: the name is reserved, and Workspace adds the parameter to every request of the type.

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

2. In the endpoint, read `theme` and choose the palette. Workspace sends `dark` or `light`:

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
       colours = PALETTES.get(theme, PALETTES["dark"])
       return f"""<!doctype html>
   <html>
   <head>
   <meta charset="utf-8">
   <style>
     body {{
       margin: 0;
       padding: 16px;
       background: {colours["background"]};
       color: {colours["text"]};
       font: 14px/1.5 system-ui, sans-serif;
     }}
     table {{ border-collapse: collapse; width: 100%; }}
     th, td {{ border: 1px solid {colours["border"]}; padding: 4px 8px; text-align: left; }}
     a {{ color: {colours["accent"]}; }}
   </style>
   </head>
   <body>
   <table><tr><th>Quarter</th><th>Revenue</th></tr><tr><td>Q1</td><td>120</td></tr></table>
   </body>
   </html>"""
   ```

3. Use the values of the app for the colours you want to match. [Semantic properties](../../reference/css/semantic-properties.mdx) lists them for both themes. `background`, `text` and `border` above are the values of `--general-bg-primary`, `--foreground` and `--border`. The accent colours are chosen for contrast on those backgrounds: the app's own link colour, `--link-color`, comes from the brand colour.

The document cannot read the parameter, because it arrives through `srcdoc`, and it cannot read the app's custom properties. What the frame does and does not add is on [HTML widgets and artifacts](../../reference/css/html-documents.mdx).
