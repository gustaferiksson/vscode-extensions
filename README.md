# VS Code Extensions

Monorepo for Gustaf Eriksson's VS Code extensions, managed with [Bun](https://bun.sh) workspaces.

## Extensions

| Package | Marketplace | Description |
| --- | --- | --- |
| [`packages/diff-files`](packages/diff-files) | [`gustaferiksson.diff-files`](https://marketplace.visualstudio.com/items?itemName=gustaferiksson.diff-files) | Diff the active file against any open, unsaved, or workspace file. |
| [`packages/branch-pr-viewer`](packages/branch-pr-viewer) | [`gustaferiksson.branch-pr-viewer`](https://marketplace.visualstudio.com/items?itemName=gustaferiksson.branch-pr-viewer) | Browse local branches newest-first and review their changed files like a GitHub PR. |
| [`packages/workspace-explorer`](packages/workspace-explorer) | [`gustaferiksson.multi-repo-workspace-explorer`](https://marketplace.visualstudio.com/items?itemName=gustaferiksson.multi-repo-workspace-explorer) | Manage git repositories in your workspace with a repository browser. |

## Develop

Requires [Bun](https://bun.sh) 1.3+ — it is the package manager **and** the task runner.

```bash
bun install        # install shared dev dependencies (hoisted to the root)
bun run compile    # tsc build for every package
bun run watch      # tsc --watch for every package
bun run lint       # Biome check across all packages
bun run lint:fix   # Biome autofix
bun run format     # Biome format
bun run package    # build a .vsix for every package (compiles first)
```

Cross-package tasks fan out with `bun run --filter './packages/*' <script>`; linting/formatting is a single Biome pass over the whole tree.

Press **F5** and choose a **Run: \<extension\>** configuration to launch that extension in an Extension Development Host.

## Layout

```
.
├─ package.json            # bun workspaces + orchestration scripts + shared devDeps
├─ tsconfig.base.json      # shared compiler options (each package extends this)
├─ biome.json              # shared lint/format config
├─ .github/workflows/      # bun-based CI + tag-driven per-package release
└─ packages/
   ├─ diff-files/
   ├─ branch-pr-viewer/
   └─ workspace-explorer/
```

Each package keeps its own `package.json` (name, publisher, version, `contributes`), `README`, `CHANGELOG`, icon, and `.vscodeignore` — so it publishes as an independent Marketplace extension.

## Release

Each extension is versioned and published independently. See [PUBLISHING.md](PUBLISHING.md).

## License

MIT
