import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
    type BranchInfo,
    type ChangedFile,
    changedFiles,
    type DiffStat,
    diffStat,
    listBranches,
    mergeBase,
    resolveBase,
} from './git';
import { buildContentUri, buildFolderUri } from './providers';
import type { DiffStripes } from './stripes';

export type RepoNode = { readonly kind: 'repo'; readonly root: string; readonly label: string };
type BranchNode = {
    readonly kind: 'branch';
    readonly root: string;
    readonly branch: BranchInfo;
    readonly base: string | null;
};
export type DirNode = {
    readonly kind: 'dir';
    /** Display segment(s) — collapsed chains such as `src/analytics-agent`. */
    readonly name: string;
    /** Full directory path, for a stable tree-item id. */
    readonly path: string;
    readonly root: string;
    readonly branchName: string;
    readonly children: ReadonlyArray<DirNode | FileNode>;
};
export type FileNode = {
    readonly kind: 'file';
    readonly root: string;
    readonly base: string;
    readonly branchName: string;
    readonly mergeBaseRef: string;
    readonly right: RightSide;
    readonly file: ChangedFile;
};

export type RightSide = { readonly kind: 'ref'; readonly ref: string } | { readonly kind: 'worktree' };
export type MessageNode = { readonly kind: 'message'; readonly text: string; readonly parentId: string };

export type TreeNode = RepoNode | BranchNode | DirNode | FileNode | MessageNode;

export type BuildContext = {
    readonly root: string;
    readonly base: string;
    readonly branchName: string;
    readonly mergeBaseRef: string;
    readonly right: RightSide;
};

type Trie = { readonly dirs: Map<string, Trie>; readonly files: ChangedFile[] };

function makeFileNode(file: ChangedFile, ctx: BuildContext): FileNode {
    return {
        kind: 'file',
        root: ctx.root,
        base: ctx.base,
        branchName: ctx.branchName,
        mergeBaseRef: ctx.mergeBaseRef,
        right: ctx.right,
        file,
    };
}

/** Groups changed files into a folder tree (folders first, then files, alphabetical). */
export function buildFileTree(files: readonly ChangedFile[], ctx: BuildContext): Array<DirNode | FileNode> {
    const root: Trie = { dirs: new Map(), files: [] };
    for (const file of files) {
        const segments = file.path.split('/');
        const name = segments.pop();
        if (name === undefined) continue;

        let cur = root;
        for (const segment of segments) {
            let next = cur.dirs.get(segment);
            if (!next) {
                next = { dirs: new Map(), files: [] };
                cur.dirs.set(segment, next);
            }
            cur = next;
        }
        cur.files.push(file);
    }
    return trieToNodes(root, '', ctx);
}

function trieToNodes(trie: Trie, dirPath: string, ctx: BuildContext): Array<DirNode | FileNode> {
    const dirNodes: DirNode[] = [];
    for (const [segment, sub] of trie.dirs) {
        let name = segment;
        let fullPath = dirPath ? `${dirPath}/${segment}` : segment;
        let cur = sub;
        // Collapse a lone sub-directory into its parent, e.g. "src/analytics-agent".
        while (cur.files.length === 0 && cur.dirs.size === 1) {
            const [childSegment, childTrie] = [...cur.dirs][0];
            name = `${name}/${childSegment}`;
            fullPath = `${fullPath}/${childSegment}`;
            cur = childTrie;
        }
        dirNodes.push({
            kind: 'dir',
            name,
            path: fullPath,
            root: ctx.root,
            branchName: ctx.branchName,
            children: trieToNodes(cur, fullPath, ctx),
        });
    }
    dirNodes.sort((a, b) => a.name.localeCompare(b.name));

    const fileNodes = trie.files.sort((a, b) => a.path.localeCompare(b.path)).map((file) => makeFileNode(file, ctx));

    return [...dirNodes, ...fileNodes];
}

const STATUS_LABEL: Record<ChangedFile['status'], string> = {
    A: 'Added',
    M: 'Modified',
    D: 'Deleted',
    R: 'Renamed',
    C: 'Copied',
    T: 'Type changed',
    U: 'Unmerged',
};

function branchKey(root: string, name: string): string {
    return `${root}\0${name}`;
}

export function messageNode(parentId: string, text: string): MessageNode {
    return { kind: 'message', text, parentId };
}

const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const UNITS: ReadonlyArray<{ readonly limit: number; readonly unit: Intl.RelativeTimeFormatUnit }> = [
    { limit: 60, unit: 'seconds' },
    { limit: 60, unit: 'minutes' },
    { limit: 24, unit: 'hours' },
    { limit: 7, unit: 'days' },
    { limit: 4.34524, unit: 'weeks' },
    { limit: 12, unit: 'months' },
    { limit: Number.POSITIVE_INFINITY, unit: 'years' },
];

