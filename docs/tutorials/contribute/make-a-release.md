---
title: Make a release
sidebar_position: 8
---

# Make a release

A release is a pull request from `develop` into `main`. Open it, get it approved and add it to the merge queue. The workflow `Release` does everything else: it works out the version, writes the changelog and the release notes, builds the images before the merge, and publishes the images, the tag and the GitHub release after it.

## Open the pull request

Open a pull request with the base `main` and the head `develop`, with a description, and with no other work:

```bash
gh pr create --base main --head develop
```

The version needs no input. To choose it, put the label `release:X.Y.Z`, such as `release:0.2.0` or `release:0.2.0-alpha.1`, on the pull request. A version with a hyphen is a pre-release.

## What the workflow does

1. It takes the version from the label, or else counts up the number at the end of the latest `v` tag: `v0.1.0-alpha.1` becomes `0.1.0-alpha.2` and `v1.2.3` becomes `1.2.4`. It fails when the tag exists already.
2. It lists the pull requests merged since the latest `v` tag, without the ones that bots opened and without the release pull request itself. That list is the text of the GitHub release. The changelog of the web app is that list as a new entry at the top, then the entries of the earlier releases, which come from their GitHub release notes, then `frontend/CHANGELOG.md`, which holds the history from before the releases were automated. The web image gets this changelog, and the file in the repository stays as it is.
3. On the pull request and again in the merge queue it builds the four images, `backend`, `web`, `agent` and `agent-mcp`, and pushes none of them. The job `Ready to release` is green only when everything before it passed.
4. After the merge it pushes the four images to Docker Hub under the commit's SHA. When all four are there, it gives each one the tags `v<version>` and `latest`, and then it tags the merge commit and creates the GitHub release. `latest` moves to every release, pre-releases included. A release is marked as a pre-release when its version has a hyphen, and as the latest release when it has none.

A failed run leaves no release tag and no release. Run its failed jobs again from the Actions tab: the last run for a commit that already has a `v` tag does nothing.

## Settings that the release needs

These are settings of the repository, so no workflow sets them:

- A merge queue on `main` that merges with a merge commit. A squash or a rebase would make `develop` and `main` diverge again, and the next release pull request would conflict.
- The check `Ready to release` as a required status check of `main`. The merge queue runs the workflow on its own commit, so the check has to be required there.

## What the release does not cover

The workflow `docker-publish.yml` is the older path. It still publishes the images when a person publishes a release by hand, and the releases that the workflow `Release` creates do not start it. The base image of the agent and the web app, `finos-node`, has its own workflow, which a tag named `finos-node-v<Node version>-<build>` starts. A release of the images uses the `finos-node` release that `docker-compose.yml` names.
