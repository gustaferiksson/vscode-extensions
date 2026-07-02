# Diff Files

Quickly diff the **active file** against any other file — open, unsaved, or anywhere in your workspace — without touching the command line.

A spiritual successor to [`fabiospampinato/vscode-diff`](https://github.com/fabiospampinato/vscode-diff), rebuilt on VS Code's native APIs with **zero dependencies** and proper support for **unsaved and untitled files**.

## Usage

1. Open the file you want to compare (this becomes the **left** side).
2. Run **`Diff: File`** from the Command Palette (`Cmd/Ctrl+Shift+P`).
3. Pick a file from the quick pick — it opens in VS Code's native diff editor.

The picker groups candidates into three sections:

- **untitled** — open untitled (never-saved) buffers
- **open** — your other open files
- **workspace** — every other file in the workspace

## Works with unsaved files

This is the key difference from comparing files on disk. Both sides are diffed through their **live editor documents**, so:

- **Unsaved changes** (dirty buffers) are diffed exactly as they appear in the editor.
- **Untitled files** (never saved to disk) can be diffed directly.

No temporary files are written — the diff always reflects what you actually see.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `diff.showOpenFiles` | `true` | Show currently open files in the picker. |
| `diff.showUntitledFiles` | `true` | Show open untitled (never-saved) files in the picker. |
| `diff.showFoundFiles` | `true` | Show files found in the workspace in the picker. |
| `diff.include` | `**/*` | Glob pattern controlling which workspace files appear. |
| `diff.exclude` | `""` | Glob to exclude. When empty, VS Code's `files.exclude` and `search.exclude` are used. |

## Notes

- Diffing operates on text editors. The currently focused editor must be a text file.
- Binary/image diffing (supported by the original extension via temp files) is intentionally out of scope.

## License

MIT
