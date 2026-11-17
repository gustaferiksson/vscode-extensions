import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Generous ceiling so large diffs and file contents don't overflow the pipe. */
const MAX_BUFFER = 128 * 1024 * 1024;

export type FileStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U';

export type ChangedFile = {
    readonly status: FileStatus;
    /** The file's path on the working-tree side (the deleted path for `D`). */
    readonly path: string;
    /** Original path for renames/copies. */
    readonly oldPath?: string;
};

/** Runs git in `root`, resolving to trimmed stdout. Rejects with stderr on failure. */
async function runGit(root: string, args: readonly string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args as string[], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: MAX_BUFFER,
    });
    return stdout;
}

/** Like {@link runGit} but resolves to `null` instead of rejecting — for existence probes. */
async function tryGit(root: string, args: readonly string[]): Promise<string | null> {
    try {
        return await runGit(root, args);
    } catch {
        return null;
    }
}

/** Resolves the repository root for a folder, or `null` if it isn't inside a git repo. */
export async function discoverRepoRoot(folder: string): Promise<string | null> {
    const out = await tryGit(folder, ['rev-parse', '--show-toplevel']);
    return out ? out.trim() : null;
}

export async function listBranches(root: string): Promise<string[]> {
    const out = await runGit(root, ['for-each-ref', 'refs/heads', '--format=%(refname:short)']);
    return out.split('\n').filter(Boolean);
}

/**
 * Picks the base branch for three-dot comparisons: the configured branch if it
 * exists locally, otherwise `main`, then `master`. Returns `null` if none exist.
 */
export async function resolveBase(root: string, configured: string): Promise<string | null> {
    const candidates = [configured.trim(), 'main', 'master'].filter(Boolean);
    for (const name of candidates) {
        const found = await tryGit(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]);
        if (found) return name;
    }
    return null;
}

/** The checked-out branch name, or `null` when HEAD is detached. */
export async function currentBranch(root: string): Promise<string | null> {
    const out = await tryGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const name = out?.trim();
    return name && name !== 'HEAD' ? name : null;
}

/** Files present on disk but not tracked by git, honouring ignore rules. */
export async function untrackedFiles(root: string): Promise<string[]> {
    const out = await tryGit(root, ['ls-files', '--others', '--exclude-standard', '-z']);
    return out ? out.split('\0').filter(Boolean) : [];
}

/** The merge base of `base` and `branch` (GitHub's PR base), or `null` if unrelated. */
export async function mergeBase(root: string, base: string, branch: string): Promise<string | null> {
    const out = await tryGit(root, ['merge-base', base, branch]);
    return out ? out.trim() : null;
}

const RENAME_OR_COPY = new Set(['R', 'C']);
const KNOWN_STATUS = new Set<FileStatus>(['A', 'M', 'D', 'R', 'C', 'T', 'U']);

function toStatus(code: string): FileStatus {
    const first = code.charAt(0);
    return KNOWN_STATUS.has(first as FileStatus) ? (first as FileStatus) : 'M';
}

/**
 * Files that differ between `from` and the working tree, with rename/copy detection.
 * Uses NUL-delimited output so paths with spaces or unusual characters are safe.
 */
export async function changedFiles(root: string, from: string): Promise<ChangedFile[]> {
    const out = await runGit(root, ['diff', '--name-status', '--find-renames', '-z', from]);
    const parts = out.split('\0');

    const files: ChangedFile[] = [];
    let i = 0;
    while (i < parts.length) {
        const token = parts[i];
        if (!token) {
            i += 1;
            continue;
        }

        const status = toStatus(token);
        if (RENAME_OR_COPY.has(token.charAt(0))) {
            const oldPath = parts[i + 1];
            const newPath = parts[i + 2];
            if (oldPath === undefined || newPath === undefined) break;
            files.push({ status, path: newPath, oldPath });
            i += 3;
            continue;
        }

        const path = parts[i + 1];
        if (path === undefined) break;
        files.push({ status, path });
        i += 2;
    }
    return files;
}

export type LineRanges = { readonly added: readonly [number, number][]; readonly removed: readonly [number, number][] };

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Changed line ranges (1-based, inclusive) for one file: `removed` on the `from`
 * side, `added` on the working-tree side.
 */
export async function changedLines(root: string, from: string, paths: readonly string[]): Promise<LineRanges> {
    const out = await tryGit(root, ['diff', '-U0', '--find-renames', from, '--', ...paths]);
    if (!out) return { added: [], removed: [] };

    const added: [number, number][] = [];
    const removed: [number, number][] = [];
    for (const line of out.split('\n')) {
        const match = HUNK.exec(line);
        if (!match) continue;
        const [oldStart, oldCount, newStart, newCount] = [
            Number(match[1]),
            match[2] === undefined ? 1 : Number(match[2]),
            Number(match[3]),
            match[4] === undefined ? 1 : Number(match[4]),
        ];
        if (oldCount > 0) removed.push([oldStart, oldStart + oldCount - 1]);
        if (newCount > 0) added.push([newStart, newStart + newCount - 1]);
    }
    return { added, removed };
}

/**
 * Contents of `relPath` at commit `ref`. Resolves to an empty string when the
 * path does not exist at that ref (e.g. the base side of an added file), which
 * renders as a clean whole-file add/delete in the diff editor.
 */
export async function showFile(root: string, ref: string, relPath: string): Promise<string> {
    const out = await tryGit(root, ['show', `${ref}:${relPath}`]);
    return out ?? '';
}
