import * as path from 'node:path';
import * as vscode from 'vscode';
import {
    type ChangedFile,
    changedFiles,
    currentBranch,
    diffStats,
    mergeBase,
    resolveBase,
    uncommittedFiles,
    untrackedFiles,
    untrackedStats,
} from './git';
import { buildFileTree, messageNode, nodeTreeItem, type RepoNode, type TreeNode } from './tree';

type RepoChanges = { readonly nodes: TreeNode[]; readonly summary?: string };

export class CurrentBranchTreeProvider implements vscode.TreeDataProvider<TreeNode> {
    private readonly emitter = new vscode.EventEmitter<TreeNode | undefined>();
    readonly onDidChangeTreeData = this.emitter.event;

    private readonly cache = new Map<string, RepoChanges>();
    private readonly view = vscode.window.createTreeView('branchPrViewer.currentChanges', { treeDataProvider: this });

    constructor(private readonly repoRoots: () => string[]) {}

    refresh(): void {
        this.cache.clear();
        this.emitter.fire(undefined);
    }

    dispose(): void {
        this.view.dispose();
        this.emitter.dispose();
    }

    getTreeItem(node: TreeNode): vscode.TreeItem {
        return nodeTreeItem(node);
    }

    async getChildren(node?: TreeNode): Promise<TreeNode[]> {
        if (node?.kind === 'repo') return (await this.changes(node.root)).nodes;
        if (node?.kind === 'dir') return [...node.children];
        if (node) return [];

        const roots = this.repoRoots();
        const changes = await Promise.all(roots.map((root) => this.changes(root)));
        this.view.description = roots.length === 1 ? changes[0].summary : undefined;
        if (roots.length === 1) return changes[0].nodes;

        return roots.map(
            (root, index): RepoNode => ({
                kind: 'repo',
                root,
                label: path.basename(root) || root,
                description: changes[index].summary,
            })
        );
    }

    private async changes(root: string): Promise<RepoChanges> {
        const cached = this.cache.get(root);
        if (cached) return cached;

        const changes = await this.computeChanges(root);
        this.cache.set(root, changes);
        return changes;
    }

    private async computeChanges(root: string): Promise<RepoChanges> {
        const parentId = `repo:${root}`;
        const branch = await currentBranch(root);
        if (!branch) {
            return { nodes: [messageNode(parentId, 'HEAD is detached — check out a branch to see its changes.')] };
        }

        const base = await resolveBase(root, this.baseBranch());
        if (!base) {
            return { nodes: [messageNode(parentId, 'Base branch not found — set "branchPrViewer.baseBranch".')] };
        }
        if (base === branch) {
            return { nodes: [messageNode(parentId, `On the base branch (${base}) — nothing to compare.`)] };
        }

        const mergeBaseRef = await mergeBase(root, base, branch);
        if (!mergeBaseRef) return { nodes: [messageNode(parentId, `No common history with ${base}.`)] };

        let files: ChangedFile[];
        try {
            files = await this.collectFiles(root, mergeBaseRef);
        } catch {
            return { nodes: [messageNode(parentId, 'Failed to compute diff.')] };
        }
        if (files.length === 0) return { nodes: [messageNode(parentId, `No changes vs ${base}.`)] };

        const additions = files.reduce((sum, file) => sum + (file.stat?.additions ?? 0), 0);
        const deletions = files.reduce((sum, file) => sum + (file.stat?.deletions ?? 0), 0);
        return {
            nodes: buildFileTree(files, { root, base, branchName: branch, mergeBaseRef }),
            summary: `${branch} → ${base}  +${additions} −${deletions}`,
        };
    }

    private async collectFiles(root: string, mergeBaseRef: string): Promise<ChangedFile[]> {
        const [tracked, untracked, stats, uncommitted] = await Promise.all([
            changedFiles(root, mergeBaseRef),
            untrackedFiles(root),
            diffStats(root, mergeBaseRef),
            uncommittedFiles(root),
        ]);
        const newStats = await untrackedStats(root, untracked);

        return [
            ...tracked.map(
                (file): ChangedFile => ({
                    ...file,
                    stat: stats.get(file.path),
                    uncommitted: uncommitted.has(file.path),
                })
            ),
            ...untracked.map(
                (file): ChangedFile => ({ status: 'A', path: file, stat: newStats.get(file), uncommitted: true })
            ),
        ];
    }

    private baseBranch(): string {
        return vscode.workspace.getConfiguration('branchPrViewer').get<string>('baseBranch', '');
    }
}
