import * as vscode from 'vscode';
import { discoverRepoRoot, listBranches } from './git';
import { registerProviders } from './providers';
import { BranchTreeProvider, openFileDiff } from './tree';

/** The slice of the built-in Git extension API we rely on for repo discovery. */
type GitRepository = { readonly rootUri: vscode.Uri };
type GitAPI = {
    readonly repositories: readonly GitRepository[];
    readonly onDidOpenRepository: vscode.Event<GitRepository>;
    readonly onDidCloseRepository: vscode.Event<GitRepository>;
    readonly onDidChangeState: vscode.Event<unknown>;
};
type GitExtension = { getAPI(version: 1): GitAPI };

async function getGitApi(): Promise<GitAPI | undefined> {
    const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!ext) return undefined;
    try {
        const exports = ext.isActive ? ext.exports : await ext.activate();
        return exports.getAPI(1);
    } catch {
        return undefined;
    }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const roots = new Set<string>();
    const tree = new BranchTreeProvider(() => [...roots].sort((a, b) => a.localeCompare(b)));

    let api: GitAPI | undefined;

    const refreshRoots = async (): Promise<void> => {
        roots.clear();
        for (const repo of api?.repositories ?? []) roots.add(repo.rootUri.fsPath);

        // Fallback for setups where the Git extension hasn't surfaced repos yet.
        if (roots.size === 0) {
            for (const folder of vscode.workspace.workspaceFolders ?? []) {
                const root = await discoverRepoRoot(folder.uri.fsPath);
                if (root) roots.add(root);
            }
        }
        tree.refresh();
    };

    context.subscriptions.push(
        tree,
        vscode.window.registerTreeDataProvider('branchPrViewer.branches', tree),
        ...registerProviders(),
        vscode.commands.registerCommand('branchPrViewer.refresh', () => tree.refresh()),
        vscode.commands.registerCommand('branchPrViewer.openDiff', openFileDiff),
        vscode.commands.registerCommand('branchPrViewer.selectBase', () => selectBase(() => [...roots])),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('branchPrViewer.baseBranch')) tree.refresh();
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(() => void refreshRoots())
    );

    api = await getGitApi();
    if (api) {
        context.subscriptions.push(
            api.onDidOpenRepository(() => void refreshRoots()),
            api.onDidCloseRepository(() => void refreshRoots()),
            api.onDidChangeState(() => void refreshRoots())
        );
    }

    await refreshRoots();
}

/** Prompts for a base branch (union across repos) and stores it in the setting. */
async function selectBase(getRoots: () => string[]): Promise<void> {
    const names = new Set<string>();
    for (const root of getRoots()) {
        try {
            for (const branch of await listBranches(root)) names.add(branch.name);
        } catch {
            // Skip repos that fail to enumerate.
        }
    }

    if (names.size === 0) {
        vscode.window.showInformationMessage('No branches found to choose a base from.');
        return;
    }

    const config = vscode.workspace.getConfiguration('branchPrViewer');
    const current = config.get<string>('baseBranch', '');
    const picked = await vscode.window.showQuickPick(
        [...names].sort((a, b) => a.localeCompare(b)),
        {
            placeHolder: `Base branch to compare against (current: ${current || 'auto — main, then master'})`,
        }
    );
    if (picked === undefined) return;

    const target = vscode.workspace.workspaceFolders
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
    await config.update('baseBranch', picked, target);
}

export function deactivate(): void {
    // Nothing to clean up beyond the disposables registered on the context.
}
