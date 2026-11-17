import * as vscode from 'vscode';
import { CurrentBranchTreeProvider } from './current';
import { applyDiffStyle, toggleDiffStyle } from './diffStyle';
import { discoverRepoRoot, listBranches } from './git';
import { registerProviders } from './providers';
import { DiffStripes } from './stripes';
import { openFile, openFileDiff, type TreeNode } from './tree';

/** The slice of the built-in Git extension API we rely on for repo discovery. */
type GitRepository = {
    readonly rootUri: vscode.Uri;
    readonly state: {
        readonly onDidChange: vscode.Event<unknown>;
    };
};
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
    const sortedRoots = (): string[] => [...roots].sort((a, b) => a.localeCompare(b));
    const current = new CurrentBranchTreeProvider(sortedRoots);
    const stripes = new DiffStripes();
    const refreshStripes = (): void => void stripes.refresh();

    let api: GitAPI | undefined;

    const refreshAll = (): void => current.refresh();
    const refreshCurrentSoon = debounce(() => {
        current.refresh();
        refreshStripes();
    }, 200);

    let repoStates: vscode.Disposable[] = [];
    const watchRepoStates = (): void => {
        for (const watcher of repoStates) watcher.dispose();
        repoStates = (api?.repositories ?? []).map((repo) => repo.state.onDidChange(refreshCurrentSoon));
    };

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
        watchRepoStates();
        refreshAll();
    };

    context.subscriptions.push(
        current,
        stripes,
        new vscode.Disposable(() => {
            for (const watcher of repoStates) watcher.dispose();
        }),
        ...registerProviders(),
        vscode.commands.registerCommand('branchPrViewer.refresh', refreshAll),
        vscode.commands.registerCommand('branchPrViewer.openDiff', (node?: TreeNode) => openFileDiff(stripes, node)),
        vscode.commands.registerCommand('branchPrViewer.openFile', openFile),
        vscode.window.onDidChangeVisibleTextEditors(refreshStripes),
        vscode.window.tabGroups.onDidChangeTabs(refreshStripes),
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (stripes.tracks(document.uri)) refreshStripes();
        }),
        vscode.commands.registerCommand('branchPrViewer.toggleDiffStyle', toggleDiffStyle),
        vscode.commands.registerCommand('branchPrViewer.viewAsList', () =>
            vscode.workspace
                .getConfiguration('branchPrViewer')
                .update('viewMode', 'list', vscode.ConfigurationTarget.Global)
        ),
        vscode.commands.registerCommand('branchPrViewer.viewAsTree', () =>
            vscode.workspace
                .getConfiguration('branchPrViewer')
                .update('viewMode', 'tree', vscode.ConfigurationTarget.Global)
        ),
        vscode.commands.registerCommand('branchPrViewer.selectBase', () => selectBase(() => [...roots])),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (
                event.affectsConfiguration('branchPrViewer.baseBranch') ||
                event.affectsConfiguration('branchPrViewer.viewMode')
            ) {
                refreshAll();
            }
            if (event.affectsConfiguration('branchPrViewer.diffStyle')) {
                void applyDiffStyle();
                refreshStripes();
            }
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
    } else {
        context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(() => refreshCurrentSoon()));
    }

    await refreshRoots();
    await applyDiffStyle();
}

/** Prompts for a base branch (union across repos) and stores it in the setting. */
async function selectBase(getRoots: () => string[]): Promise<void> {
    const names = new Set<string>();
    for (const root of getRoots()) {
        try {
            for (const name of await listBranches(root)) names.add(name);
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

function debounce(action: () => void, ms: number): () => void {
    let timer: NodeJS.Timeout | undefined;
    return () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(action, ms);
    };
}

export function deactivate(): void {
    // Nothing to clean up beyond the disposables registered on the context.
}
