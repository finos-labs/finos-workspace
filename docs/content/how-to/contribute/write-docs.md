---
title: How to write and preview documentation
---

# How to write and preview documentation

The site is built with Docusaurus in `docs/`. Its pages are in `docs/content/`, in one folder for each kind of page.

## Choose the folder

Put each page in the one folder that matches its job. A page that does two jobs becomes two pages that link to each other.

| Folder | The reader | Title | Leave out |
|---|---|---|---|
| `tutorials/` | wants to learn by doing | "Build your first dashboard" | Digressions; link to explanation and reference instead |
| `how-to/` | has a goal | "How to …" | Teaching and background |
| `reference/` | needs a fact | A noun phrase, such as "Environment variables" | Instructions and opinions |
| `explanation/` | wants to understand | "About …" | Steps and exhaustive lists |

## Write the page

1. Create `docs/content/<folder>/<topic>/<name>.md` with a `title` in its front matter.
2. Check every statement against the code before writing it. Name files and functions, never line numbers.
3. Write marked placeholders such as `<your-email>` and `<API_URL>` where a value is yours to choose. Do not invent hosts, accounts or companies.
4. Link to the reference and explanation pages instead of repeating them.

## Preview the site

The site needs Node 24 or later.

```bash
cd docs
npm ci --ignore-scripts
npm start
```

The development server listens on port 3000, the port the web app uses in the compose stack. To use another port, run `npm start -- --port <port>`.

## Check before you push

```bash
npm run typecheck
npm run build
```

The build fails on a broken link or anchor.
