# Change Log

All notable changes to the **Branch PR Viewer** extension are documented here.

## [0.0.3]

- New **Current Branch Changes** Activity Bar view: the checked-out branch's changes vs its base, as a folder tree, like a GitHub PR's "Files changed".
- Diffs opened from that view put the **file on disk** on the right-hand side, so the branch version is **editable** in place.
- That view covers committed *and* uncommitted work (merge base → working tree), including new untracked files.
- Both views refresh automatically on commits, checkouts and working-tree changes.
- New `branchPrViewer.diffStyle` setting and **Toggle Diff Highlight Style** button: `gutter` drops the diff line backgrounds and marks changed lines with a green/red gutter beside the line numbers instead.

## [0.0.2]

- Maintenance release: source consolidated into the `vscode-extensions` monorepo. No functional changes.

## [0.0.1]

- Initial release.
- Activity Bar view listing all local branches, newest commit first, with relative age and `+added -deleted` counts vs the base.
- Expanding a branch shows its changed files using three-dot / merge-base semantics (`git diff base...branch`), matching a GitHub PR's "Files changed".
- Clicking a file opens the native diff editor — base on the left, branch on the right — with A/M/D/R decorations and rename detection.
- Automatic base detection (`main`, then `master`), overridable via `branchPrViewer.baseBranch` or the **Select Base Branch…** command.
- Multi-root aware: each git repository gets its own section; the repo level is dropped when only one repository is open.