function relativeTime(epochMs: number): string {
    let value = (epochMs - Date.now()) / 1000;
    for (const { limit, unit } of UNITS) {
        if (Math.abs(value) < limit) return RTF.format(Math.round(value), unit);
        value /= limit;
    }
    return RTF.format(Math.round(value), 'years');
}

/** Runs `task` over `items` with at most `limit` in flight at once. */
async function pool<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const item = items[cursor++];
            await task(item);
        }
    });
    await Promise.all(workers);
}

/**
 * Two/three-level tree — `Repo → Branch → File` (the repo level is dropped when
 * only one repo is open). Branches are newest-first; a branch's children are the
 * files that differ from the base using three-dot (merge-base) semantics.
 */
export class BranchTreeProvider implements vscode.TreeDataProvider<TreeNode> {
    private readonly emitter = new vscode.EventEmitter<TreeNode | undefined>();
    readonly onDidChangeTreeData = this.emitter.event;

    private readonly branchesCache = new Map<string, TreeNode[]>();
    private readonly filesCache = new Map<string, TreeNode[]>();
    private readonly countsCache = new Map<string, DiffStat>();
    private readonly countsStarted = new Set<string>();

    constructor(private readonly repoRoots: () => string[]) {}

    /** Drops all caches and repaints — call after a git or config change. */
    refresh(): void {
        this.branchesCache.clear();
        this.filesCache.clear();
        this.countsCache.clear();
        this.countsStarted.clear();
        this.emitter.fire(undefined);
    }

    dispose(): void {
        this.emitter.dispose();
    }

    getTreeItem(node: TreeNode): vscode.TreeItem {
        if (node.kind === 'branch') {
            const item = new vscode.TreeItem(node.branch.name, vscode.TreeItemCollapsibleState.Collapsed);
            item.id = `branch:${node.root}:${node.branch.name}`;
            item.iconPath = new vscode.ThemeIcon('git-branch');
            item.description = this.branchDescription(node);
            item.tooltip = `${node.branch.name} · ${new Date(node.branch.committedAt).toLocaleString()}`;
            item.contextValue = 'branch';
            return item;
        }

        return nodeTreeItem(node);
    }

    getChildren(node?: TreeNode): vscode.ProviderResult<TreeNode[]> {
        if (!node) {
            const roots = this.repoRoots();
            if (roots.length === 0) return [];
            if (roots.length === 1) return this.branchNodes(roots[0]);
            return roots.map((root) => ({ kind: 'repo', root, label: path.basename(root) || root }));
        }
        if (node.kind === 'repo') return this.branchNodes(node.root);
        if (node.kind === 'branch') return this.fileNodes(node);
        if (node.kind === 'dir') return [...node.children];
        return [];
    }

    private branchDescription(node: BranchNode): string {
        const age = relativeTime(node.branch.committedAt);
        const stat = this.countsCache.get(branchKey(node.root, node.branch.name));
        if (stat && (stat.additions > 0 || stat.deletions > 0)) {
            return `${age}  +${stat.additions} -${stat.deletions}`;
        }
        return age;
    }

    private async branchNodes(root: string): Promise<TreeNode[]> {
        const cached = this.branchesCache.get(root);
        if (cached) return cached;

        let branches: BranchInfo[];
        try {
            branches = await listBranches(root);
        } catch {
            return this.cacheBranches(root, [messageNode(`repo:${root}`, 'Failed to read branches.')]);
        }

        const base = await resolveBase(root, this.baseBranch());

        if (branches.length === 0) {
            return this.cacheBranches(root, [messageNode(`repo:${root}`, 'No local branches.')]);
        }

        const nodes: TreeNode[] = branches.map((branch) => ({ kind: 'branch', root, branch, base }));
        this.cacheBranches(root, nodes);

        if (base && !this.countsStarted.has(root)) {
            this.countsStarted.add(root);
            void this.computeCounts(root, branches, base);
        }
        return nodes;
    }

    private cacheBranches(root: string, nodes: TreeNode[]): TreeNode[] {
        this.branchesCache.set(root, nodes);
        return nodes;
    }

    private async computeCounts(root: string, branches: readonly BranchInfo[], base: string): Promise<void> {
        await pool(branches, 8, async (branch) => {
            const stat = await diffStat(root, `${base}...${branch.name}`);
            this.countsCache.set(branchKey(root, branch.name), stat);
        });
        this.emitter.fire(undefined);
    }

