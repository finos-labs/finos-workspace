---
title: How to write and preview documentation
sidebar_position: 5
---

# How to write and preview documentation

The documentation site is built with Docusaurus. Its pages are Markdown files in `docs/`, in one folder for each kind of page, and the site that renders them lives in `website/`. This guide explains where a new page belongs, how to write it, and how to preview and check the site before you push.

## Choose the folder

Put each page in the one folder that matches its job. A page that tries to do two jobs should become two pages that link to each other.

| Folder | Who reads it | How the title starts | What to leave out |
|---|---|---|---|
| `tutorials/` | A reader who wants to learn by doing. | A short action, such as "Run FINOS Workspace on your machine". | Digressions. Link to the explanation and the reference instead. |
| `how-to/` | A reader who has a goal. | "How to …". | Teaching and background. |
| `reference/` | A reader who needs a fact. | A noun phrase, such as "Plugin proxies and secrets". | Instructions and opinions. |
| `explanation/` | A reader who wants to understand. | "About …". | Steps and exhaustive lists. |

## Write the page

1. Create `docs/<folder>/<name>.md` with a `title` in its front matter. A page that shows generated values is an `.mdx` page instead, and it imports the components from `@site/src/components/Reference`. Pages that belong together live in a subfolder with a `_category_.json` that gives the sidebar label and position.
2. Write in complete sentences. Begin with a sentence that says what the page covers and why a reader needs it, and write every paragraph, list item and section caption as a sentence of its own. That first sentence is also the page's description in `llms.txt`, as [How the site is published](#how-the-site-is-published) explains.
3. Check every statement against the code before you write it. Name files and functions, and never line numbers.
4. Write marked placeholders such as `<your-email>` and `<API_URL>` where the reader has to choose a value. Do not invent hosts, accounts or companies.
5. Do not write a number, a limit, a name or a list of values that the code defines. A page takes it from a generated component, such as `PluginValue`, `SettingDefault`, `SettingConstant`, `EnvDefault`, `AgentLimit`, `WebAppValue`, `BridgeValue` or `MetricName`, and the build fails when the value does not exist. A component that prints a quantity takes a `unit`, which is `bytes`, `ms`, `s`, `min`, `hours`, `days` or `raw` and says how the stored value is written. Where a page has to explain a part by hand, the generator checks that the page mentions every item of the code, as [How to regenerate the reference data](regenerate-reference-data.md) describes.
6. Link to the reference and explanation pages instead of repeating them. Put angle brackets and curly braces inside code spans, because the MDX parser reads them as markup otherwise, and write web addresses as ordinary Markdown links.

## Preview the site

The site needs Node 26.12.1, the version that the repository's images run. The reference pages are generated from data that the backend, the agent and the web app write, and git does not track it, so write the data once, as [How to regenerate the reference data](regenerate-reference-data.md) describes. Then install the site's dependencies and start the development server:

```bash
cd website
npm ci --ignore-scripts
npm run reference
npm start
```

The development server listens on port 3000. When the local stack is running, the web app already uses that port, so start the server on another port with `npm start -- --port <port>`.

## Check before you push

Run the type check, the tests of the site's code and the build:

```bash
npm run typecheck
npm test
npm run build
```

The build fails on a broken link, a broken anchor or a page that no sidebar lists, so a build that passes has no dead links inside the site and lists every page in `llms.txt`. Run `npm run serve` after the build to open the built site, which includes `llms.txt`.

## How the site is published

FINOS hosts its project websites on Netlify, and the Docs workflow in `.github/workflows/docs.yml` builds the site and deploys it. Netlify cannot build this site itself, because the reference pages need the data that the backend, the agent and the web app write. Git does not track that data, so every run of the workflow writes it from the sources of the commit that it builds, and the generated pages always come from the code.

The workflow runs for every pull request and every push to `main` that touches the pages in `docs`, the site in `website`, `netlify.toml`, or the code of the backend, the agent and the web app. These jobs run in both cases:

1. Three jobs write the data of the backend, the agent and the web app, each in its own environment.
2. The build job generates the site's data, checks its types, runs the tests of the site's code, builds the site and checks that `llms.txt` exists.

On a pull request, that is all: nothing is deployed, so the run is the test of the deploy. When a change reaches `main`, the build job first asks Netlify for the main address of the site, so that the canonical links and `llms.txt` carry the address that readers use, and it keeps the built site. A last job, `Deploy to Netlify`, then publishes that built site with the Netlify CLI. The deploy job is the only job that does not run on a pull request, and a manual run of the workflow never deploys either.

The workflow reads two settings that a maintainer adds to the repository. `NETLIFY_AUTH_TOKEN` is a secret that holds a Netlify access token of a person who may deploy the site, and `NETLIFY_SITE_ID` is a repository variable that holds the site's ID, which Netlify shows in the site's configuration. The file `netlify.toml` at the root of the repository makes Netlify's own builder skip every build, so that the workflow is the only way the site changes. Without a `NETLIFY_AUTH_TOKEN` and a `NETLIFY_SITE_ID`, the jobs for pull requests still pass, and the first run on `main` fails in the build job when it asks for the address.

The build also writes `llms.txt` at the root of the site. It is the plain-text index that language models and the tools that feed them read to find pages. The file starts with the site's name and tagline, and then it lists every page under the headings of the navigation bar and the sidebar categories, each with its title, its address and a description. The description is the `description` in the page's front matter when the page has one, and otherwise the first sentence of the rendered page, so the file shows the values that the generated components print. Only the build writes the file, and it fails when a sidebar names a page that does not exist, when a page is listed twice or when a page is in no sidebar.

The file `website/osv-scanner.toml` leaves the site's dependencies out of vulnerability scans, because the site is never shipped to users. To deploy the site and get an address such as `<project>.finos.org`, a maintainer emails [help@finos.org](mailto:help@finos.org).
