# Publishing Guide

Each extension in this monorepo publishes **independently** to its own Marketplace
listing under the `gustaferiksson` publisher. A release is triggered by pushing a
tag of the form **`<package-dir>-vX.Y.Z`** — e.g. `diff-files-v0.0.2`,
`branch-pr-viewer-v0.1.0`, `workspace-explorer-v0.0.12`.

Everything runs on **Bun** (no npm, no Node setup). `vsce` is invoked via `bunx`
with `--no-dependencies` (all three extensions have zero runtime dependencies).

## Quick Start (TL;DR)

Publish, for example, `branch-pr-viewer`:

```bash
# 1. Bump the version in that package (must exceed the currently published version).
cd packages/branch-pr-viewer
npm version patch --no-git-tag-version   # or edit "version" by hand
cd ../..

# 2. Commit, then tag <dir>-v<version> and push.
git commit -am "branch-pr-viewer 0.0.2"
git tag branch-pr-viewer-v0.0.2
git push && git push --tags
```

Pushing the tag runs `.github/workflows/release.yml`, which derives the package
from the tag, compiles, packages the `.vsix`, publishes it to the Marketplace, and
creates a GitHub release with the `.vsix` attached.

## Preconditions

- `git status` clean, on `main`, fully pushed.
- The repo has a `VSCE_PAT` Actions secret (Azure DevOps PAT, scope **Marketplace → Manage**).
  Reuse the same token as the standalone extension repos: `gh secret list | grep -q VSCE_PAT`.
- `gh auth status` is logged in.

## Watch and verify

```bash
RUN=$(gh run list --workflow=release.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN" --exit-status || gh run view "$RUN" --log-failed

# Marketplace (indexing can lag ~1 min); replace ITEM with e.g. gustaferiksson.branch-pr-viewer:
curl -s 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery' \
  -H 'Accept: application/json;api-version=3.0-preview.1' -H 'Content-Type: application/json' \
  -X POST --data '{"filters":[{"criteria":[{"filterType":7,"value":"ITEM"}]}],"flags":914}' \
  | python3 -c "import sys,json; e=json.load(sys.stdin)['results'][0]['extensions']; print(e[0]['versions'][0]['version'] if e else 'NOT FOUND')"
```

## Package locally (dry run)

```bash
bun install
bun run compile
cd packages/<name> && bunx @vscode/vsce package --no-dependencies
```

## Notes / gotchas

- The **tag prefix must equal the package directory name** (`diff-files`,
  `branch-pr-viewer`, `workspace-explorer`), not the extension's Marketplace name.
  The workflow maps the tag to `packages/<prefix>` and publishes whatever
  `package.json` name lives there.
- `vsce publish` fails if that version is already on the Marketplace — always bump first.
- Only the **tag** push publishes; pushing to `main` just runs CI (lint + compile).
- Publish failing with an auth error ⇒ the `VSCE_PAT` expired. Regenerate the Azure
  DevOps PAT and update the secret.
