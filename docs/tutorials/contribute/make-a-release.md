---
title: Make a release
sidebar_position: 8
---

# Make a release

A release is one pull request from `release/<version>` into `main`. Maintainers choose the version, and the workflows write the changelog, check the images before the merge and publish everything after it. This guide shows the steps and what each workflow does.

## Prepare the release

1. In the repository's Actions tab, run the workflow `Prepare release` on `develop`, and give it the version, such as `0.2.0` or `0.2.0-alpha.1`. A version with a hyphen is a pre-release.
2. The workflow cuts the branch `release/<version>` from `main`, with the files of `develop`, and keeps `develop` as a parent of the commit. It stops when the tag or the branch exists already, or when no pull request was merged into `develop` since the last `v` tag.
3. It writes the entry `## Version <version> - <date>` at the top of `frontend/CHANGELOG.md`, from the pull requests merged into `develop` since the last release, without the ones that bots opened. The older entries come from `main`. When the changelog on `develop` has the entry for the version already, the workflow keeps that one.
4. It opens the pull request `Release/<version>` into `main`. Edit `frontend/CHANGELOG.md` on the branch to change the notes. Those notes are the changelog of the web app and the text of the GitHub release.

The workflow works as the GitHub App of the `SBOM_APP_ID` and `SBOM_APP_PRIVATE_KEY` secrets, so the pull request starts the checks. It makes the release commit through the GitHub API instead of `git push`, because GitHub signs a commit that an App makes that way, and `main` requires signed commits. The workflow stops before it creates the branch when GitHub did not sign the commit. The App needs write access to contents, pull requests and workflows, because the branch changes the workflow files that `main` has.

## Check the release before the merge

The workflow `Release` runs on every pull request into `main`, and it does everything that publishing does except the pushing:

- It reads the version from the top heading of `frontend/CHANGELOG.md`. It fails when that is not a semantic version, when the entry has no changes, or when the tag `v<version>` exists already. So a pull request into `main` that does not start a new version cannot pass.
- It builds the four images, `backend`, `web`, `agent` and `agent-mcp`, from the branch, and pushes none of them.

The job `Ready to release` is green only when all of that passed. Make it a required status check of `main`, so that nothing can be merged before it is green.

## Publish by merging

On the push to `main` that the merge makes, the workflow `Release` runs again with the push enabled, in this order:

1. It builds the four images and pushes each one to Docker Hub under the commit's SHA, as `finos/workspace-<image>:<sha>`.
2. When all four are there, it gives each one the tags `v<version>` and `latest`. `latest` moves to every release, pre-releases included. A failed build leaves no release tag and does not move `latest`.
3. It tags the merge commit `v<version>` and creates the GitHub release with the changelog entry as its notes. The release is marked as a pre-release when the version has a hyphen, and as the latest release when it has none.

A push to `main` whose changelog version is tagged already publishes nothing. When a run fails, run its failed jobs again from the Actions tab. Every step can run again, and the tag and the release come last.

The base image of the agent and the web app, `finos-node`, is released on its own, by pushing a tag named `finos-node-v<Node version>-<build>`, which the workflow `finos-node` handles. A release of the images uses the `finos-node` release that `docker-compose.yml` names.
