# The demolition record

The Workspace was stripped of its commercial, hosted and company-specific parts to be donated to FINOS. This folder and
[`../DEMOLITION-PLAN.md`](../DEMOLITION-PLAN.md) are the record of how, why and what was left, and they stay in the
repository.

Read in this order:

1. [`../DEMOLITION-PLAN.md`](../DEMOLITION-PLAN.md): the brief, the protected set, the 23 numbered calls (every decision
   and who made it), what was removed in each part of the code, the order of work with what is done, the verification,
   what was noticed and left alone, the new names (section 11), and the rules and the chronology of the work (section 12).
2. [`baseline.md`](baseline.md): the state of the untouched code (commit `be00e95`) before any change.
3. [`final-state.md`](final-state.md): the gates at the end, the versions and the open items.
4. [`audit/`](audit/README.md): the secret scan and the licence inventories.
5. [`walkthrough/`](walkthrough/README.md): the manual check against the running stack, with the throwaway backend and the
   page-crawl script.
6. [`tools/`](tools/README.md): the checker, the reachability tools, the rename pipeline and the art generators.
7. The lists (`*-delete.txt`, `*-edit.txt`, `*-tests.txt`, `*-names.txt`, `*.cuts.json`, `frontend-npm.txt`,
   `frontend-left-alone.txt`, `other-delete.txt`): the output of phase 0. Most are empty now because the work they
   listed is done; the paths in them are those of the original tree.

Because it records what was removed, this folder and the plan name the removed product, its abbreviation and the old
tier names, and the repository's own checks skip them. A copy of the repository that must be free of those names has
to leave both out.
