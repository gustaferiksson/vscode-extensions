# Branch PR Viewer

Browse your **local branches, newest first**, and review each one's changed files exactly like a **GitHub Pull Request "Files changed"** view — without a remote, a PR, or the command line.

Built on VS Code's native APIs with **zero runtime dependencies**. It reads git through the built-in Git extension and the `git` CLI; nothing is checked out and no temp files are written.

## How it works

1. Open the **Branch PR Viewer** view from the Activity Bar. It lists every local branch, **newest commit first**, with its relative age and `+added -deleted` counts vs the base.
2. **Expand a branch** to see the files that differ from the base, using **three-dot / merge-base** semantics (`git diff base...branch`) — the same diff GitHub shows for a PR. Commits that landed on the base *after* the branch diverged are excluded.
3. **Click a file** to open VS Code's native diff editor — the **base** version on the left, the **branch** version on the right.

Files are badged **A / M / D / R** (added, modified, deleted, renamed) just like the Source Control view.

## Current Branch Changes

The second Activity Bar view, **Current Branch Changes**, skips the branch list and shows just the checked-out branch's changes against its base — the closest thing to GitHub's PR review pane.

- The scope is **merge base → working tree**: committed work plus anything uncommitted, including new untracked files.
- Clicking a file opens the diff with the merge-base version on the left and **the file on disk on the right — editable**, so you can fix things while reviewing and save straight into the working tree.
- The tree updates itself as you commit, check out branches or edit files.

## Diff highlight style

The **Toggle Diff Highlight Style** button in either view title switches `branchPrViewer.diffStyle` between:

- **`theme`** (default) — diff colours come from your colour theme, with full line and word backgrounds.
- **`gutter`** — the line backgrounds go transparent and changed lines are marked green/red in the gutter beside the line numbers, so the code itself stays on the normal editor background.

Diff highlighting is a workbench colour, not a per-editor one, so `gutter` works by writing the diff colour IDs into your **user** `workbench.colorCustomizations`. It therefore applies to *every* diff editor (Source Control, other extensions), and a theme-scoped block such as `"[Default Dark Modern]": { … }` in your settings will override it.

## Base branch

By default the base is detected automatically: **`main`**, falling back to **`master`**. Set a specific base with the **Select Base Branch…** button in the view title, or via the `branchPrViewer.baseBranch` setting.

## Multi-root workspaces

Open several repositories at once (e.g. a monorepo split, or `api` + `web` side by side) and each git repository gets its own section. With a single repository, the repo level is dropped and branches sit at the top.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `branchPrViewer.baseBranch` | `""` | Branch to compare against with three-dot (merge-base) diff. When empty, the base is auto-detected: `main`, then `master`. |
| `branchPrViewer.diffStyle` | `"theme"` | `theme` leaves diff colours to the theme; `gutter` hides line backgrounds and marks changes in the gutter. |

## Commands

| Command | Description |
| --- | --- |
| **Branch PR Viewer: Refresh** | Reload branches and diffs (title-bar refresh icon). |
| **Branch PR Viewer: Select Base Branch…** | Pick the base branch to compare against. |
| **Branch PR Viewer: Toggle Diff Highlight Style** | Switch between theme diff colours and green/red gutter marks. |

## Notes

- Local branches only (`refs/heads`) — remotes are not listed.
- Comparisons use immutable commit SHAs, so the diff editor's content is always consistent with what the tree shows.
- Binary files are listed and badged but render as empty in the text diff editor (same as any text diff tool).

## License

MIT
