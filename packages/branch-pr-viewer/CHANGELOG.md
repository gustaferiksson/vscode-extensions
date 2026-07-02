# Change Log

All notable changes to the **Branch PR Viewer** extension are documented here.

## [0.0.1]

- Initial release.
- Activity Bar view listing all local branches, newest commit first, with relative age and `+added -deleted` counts vs the base.
- Expanding a branch shows its changed files using three-dot / merge-base semantics (`git diff base...branch`), matching a GitHub PR's "Files changed".
- Clicking a file opens the native diff editor — base on the left, branch on the right — with A/M/D/R decorations and rename detection.
- Automatic base detection (`main`, then `master`), overridable via `branchPrViewer.baseBranch` or the **Select Base Branch…** command.
- Multi-root aware: each git repository gets its own section; the repo level is dropped when only one repository is open.
