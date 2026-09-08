import * as path from 'node:path';
import * as vscode from 'vscode';
import { type ChangedFile, changedFiles, currentBranch, mergeBase, resolveBase, untrackedFiles } from './git';
import {
    buildFileTree,
    type DirNode,
    type FileNode,
    type MessageNode,
    messageNode,
    nodeTreeItem,
    type RepoNode,
} from './tree';

type ChangeNode = RepoNode | DirNode | FileNode | MessageNode;

export class CurrentBranchTreeProvider implements vscode.TreeDataProvider<ChangeNode> {
    private readonly emitter = new vscode.EventEmitter<ChangeNode | undefined>();
    readonly onDidChangeTreeData = this.emitter.event;

    private readonly cache = new Map<string, ChangeNode[]>();

    constructor(private readonly repoRoots: () => string[]) {}

    refresh(): void {
        this.cache.clear();
        this.emitter.fire(undefined);
    }

    dispose(): void {
        this.emitter.dispose();
    }

    getTreeItem(node: ChangeNode): vscode.TreeItem {
        return nodeTreeItem(node);
    }

    getChildren(node?: ChangeNode): vscode.ProviderResult<ChangeNode[]> {
        if (!node) {
            const roots = this.repoRoots();
            if (roots.length === 0) return [];
            if (roots.length === 1) return this.changeNodes(roots[0]);
            return roots.map((root): RepoNode => ({ kind: 'repo', root, label: path.basename(root) || root }));
        }
        if (node.kind === 'repo') return this.changeNodes(node.root);
        if (node.kind === 'dir') return [...node.children];
        return [];
    }

    private async changeNodes(root: string): Promise<ChangeNode[]> {
        const cached = this.cache.get(root);
        if (cached) return cached;

        const nodes = await this.computeChangeNodes(root);
        this.cache.set(root, nodes);
        return nodes;
    }

    private async computeChangeNodes(root: string): Promise<ChangeNode[]> {
        const parentId = `repo:${root}`;
        const branch = await currentBranch(root);
        if (!branch) return [messageNode(parentId, 'HEAD is detached — check out a branch to see its changes.')];

        const base = await resolveBase(root, this.baseBranch());
        if (!base) return [messageNode(parentId, 'Base branch not found — set "branchPrViewer.baseBranch".')];
        if (base === branch) return [messageNode(parentId, `On the base branch (${base}) — nothing to compare.`)];

        const mergeBaseRef = await mergeBase(root, base, branch);
        if (!mergeBaseRef) return [messageNode(parentId, `No common history with ${base}.`)];

        let files: ChangedFile[];
        try {
            files = await this.collectFiles(root, mergeBaseRef);
        } catch {
            return [messageNode(parentId, 'Failed to compute diff.')];
        }
        if (files.length === 0) return [messageNode(parentId, `No changes vs ${base}.`)];

        return buildFileTree(files, {
            root,
            base,
            branchName: branch,
            mergeBaseRef,
            right: { kind: 'worktree' },
        });
    }

    private async collectFiles(root: string, mergeBaseRef: string): Promise<ChangedFile[]> {
        const tracked = await changedFiles(root, mergeBaseRef);
        const untracked = await untrackedFiles(root);
        return [...tracked, ...untracked.map((file): ChangedFile => ({ status: 'A', path: file }))];
    }

    private baseBranch(): string {
        return vscode.workspace.getConfiguration('branchPrViewer').get<string>('baseBranch', '');
    }
}
