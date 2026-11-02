# Git workflow

`develop` is the integration branch for this repository. All work goes
through feature branches off `develop` and pull requests back into it.

- Always branch off the latest `origin/develop`:
  `git fetch origin && git switch --no-track -c feature/<short-name> origin/develop`
- Name branches `feature/<short-name>` (lowercase, hyphenated; git branch
  names cannot contain spaces).
- Commit only to the feature branch. Never commit directly to `develop` or
  `main`.
- Open pull requests against `develop`:
  `gh pr create --base develop`
- Do not branch off `main`, base work on `main`, or open pull requests into
  `main`. The only exception is the release process (the `release-branch`
  skill), which is run when someone explicitly asks for a release.
- Before starting work, check which branch is checked out. If it is `main`
  or `develop`, create a feature branch first.
- Push and open pull requests only when asked.
