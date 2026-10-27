---
title: How to write and preview documentation
---

# How to write and preview documentation

The documentation site is built with Docusaurus and lives in `docs/`. Its pages are in `docs/content/`, in one folder for each kind of page. This guide explains where a new page belongs, how to write it, and how to preview and check the site before you push.

## Choose the folder

Put each page in the one folder that matches its job. A page that tries to do two jobs should become two pages that link to each other.

| Folder | Who reads it | How the title starts | What to leave out |
|---|---|---|---|
| `tutorials/` | A reader who wants to learn by doing. | A short action, such as "Run Workspace on your machine". | Digressions. Link to the explanation and the reference instead. |
| `how-to/` | A reader who has a goal. | "How to …". | Teaching and background. |
| `reference/` | A reader who needs a fact. | A noun phrase, such as "Plugin proxies and secrets". | Instructions and opinions. |
| `explanation/` | A reader who wants to understand. | "About …". | Steps and exhaustive lists. |

## Write the page

1. Create `docs/content/<folder>/<name>.md` with a `title` in its front matter. Pages that belong together live in a subfolder with a `_category_.json` that gives the sidebar label and position.
2. Write in complete sentences. Begin with a sentence that says what the page covers and why a reader needs it, and write every paragraph, list item and section caption as a sentence of its own.
3. Check every statement against the code before you write it. Name files and functions, and never line numbers.
4. Write marked placeholders such as `<your-email>` and `<API_URL>` where the reader has to choose a value. Do not invent hosts, accounts or companies.
5. Link to the reference and explanation pages instead of repeating them. Put angle brackets and curly braces inside code spans, because the MDX parser reads them as markup otherwise, and write web addresses as ordinary Markdown links.

## Preview the site

The site needs Node 24 or later. Install the dependencies once and start the development server:

```bash
cd docs
npm ci --ignore-scripts
npm start
```

The development server listens on port 3000. When the local stack is running, the web app already uses that port, so start the server on another port with `npm start -- --port <port>`.

## Check before you push

Run the type check and the build:

```bash
npm run typecheck
npm run build
```

The build fails on a broken link or a broken anchor, so a build that passes has no dead links inside the site.