    private async fileNodes(node: BranchNode): Promise<TreeNode[]> {
        const key = branchKey(node.root, node.branch.name);
        const cached = this.filesCache.get(key);
        if (cached) return cached;

        const nodes = await this.computeFileNodes(node);
        this.filesCache.set(key, nodes);
        return nodes;
    }

    private async computeFileNodes(node: BranchNode): Promise<TreeNode[]> {
        const parentId = `branch:${node.root}:${node.branch.name}`;
        const base = node.base;
        if (!base) {
            return [messageNode(parentId, 'Base branch not found — set "branchPrViewer.baseBranch".')];
        }

        const mergeBaseRef = await mergeBase(node.root, base, node.branch.name);
        if (!mergeBaseRef) return [messageNode(parentId, `No common history with ${base}.`)];

        let files: ChangedFile[];
        try {
            files = await changedFiles(node.root, mergeBaseRef, node.branch.name);
        } catch {
            return [messageNode(parentId, 'Failed to compute diff.')];
        }
        if (files.length === 0) return [messageNode(parentId, `No changes vs ${base}.`)];

        return buildFileTree(files, {
            root: node.root,
            base,
            branchName: node.branch.name,
            mergeBaseRef,
            right: { kind: 'ref', ref: node.branch.tip },
        });
    }

    private baseBranch(): string {
        return vscode.workspace.getConfiguration('branchPrViewer').get<string>('baseBranch', '');
    }
}

export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function rightUri(node: FileNode): vscode.Uri {
    if (node.right.kind === 'ref') {
        return buildContentUri(node.root, node.right.ref, node.file.path, node.file.status);
    }
    if (node.file.status === 'D') {
        return buildContentUri(node.root, EMPTY_TREE, node.file.path, node.file.status);
    }
    return vscode.Uri.file(path.join(node.root, node.file.path));
}

function fileTreeItem(node: FileNode): vscode.TreeItem {
    const displayPath = node.file.path;
    const item = new vscode.TreeItem(
        buildContentUri(node.root, node.mergeBaseRef, displayPath, node.file.status),
        vscode.TreeItemCollapsibleState.None
    );
    item.id = `file:${node.root}:${node.branchName}:${node.right.kind}:${displayPath}`;
    item.tooltip = node.file.oldPath
        ? `${node.file.oldPath} → ${displayPath} (${STATUS_LABEL[node.file.status]})`
        : `${displayPath} (${STATUS_LABEL[node.file.status]})`;
    item.contextValue = 'file';
    item.command = { command: 'branchPrViewer.openDiff', title: 'Open Diff', arguments: [node] };
    return item;
}

export function nodeTreeItem(node: RepoNode | DirNode | FileNode | MessageNode): vscode.TreeItem {
    if (node.kind === 'repo') {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
        item.id = `repo:${node.root}`;
        item.iconPath = new vscode.ThemeIcon('repo');
        item.contextValue = 'repo';
        return item;
    }

    if (node.kind === 'dir') {
        const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Expanded);
        item.id = `dir:${node.root}:${node.branchName}:${node.path}`;
        item.resourceUri = buildFolderUri(node.root, node.path);
        item.contextValue = 'dir';
        return item;
    }

    if (node.kind === 'file') return fileTreeItem(node);

    const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
    item.id = `msg:${node.parentId}:${node.text}`;
    item.iconPath = new vscode.ThemeIcon('info');
    item.contextValue = 'message';
    return item;
}

/** Opens the file itself rather than a diff: the working-tree copy when it exists, else the branch's version. */
export async function openFile(node?: TreeNode): Promise<void> {
    if (node?.kind !== 'file') return;

    const onDisk = vscode.Uri.file(path.join(node.root, node.file.path));
    const exists = await fs
        .stat(onDisk.fsPath)
        .then(() => true)
        .catch(() => false);

    await vscode.window.showTextDocument(exists ? onDisk : rightUri(node), { preview: true });
}

export async function openFileDiff(stripes: DiffStripes, node?: TreeNode): Promise<void> {
    if (node?.kind !== 'file') return;

    const displayPath = node.file.path;
    const left = buildContentUri(node.root, node.mergeBaseRef, node.file.oldPath ?? displayPath);
    const right = rightUri(node);
    const rightLabel = node.right.kind === 'worktree' ? 'working tree' : node.branchName;
    const title = `${path.basename(displayPath)} (${node.base} ↔ ${rightLabel})`;

    stripes.track(left, right, node);
    await vscode.commands.executeCommand('vscode.diff', left, right, title);
    await stripes.refresh();
}
