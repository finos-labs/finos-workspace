# FINOS Workspace documentation site

This website was created with Docusaurus 3, and it renders the pages in `docs/`.

- `website/` holds the Node and React code that builds the site.
- `website/docusaurus.config.ts` holds the Docusaurus configuration.
- `website/static/` holds images and other static assets, which the site serves from its root.
- `docs/` holds the Markdown and MDX pages. Their folders and file names give the pages their addresses.

## Local run

The site needs Node 26.12.1, the version that the repository's images run.

```bash
cd website
npm ci --ignore-scripts
npm run reference
npm start
```

The reference pages are generated from data that the backend, the agent and the web app write. Git does not track that data, and `npm run reference` writes it: it expects the backend's Python environment to be active and it runs `npm ci` in `agent` and in `frontend`. The page *How to regenerate the reference data* describes each part. `npm start` opens the site at `http://localhost:3000`. Run `npm run typecheck` and `npm run build` before you push. The build fails on a broken link or anchor.

## Deployment

Netlify serves the site, as it does for FINOS websites, but the Docs workflow in `.github/workflows/docs.yml` builds it, because the reference pages need the data that the backend, the agent and the web app write. For every pull request that touches the pages, the site or the code that the reference describes, the workflow writes that data, generates the site, checks its types, builds it and checks that it wrote `llms.txt`. It deploys nothing. When a change reaches `main`, the same jobs run, and a last job publishes the built site to Netlify with the Netlify CLI. The workflow reads the secret `NETLIFY_AUTH_TOKEN`, which is a Netlify access token that may deploy the site, and the repository variable `NETLIFY_SITE_ID`, which is the site's ID. The file `netlify.toml` at the root of the repository makes Netlify's own builder skip every build, so that the workflow is the only way the site changes. The build writes `llms.txt` at the root of the site, with the title, address and description of every page; the plugin `plugins/llms.ts` writes it. To serve the site at an address such as `<project>.finos.org`, email help@finos.org.

## Website dependency updates

The file `osv-scanner.toml` excludes the website's dependencies from OSV scans, because the website is never shipped to users. Delete the file to include them, which FINOS does not recommend. Docusaurus patches often arrive weeks or months after the vulnerable dependencies are found, so automated tools such as Dependabot cannot fix them quickly.
