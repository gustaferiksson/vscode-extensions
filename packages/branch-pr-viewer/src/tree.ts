import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ChangedFile } from './git';
import { buildContentUri, buildFolderUri } from './providers';
import type { DiffStripes } from './stripes';

export type RepoNode = { readonly kind: 'repo'; readonly root: string; readonly label: string };
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
    readonly file: ChangedFile;
};

export type MessageNode = { readonly kind: 'message'; readonly text: string; readonly parentId: string };

export type TreeNode = RepoNode | DirNode | FileNode | MessageNode;

export type BuildContext = {
    readonly root: string;
    readonly base: string;
    readonly branchName: string;
    readonly mergeBaseRef: string;
};

type Trie = { readonly dirs: Map<string, Trie>; readonly files: ChangedFile[] };

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

    const fileNodes = trie.files
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((file): FileNode => ({ kind: 'file', ...ctx, file }));

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

export function messageNode(parentId: string, text: string): MessageNode {
    return { kind: 'message', text, parentId };
}

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function rightUri(node: FileNode): vscode.Uri {
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
    item.id = `file:${node.root}:${node.branchName}:${displayPath}`;
    item.tooltip = node.file.oldPath
        ? `${node.file.oldPath} → ${displayPath} (${STATUS_LABEL[node.file.status]})`
        : `${displayPath} (${STATUS_LABEL[node.file.status]})`;
    item.contextValue = 'file';
    item.command = { command: 'branchPrViewer.openDiff', title: 'Open Diff', arguments: [node] };
    return item;
}

export function nodeTreeItem(node: TreeNode): vscode.TreeItem {
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

/** Opens the working-tree file rather than a diff; a file deleted on disk opens empty. */
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
    const title = `${path.basename(displayPath)} (${node.base} ↔ working tree)`;

    stripes.track(left, right, node);
    await vscode.commands.executeCommand('vscode.diff', left, right, title);
    await stripes.refresh();
}
