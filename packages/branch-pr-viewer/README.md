# Branch PR Viewer

Browse your **local branches, newest first**, and review each one's changed files exactly like a **GitHub Pull Request "Files changed"** view — without a remote, a PR, or the command line.

Built on VS Code's native APIs with **zero runtime dependencies**. It reads git through the built-in Git extension and the `git` CLI; nothing is checked out and no temp files are written.

## How it works

1. Open the **Branch PR Viewer** view from the Activity Bar. It lists every local branch, **newest commit first**, with its relative age and `+added -deleted` counts vs the base.
2. **Expand a branch** to see the files that differ from the base, using **three-dot / merge-base** semantics (`git diff base...branch`) — the same diff GitHub shows for a PR. Commits that landed on the base *after* the branch diverged are excluded.
3. **Click a file** to open VS Code's native diff editor — the **base** version on the left, the **branch** version on the right.

Files are badged **A / M / D / R** (added, modified, deleted, renamed) just like the Source Control view.

## Base branch

By default the base is detected automatically: **`main`**, falling back to **`master`**. Set a specific base with the **Select Base Branch…** button in the view title, or via the `branchPrViewer.baseBranch` setting.

## Multi-root workspaces

Open several repositories at once (e.g. a monorepo split, or `api` + `web` side by side) and each git repository gets its own section. With a single repository, the repo level is dropped and branches sit at the top.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `branchPrViewer.baseBranch` | `""` | Branch to compare against with three-dot (merge-base) diff. When empty, the base is auto-detected: `main`, then `master`. |

## Commands

| Command | Description |
| --- | --- |
| **Branch PR Viewer: Refresh** | Reload branches and diffs (title-bar refresh icon). |
| **Branch PR Viewer: Select Base Branch…** | Pick the base branch to compare against. |

## Notes

- Local branches only (`refs/heads`) — remotes are not listed.
- Comparisons use immutable commit SHAs, so the diff editor's content is always consistent with what the tree shows.
- Binary files are listed and badged but render as empty in the text diff editor (same as any text diff tool).

## License

MIT
