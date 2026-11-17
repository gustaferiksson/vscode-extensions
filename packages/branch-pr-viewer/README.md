# Branch PR Viewer

Review the **checked-out branch's changes** against its base exactly like a **GitHub Pull Request "Files changed"** view, without a remote, a PR, or the command line.

Built on VS Code's native APIs with **zero runtime dependencies**. It reads git through the built-in Git extension and the `git` CLI; nothing is checked out and no temp files are written.

## How it works

Open the **Current Branch Changes** view from the Activity Bar.

- The scope is **merge base → working tree** (`git diff $(git merge-base base HEAD)`): committed work plus anything uncommitted, including new untracked files. Commits that landed on the base *after* the branch diverged are excluded, the same as a GitHub PR.
- Clicking a file opens the diff with the merge-base version on the left and **the file on disk on the right, editable**, so you can fix things while reviewing and save straight into the working tree.
- Files are badged **A / M / D / R** (added, modified, deleted, renamed) just like the Source Control view.
- Each file shows its `+added −deleted` line counts against the merge base (none for binary files), and a **●** when it has uncommitted changes (differs from `HEAD`, or is untracked).
- The view title shows `branch → base` with the total line counts; with several repositories, each repository row shows its own.
- **View as List** / **View as Tree** in the view title switches between the folder tree and a flat list sorted by path, with each file's folder shown beside its name.
- The tree updates itself as you commit, check out branches or edit files.

## Diff highlight style

The **Toggle Diff Highlight Style** button in the view title switches `branchPrViewer.diffStyle` between:

- **`theme`** (default) — diff colours come from your colour theme, with full line and word backgrounds.
- **`gutter`** — the diff line backgrounds go transparent and changed lines get a thin green/red stripe in the gutter beside the line numbers, so the code itself stays on the normal editor background.

Diff highlighting is a workbench colour, not a per-editor one, so switching it off works by writing the diff colour IDs into your **user** `workbench.colorCustomizations`. Two consequences:

- Turning the backgrounds off applies to *every* diff editor (Source Control, other extensions), while the stripes are editor decorations and appear only in diffs opened from this extension.
- A theme-scoped block such as `"[Default Dark Modern]": { … }` in your settings will override the transparent colours.

Stripes come from `git diff -U0`, so a line you have just typed is striped once the file is saved.

## Base branch

By default the base is detected automatically: **`main`**, falling back to **`master`**. Set a specific base with the **Select Base Branch…** button in the view title, or via the `branchPrViewer.baseBranch` setting.

## Multi-root workspaces

Open several repositories at once (e.g. a monorepo split, or `api` + `web` side by side) and each git repository gets its own section. With a single repository, the repo level is dropped and files sit at the top.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `branchPrViewer.baseBranch` | `""` | Branch to compare against with three-dot (merge-base) diff. When empty, the base is auto-detected: `main`, then `master`. |
| `branchPrViewer.viewMode` | `"tree"` | `tree` groups changed files into folders; `list` shows them flat, sorted by path. |
| `branchPrViewer.diffStyle` | `"theme"` | `theme` leaves diff colours to the theme; `gutter` hides line backgrounds and marks changes in the gutter. |

## Commands

| Command | Description |
| --- | --- |
| **Branch PR Viewer: Refresh** | Reload the changed files (title-bar refresh icon). |
| **Branch PR Viewer: Select Base Branch…** | Pick the base branch to compare against. |
| **Branch PR Viewer: Open File** | Open the file itself (hover a file row) instead of its diff. |
| **Branch PR Viewer: View as List** / **View as Tree** | Switch the view between a flat file list and a folder tree. |
| **Branch PR Viewer: Toggle Diff Highlight Style** | Switch between theme diff colours and green/red gutter marks. |

## Notes

- The left side of every diff is read at the merge-base commit SHA, so it is always consistent with what the tree shows.
- Binary files are listed and badged but render as empty in the text diff editor (same as any text diff tool).

## License

MIT
