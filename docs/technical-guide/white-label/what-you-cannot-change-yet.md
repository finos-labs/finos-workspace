---
title: What you cannot change yet
sidebar_position: 7
---

# What you cannot change yet

These brand elements are written in the code. A deployment changes them only by editing the code and building its own images. Each one is a candidate for a setting; a contribution that turns one into a setting is welcome.

## Web app

| What users see | Where it is |
|---|---|
| "Powered by Workspace" in the sidebar of a white-labelled app | `frontend/src/components/General/Sidebar.tsx` |
| "Exported with Workspace" and the product logo on exported images | `frontend/src/lib/utils/utils.ts` |
| The animated mark in loading and empty states, when no sidebar logo is set | `frontend/src/components/General/BrandedLogo.tsx` |
| The alternative text "FINOS Workspace" of the login logo, and "Workspace" on the two-factor setup page | `frontend/src/routes/login.tsx`, `frontend/src/routes/2fa.tsx` |
| The two-factor setup page's logo, which ignores `WL_LOGIN_IMAGE` | `frontend/src/routes/2fa.tsx` |
| "FINOS (default)" and "the FINOS theme" in the theme editor | `frontend/src/components/ThemeSettings/PresetsSettings.tsx`, `frontend/src/lib/state/themePresets.ts` |
| "Workspace Documentation" on the home page, "Workspace MCP Companion" and about 75 other texts that name Workspace | `frontend/src/routes/appHome.tsx`, `frontend/src/components/LayoutAuth/McpCompanionModal.tsx` and others |
| The title and meta tags that crawlers read without JavaScript, and the Windows tile color | `frontend/index.html` |
| The installed app's colors and its cache name | `frontend/vite.config.ts` |

## Theme presets

- A preset applies after a user signs in, so the login, password reset and two-factor pages show only the theme stylesheet. Put the colors that those pages need in `WL_STYLESHEET`.
- A preset cannot load a font of its own, because preset values may not contain `url(`. Load such a font in the theme stylesheet, as [Change the brand color and font](change-brand-color-and-font.md) shows.
- The font menu of the theme editor offers Montserrat, Inter and Roboto.

## Agent and MCP

| What users or AI tools see | Where it is |
|---|---|
| The agent calls itself Ines in its answers | `agent/src/agent/prompt.ts` |
| The agent's name and description in `/agents.json` | `agent/src/routes/agents.ts` |
| The User-Agent `Ines/1.0` of the agent's web requests | `agent/mcp-server/src/tools/backend/web-search.ts` |
| The names `ines-tools` and `ines-mcp-tools` of the agent's MCP server | `agent/mcp-server/src/app.ts` |
| The colors, font and "Generated with Workspace" footer of the Agent's reports and charts | `agent/src/skills/html-report.md`, `html-chart.md`, `html-table.md` |
| The name "Workspace MCP" and the instructions that AI hosts see when they connect through the MCP Companion | `backend-api/backend/workspace_mcp/server/__init__.py`, `_guidance.py` |
| The client name "Workspace" that an MCP server shows when a user grants access with OAuth | `backend-api/backend/routers/app/mcp_oauth.py` |
| The issuer "Workspace" in users' authenticator apps | `backend-api/backend/routers/auth.py` |
