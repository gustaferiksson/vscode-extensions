# Change Log

All notable changes to the **Diff Files** extension are documented here.

## [0.0.2]

- Maintenance release: source consolidated into the `vscode-extensions` monorepo. No functional changes.

## [0.0.1]

- Initial release.
- `Diff: File` command — diff the active editor against a file picked from a quick pick.
- Picker lists open untitled buffers, other open files, and workspace files.
- Unsaved edits and never-saved (untitled) files are diffed live, with no temp-file snapshots.
- Configurable via `diff.showOpenFiles`, `diff.showUntitledFiles`, `diff.showFoundFiles`, `diff.include`, and `diff.exclude`.
