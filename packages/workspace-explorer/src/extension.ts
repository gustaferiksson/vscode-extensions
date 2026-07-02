import { execSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    // Set initial context for multi-folder workspace state
    updateMultiFolderWorkspaceContext();

    // Repository browser for discovering and adding repos
    const repoBrowserProvider = new RepoBrowserProvider(context);
    const repoBrowserView = vscode.window.createTreeView('repoBrowser', {
        treeDataProvider: repoBrowserProvider,
        showCollapseAll: true,
    });

    context.subscriptions.push(repoBrowserView);

    // Listen for expand/collapse events to save state
    repoBrowserView.onDidExpandElement((e) => {
        if (e.element instanceof FolderNode) {
            repoBrowserProvider.onDidExpandElement(e.element);
        }
    });

    repoBrowserView.onDidCollapseElement((e) => {
        if (e.element instanceof FolderNode) {
            repoBrowserProvider.onDidCollapseElement(e.element);
        }
    });

    // Manager for workspace folder views
    const workspaceViewManager = new WorkspaceViewManager();
    context.subscriptions.push(workspaceViewManager);

    // Active workspace provider for showing current workspace folders
    const activeWorkspaceProvider = new ActiveWorkspaceProvider();
    const activeWorkspaceView = vscode.window.createTreeView('activeWorkspace', {
        treeDataProvider: activeWorkspaceProvider,
    });
    context.subscriptions.push(activeWorkspaceView);

    // Favorites provider for organizing repos
    const favoritesProvider = new FavoritesProvider(context);
    const favoritesView = vscode.window.createTreeView('favoriteRepos', {
        treeDataProvider: favoritesProvider,
        showCollapseAll: true,
        dragAndDropController: favoritesProvider,
    });
    context.subscriptions.push(favoritesView);

    // Commands for repository management
    context.subscriptions.push(
        vscode.commands.registerCommand('multiRepoWorkspaceExplorer.addToWorkspace', async (node: RepoNode) => {
            if (node?.repoPath) {
                const uri = vscode.Uri.file(node.repoPath);
                const success = vscode.workspace.updateWorkspaceFolders(
                    vscode.workspace.workspaceFolders?.length ?? 0,
                    0,
                    { uri, name: node.label }
                );
                if (success) {
                    repoBrowserProvider.refresh();
                    vscode.window.showInformationMessage(`Added ${node.label} to workspace`);
                }
            }
        }),

        vscode.commands.registerCommand(
            'multiRepoWorkspaceExplorer.removeFromWorkspace',
            async (node: RepoNode | ActiveWorkspaceRepoNode) => {
                if (node?.repoPath) {
                    const folders = vscode.workspace.workspaceFolders;
                    if (!folders || folders.length === 0) return;

                    const folderIndex = folders.findIndex((f) => f.uri.fsPath === node.repoPath);
                    if (folderIndex === -1) return;

                    // Removing the first folder will always cause VS Code to reload
                    // This is a platform limitation we cannot work around
                    if (folderIndex === 0 && folders.length > 1) {
                        const action = await vscode.window.showWarningMessage(
                            `Removing the first workspace folder will restart VS Code. To avoid this, remove other folders first, then remove this one last.`,
                            { modal: true },
                            'Remove Anyway',
                            'Cancel'
                        );

                        if (action !== 'Remove Anyway') {
                            return;
                        }
                    }

                    // Perform the removal
                    vscode.workspace.updateWorkspaceFolders(folderIndex, 1);
                    repoBrowserProvider.refresh();
                    activeWorkspaceProvider.refresh();
                    vscode.window.showInformationMessage(`Removed ${node.label} from workspace`);
                }
            }
        ),

        vscode.commands.registerCommand(
            'multiRepoWorkspaceExplorer.replaceWorkspace',
            async (node: RepoNode | ActiveWorkspaceRepoNode) => {
                if (node?.repoPath) {
                    const uri = vscode.Uri.file(node.repoPath);
                    await vscode.commands.executeCommand('vscode.openFolder', uri, false);
                }
            }
        ),

        vscode.commands.registerCommand(
            'multiRepoWorkspaceExplorer.openInNewWindow',
            async (node: RepoNode | ActiveWorkspaceRepoNode) => {
                if (node?.repoPath) {
                    const config = vscode.workspace.getConfiguration('multiRepoWorkspaceExplorer');
                    const useNativeTabs = config.get<boolean>('useNativeWindowTabs', false);

                    if (useNativeTabs) {
                        const codeCliPath = path.join(vscode.env.appRoot, 'bin', 'code');
                        const appleScript = `on run argv
    set repoPath to item 1 of argv
    set cliPath to item 2 of argv
    tell application "System Events"
        tell process "Code"
            click menu item "New Tab" of menu "Window" of menu bar 1
        end tell
    end tell
    delay 0
    do shell script (quoted form of cliPath) & " --reuse-window " & quoted form of repoPath
end run`;
                        const proc = spawn('osascript', ['-', node.repoPath, codeCliPath], {
                            stdio: ['pipe', 'ignore', 'ignore'],
                        });
                        proc.stdin?.write(appleScript);
                        proc.stdin?.end();
                    } else {
                        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(node.repoPath), true);
                    }
                }
            }
        ),

        vscode.commands.registerCommand('multiRepoWorkspaceExplorer.refreshRepos', () => {
            repoBrowserProvider.refresh();
            vscode.window.showInformationMessage('Refreshed repositories');
        }),

        vscode.commands.registerCommand('multiRepoWorkspaceExplorer.refreshActiveWorkspace', () => {
            activeWorkspaceProvider.refresh();
        }),

        // Favorites management commands
        vscode.commands.registerCommand('multiRepoWorkspaceExplorer.addToFavorites', async (node: RepoNode) => {
            if (node?.repoPath) {
                const groups = await favoritesProvider.getGroups();

                const items = [
                    { label: 'Ungrouped', value: null, iconPath: new vscode.ThemeIcon('star-empty') },
                    ...groups.map((g) => ({
                        label: g,
                        value: g,
                        iconPath: new vscode.ThemeIcon('folder'),
                    })),
                ];

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: `Add ${node.label} to favorites`,
                });

                if (selected !== undefined) {
                    if (selected.value === null) {
                        await favoritesProvider.addRepoToFavorites(node.repoPath, node.label);
                        vscode.window.showInformationMessage(`Added ${node.label} to favorites`);
                    } else {
                        await favoritesProvider.addRepoToGroup(node.repoPath, node.label, selected.value);
                        vscode.window.showInformationMessage(`Added ${node.label} to ${selected.value}`);
                    }
                }
            }
        }),

        vscode.commands.registerCommand('multiRepoWorkspaceExplorer.addToFavoritesInGroup', async (node: RepoNode) => {
            if (node?.repoPath) {
                const groups = await favoritesProvider.getGroups();

                if (groups.length === 0) {
                    vscode.window.showInformationMessage('No groups exist. Create a group first.');
                    return;
                }

                const items = groups.map((g) => ({ label: g, value: g }));

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select a group to add to',
                });

                if (selected) {
                    await favoritesProvider.addRepoToGroup(node.repoPath, node.label, selected.value);
                    vscode.window.showInformationMessage(`Added ${node.label} to ${selected.value}`);
                }
            }
        }),

        vscode.commands.registerCommand(
            'multiRepoWorkspaceExplorer.removeFromFavorites',
            async (node: FavoriteRepoNode) => {
                if (node?.repoPath) {
                    await favoritesProvider.removeRepoFromFavorites(node.repoPath, node.groupName);
                    vscode.window.showInformationMessage(`Removed ${node.label} from favorites`);
                }
            }
        ),

        vscode.commands.registerCommand('multiRepoWorkspaceExplorer.createGroup', async () => {
            const groupName = await vscode.window.showInputBox({
                prompt: 'Enter group name',
                placeHolder: 'My Group',
            });
            if (groupName) {
                await favoritesProvider.createGroup(groupName);
                vscode.window.showInformationMessage(`Created group: ${groupName}`);
            }
        }),

        vscode.commands.registerCommand('multiRepoWorkspaceExplorer.deleteGroup', async (node: GroupNode) => {
            if (node?.groupName) {
                const result = await vscode.window.showWarningMessage(
                    `Delete group "${node.groupName}"? Repositories will not be deleted.`,
                    { modal: true },
                    'Delete'
                );
                if (result === 'Delete') {
                    await favoritesProvider.deleteGroup(node.groupName);
                    vscode.window.showInformationMessage(`Deleted group: ${node.groupName}`);
                }
            }
        }),

        vscode.commands.registerCommand('multiRepoWorkspaceExplorer.renameGroup', async (node: GroupNode) => {
            if (node?.groupName) {
                const newName = await vscode.window.showInputBox({
                    prompt: 'Enter new group name',
                    value: node.groupName,
                });
                if (newName && newName !== node.groupName) {
                    await favoritesProvider.renameGroup(node.groupName, newName);
                    vscode.window.showInformationMessage(`Renamed group to: ${newName}`);
                }
            }
        }),

        vscode.commands.registerCommand('multiRepoWorkspaceExplorer.moveToGroup', async (node: FavoriteRepoNode) => {
            if (node?.repoPath) {
                const groups = await favoritesProvider.getGroups();
                const items = [{ label: '(Ungrouped)', value: null }, ...groups.map((g) => ({ label: g, value: g }))];

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select a group',
                });

                if (selected !== undefined) {
                    await favoritesProvider.moveRepoToGroup(node.repoPath, node.label, selected.value);
                    vscode.window.showInformationMessage(
                        selected.value ? `Moved ${node.label} to ${selected.value}` : `Moved ${node.label} to ungrouped`
                    );
                }
            }
        }),

        vscode.commands.registerCommand('multiRepoWorkspaceExplorer.openAllInGroup', async (node: GroupNode) => {
            if (node?.repos) {
                const repos = node.repos;
                if (repos.length === 0) {
                    vscode.window.showInformationMessage('Group is empty');
                    return;
                }

                // Create a temporary workspace file with all repos
                const workspaceConfig = {
                    folders: repos.map((repo) => ({
                        path: repo.path,
                        name: repo.name,
                    })),
                };

                // Write to a temporary file
                const tmpWorkspaceFile = path.join(require('node:os').tmpdir(), `${node.groupName}.code-workspace`);
                fs.writeFileSync(tmpWorkspaceFile, JSON.stringify(workspaceConfig, null, 2));

                // Open in new window
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(tmpWorkspaceFile), true);
            }
        }),

        vscode.commands.registerCommand(
            'multiRepoWorkspaceExplorer.replaceWorkspaceWithGroup',
            async (node: GroupNode) => {
                if (node?.repos) {
                    const repos = node.repos;
                    if (repos.length === 0) {
                        vscode.window.showInformationMessage('Group is empty');
                        return;
                    }

                    // Remove all current workspace folders and add all repos in one call
                    const currentFolderCount = vscode.workspace.workspaceFolders?.length ?? 0;
                    const foldersToAdd = repos.map((repo) => ({
                        uri: vscode.Uri.file(repo.path),
                        name: repo.name,
                    }));

                    vscode.workspace.updateWorkspaceFolders(0, currentFolderCount, ...foldersToAdd);

                    repoBrowserProvider.refresh();
                    vscode.window.showInformationMessage(
                        `Replaced workspace with ${repos.length} repositories from ${node.groupName}`
                    );
                }
            }
        ),

        vscode.commands.registerCommand('multiRepoWorkspaceExplorer.refreshFavorites', () => {
            favoritesProvider.refresh();
            vscode.window.showInformationMessage('Refreshed favorites');
        }),

        vscode.commands.registerCommand('multiRepoWorkspaceExplorer.cleanupFavorites', async () => {
            await favoritesProvider.cleanupInvalidEntries();
            vscode.window.showInformationMessage('Cleaned up invalid favorites');
        }),

        // File operations
        vscode.commands.registerCommand('multiRepoWorkspaceExplorer.renameFile', async (node?: FileNode) => {
            const item = node || workspaceViewManager.getSelectedItem();
            if (item?.resourceUri) {
                const oldUri = item.resourceUri;
                const oldName = path.basename(oldUri.fsPath);
                const newName = await vscode.window.showInputBox({
                    prompt: 'Enter new name',
                    value: oldName,
                    valueSelection: [0, oldName.lastIndexOf('.') !== -1 ? oldName.lastIndexOf('.') : oldName.length],
                });

                if (newName && newName !== oldName) {
                    const newUri = vscode.Uri.joinPath(oldUri, '..', newName);
                    await vscode.workspace.fs.rename(oldUri, newUri);
                    workspaceViewManager.refreshAll();
                }
            }
        }),

        vscode.commands.registerCommand('multiRepoWorkspaceExplorer.deleteFile', async (node?: FileNode) => {
            const item = node || workspaceViewManager.getSelectedItem();
            if (item?.resourceUri) {
                const result = await vscode.window.showWarningMessage(
                    `Are you sure you want to delete ${item.label}?`,
                    { modal: true },
                    'Move to Trash'
                );
                if (result === 'Move to Trash') {
                    await vscode.workspace.fs.delete(item.resourceUri, { recursive: true, useTrash: true });
                    workspaceViewManager.refreshAll();
                }
            }
        }),

        vscode.commands.registerCommand('multiRepoWorkspaceExplorer.copyPath', (node: FileNode) => {
            if (node?.resourceUri) {
                vscode.env.clipboard.writeText(node.resourceUri.fsPath);
                vscode.window.showInformationMessage('Path copied to clipboard');
            }
        }),

        vscode.commands.registerCommand('multiRepoWorkspaceExplorer.copyRelativePath', (node: FileNode) => {
            if (node?.resourceUri) {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(node.resourceUri);
                if (workspaceFolder) {
                    const relativePath = path.relative(workspaceFolder.uri.fsPath, node.resourceUri.fsPath);
                    vscode.env.clipboard.writeText(relativePath);
                    vscode.window.showInformationMessage('Relative path copied to clipboard');
                }
            }
        }),

        vscode.commands.registerCommand('multiRepoWorkspaceExplorer.revealInFinder', (node: FileNode) => {
            if (node?.resourceUri) {
                vscode.commands.executeCommand('revealFileInOS', node.resourceUri);
            }
        }),

        vscode.commands.registerCommand('multiRepoWorkspaceExplorer.newFile', async (node: FileNode) => {
            if (!node?.resourceUri) return;
            const parentUri = node.isDirectory ? node.resourceUri : vscode.Uri.joinPath(node.resourceUri, '..');
            const fileName = await vscode.window.showInputBox({ prompt: 'File name' });
            if (fileName) {
                const fileUri = vscode.Uri.joinPath(parentUri, fileName);
                await vscode.workspace.fs.writeFile(fileUri, new Uint8Array());
                await vscode.commands.executeCommand('vscode.open', fileUri);
                workspaceViewManager.refreshAll();
            }
        }),

        vscode.commands.registerCommand('multiRepoWorkspaceExplorer.newFolder', async (node: FileNode) => {
            if (!node?.resourceUri) return;
            const parentUri = node.isDirectory ? node.resourceUri : vscode.Uri.joinPath(node.resourceUri, '..');
            const folderName = await vscode.window.showInputBox({ prompt: 'Folder name' });
            if (folderName) {
                const folderUri = vscode.Uri.joinPath(parentUri, folderName);
                await vscode.workspace.fs.createDirectory(folderUri);
                workspaceViewManager.refreshAll();
            }
        }),

        vscode.commands.registerCommand('multiRepoWorkspaceExplorer.openToSide', (node: FileNode) => {
            if (node?.resourceUri && !node.isDirectory) {
                vscode.commands.executeCommand('vscode.open', node.resourceUri, vscode.ViewColumn.Beside);
            }
        }),

        vscode.commands.registerCommand('multiRepoWorkspaceExplorer.copy', (node: FileNode) => {
            if (node?.resourceUri) {
                vscode.commands.executeCommand('filesExplorer.copy', node.resourceUri);
            }
        }),

        vscode.commands.registerCommand('multiRepoWorkspaceExplorer.cut', (node: FileNode) => {
            if (node?.resourceUri) {
                vscode.commands.executeCommand('filesExplorer.cut', node.resourceUri);
            }
        }),

        vscode.commands.registerCommand('multiRepoWorkspaceExplorer.paste', async (node: FileNode) => {
            if (!node?.resourceUri) return;
            const targetUri = node.isDirectory ? node.resourceUri : vscode.Uri.joinPath(node.resourceUri, '..');
            await vscode.commands.executeCommand('filesExplorer.paste', targetUri);
            workspaceViewManager.refreshAll();
        }),

        vscode.commands.registerCommand('multiRepoWorkspaceExplorer.findInFolder', (node: FileNode) => {
            if (node?.resourceUri && node.isDirectory) {
                vscode.commands.executeCommand('workbench.action.findInFiles', {
                    filesToInclude: node.resourceUri.fsPath,
                });
            }
        }),

        vscode.commands.registerCommand('multiRepoWorkspaceExplorer.compareWithSelected', (node: FileNode) => {
            if (node?.resourceUri) {
                vscode.commands.executeCommand('selectForCompare', node.resourceUri);
            }
        }),

        vscode.commands.registerCommand('multiRepoWorkspaceExplorer.compareSelected', (node: FileNode) => {
            if (node?.resourceUri) {
                vscode.commands.executeCommand('compareFiles', node.resourceUri);
            }
        })
    );

    // Refresh repo browser when workspace folders change
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            repoBrowserProvider.refresh();
            activeWorkspaceProvider.refresh();
            updateMultiFolderWorkspaceContext();
        })
    );
}

/**
 * Updates the context key for whether we're in a multi-folder workspace.
 * This is used to show/hide UI elements based on workspace state.
 */
function updateMultiFolderWorkspaceContext(): void {
    const folderCount = vscode.workspace.workspaceFolders?.length ?? 0;
    vscode.commands.executeCommand('setContext', 'multiRepoWorkspaceExplorer.isMultiFolderWorkspace', folderCount > 1);
}

class ActiveWorkspaceProvider implements vscode.TreeDataProvider<ActiveWorkspaceRepoNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<ActiveWorkspaceRepoNode | undefined> = new vscode.EventEmitter<
        ActiveWorkspaceRepoNode | undefined
    >();
    readonly onDidChangeTreeData: vscode.Event<ActiveWorkspaceRepoNode | undefined> = this._onDidChangeTreeData.event;

    refresh() {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: ActiveWorkspaceRepoNode): vscode.TreeItem {
        return element;
    }

    async getChildren(): Promise<ActiveWorkspaceRepoNode[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
        return workspaceFolders.map((folder) => {
            const repoName = getRepoName(folder.uri.fsPath);
            return new ActiveWorkspaceRepoNode(repoName, folder.uri.fsPath);
        });
    }
}

class ActiveWorkspaceRepoNode extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly repoPath: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('repo', new vscode.ThemeColor('charts.green'));
        this.contextValue = 'activeWorkspaceRepo';
        this.tooltip = repoPath;
    }
}

class WorkspaceViewManager {
    private viewPool: Map<string, { view: vscode.TreeView<FileNode>; provider: FolderTreeDataProvider }> = new Map();
    private disposables: vscode.Disposable[] = [];
    private folderPathToViewId: Map<string, string> = new Map();
    private availableViewIds = [
        'multiRepoExplorer0',
        'multiRepoExplorer1',
        'multiRepoExplorer2',
        'multiRepoExplorer3',
        'multiRepoExplorer4',
        'multiRepoExplorer5',
        'multiRepoExplorer6',
        'multiRepoExplorer7',
        'multiRepoExplorer8',
        'multiRepoExplorer9',
    ];

    refreshAll() {
        for (const { provider } of this.viewPool.values()) {
            provider.refresh();
        }
    }

    getSelectedItem(): FileNode | undefined {
        for (const { view } of this.viewPool.values()) {
            if (view.selection && view.selection.length > 0) {
                return view.selection[0];
            }
        }
        return undefined;
    }

    constructor() {
        // Pre-create all view pools
        for (const viewId of this.availableViewIds) {
            const provider = new FolderTreeDataProvider(null);
            const view = vscode.window.createTreeView(viewId, {
                treeDataProvider: provider,
                showCollapseAll: true,
                canSelectMany: true,
            });
            view.title = '';
            view.description = 'No folder assigned';
            this.viewPool.set(viewId, { view, provider });
            this.disposables.push(view);

            // Set initial context key to false
            const viewIndex = viewId.replace('multiRepoExplorer', '');
            vscode.commands.executeCommand(
                'setContext',
                `multiRepoWorkspaceExplorer.view${viewIndex}.hasFolder`,
                false
            );
        }

        // Initialize views for current workspace folders
        // Use setTimeout to ensure context keys are set after extension activation completes
        setTimeout(() => {
            this.updateViews();
        }, 100);

        // Listen for workspace folder changes
        this.disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                this.updateViews();
            })
        );
    }

    updateViews() {
        const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
        const currentFolderPaths = new Set(workspaceFolders.map((f) => f.uri.fsPath));

        // Find folders that were removed and free their view IDs
        for (const [folderPath, viewId] of this.folderPathToViewId.entries()) {
            if (!currentFolderPaths.has(folderPath)) {
                const poolItem = this.viewPool.get(viewId);
                if (poolItem) {
                    poolItem.view.title = '';
                    poolItem.view.description = 'No folder assigned';
                    poolItem.provider.updateFolder(null);

                    // Update context key
                    const viewIndex = viewId.replace('multiRepoExplorer', '');
                    vscode.commands.executeCommand(
                        'setContext',
                        `multiRepoWorkspaceExplorer.view${viewIndex}.hasFolder`,
                        false
                    );
                }
                this.folderPathToViewId.delete(folderPath);
            }
        }

        // Assign views to workspace folders
        for (const folder of workspaceFolders) {
            const folderPath = folder.uri.fsPath;
            let viewId = this.folderPathToViewId.get(folderPath);

            if (!viewId) {
                // Find an available view ID
                viewId = this.availableViewIds.find((id) => !Array.from(this.folderPathToViewId.values()).includes(id));
                if (!viewId) {
                    continue; // No more views available
                }
                this.folderPathToViewId.set(folderPath, viewId);
            }

            // Update the view with folder information
            const poolItem = this.viewPool.get(viewId);
            if (poolItem) {
                const repoName = getRepoName(folder.uri.fsPath);
                poolItem.view.title = repoName;
                poolItem.view.description = undefined;
                poolItem.provider.updateFolder(folder);

                // Update context key
                const viewIndex = viewId.replace('multiRepoExplorer', '');
                vscode.commands.executeCommand(
                    'setContext',
                    `multiRepoWorkspaceExplorer.view${viewIndex}.hasFolder`,
                    true
                );
            }
        }
    }

    dispose() {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.viewPool.clear();
        this.folderPathToViewId.clear();
    }
}

// Scan configured paths for git repositories (one level deep)
function scanForGitRepos(basePath: string): Map<string, string[]> {
    const repos = new Map<string, string[]>();
    const expandedPath = basePath.replace(/^~/, require('node:os').homedir());

    if (!fs.existsSync(expandedPath)) {
        return repos;
    }

    try {
        const entries = fs.readdirSync(expandedPath, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }

            const entryPath = path.join(expandedPath, entry.name);
            const gitPath = path.join(entryPath, '.git');

            // Check if this directory is a git repo
            if (fs.existsSync(gitPath)) {
                if (!repos.has('.')) {
                    repos.set('.', []);
                }
                repos.get('.')?.push(entryPath);
            } else {
                // Check one level deeper for git repos
                try {
                    const subEntries = fs.readdirSync(entryPath, { withFileTypes: true });
                    const reposInFolder: string[] = [];

                    for (const subEntry of subEntries) {
                        if (!subEntry.isDirectory()) {
                            continue;
                        }

                        const subEntryPath = path.join(entryPath, subEntry.name);
                        const subGitPath = path.join(subEntryPath, '.git');

                        if (fs.existsSync(subGitPath)) {
                            reposInFolder.push(subEntryPath);
                        }
                    }

                    if (reposInFolder.length > 0) {
                        repos.set(entry.name, reposInFolder);
                    }
                } catch {
                    // Skip directories we can't read
                }
            }
        }
    } catch {
        // Skip paths we can't read
    }

    return repos;
}

class RepoBrowserProvider implements vscode.TreeDataProvider<FolderNode | RepoNode | EmptyStateNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<FolderNode | RepoNode | EmptyStateNode | undefined | undefined> =
        new vscode.EventEmitter<FolderNode | RepoNode | EmptyStateNode | undefined | undefined>();
    readonly onDidChangeTreeData: vscode.Event<FolderNode | RepoNode | EmptyStateNode | undefined | undefined> =
        this._onDidChangeTreeData.event;

    private expandedFolders: Set<string>;
    private readonly STORAGE_KEY = 'multiRepoWorkspaceExplorer.expandedFolders';

    constructor(private context: vscode.ExtensionContext) {
        // Load expanded state from workspace state
        const savedState = context.workspaceState.get<string[]>(this.STORAGE_KEY, []);
        this.expandedFolders = new Set(savedState);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: FolderNode | RepoNode | EmptyStateNode): vscode.TreeItem {
        // Restore collapsed state for folders
        if (element instanceof FolderNode) {
            const isExpanded = this.expandedFolders.has(element.label);
            element.collapsibleState = isExpanded
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.Collapsed;
        }
        return element;
    }

    async onDidExpandElement(element: FolderNode): Promise<void> {
        if (element instanceof FolderNode) {
            this.expandedFolders.add(element.label);
            await this.saveState();
        }
    }

    async onDidCollapseElement(element: FolderNode): Promise<void> {
        if (element instanceof FolderNode) {
            this.expandedFolders.delete(element.label);
            await this.saveState();
        }
    }

    private async saveState(): Promise<void> {
        await this.context.workspaceState.update(this.STORAGE_KEY, Array.from(this.expandedFolders));
    }

    async getChildren(
        element?: FolderNode | RepoNode | EmptyStateNode
    ): Promise<(FolderNode | RepoNode | EmptyStateNode)[]> {
        if (!element) {
            // Top level: scan configured paths
            const config = vscode.workspace.getConfiguration('multiRepoWorkspaceExplorer');
            const repoPaths: string[] = config.get('repoPaths', []);

            if (repoPaths.length === 0) {
                return [new EmptyStateNode()];
            }

            const allRepos = new Map<string, string[]>();

            for (const basePath of repoPaths) {
                const repos = scanForGitRepos(basePath);
                repos.forEach((paths, folder) => {
                    if (!allRepos.has(folder)) {
                        allRepos.set(folder, []);
                    }
                    allRepos.get(folder)?.push(...paths);
                });
            }

            const nodes: (FolderNode | RepoNode)[] = [];

            for (const [folderName, repoPaths] of allRepos.entries()) {
                if (folderName === '.') {
                    // Repos directly in the base path
                    nodes.push(...repoPaths.map((p) => new RepoNode(path.basename(p), p, this.isInWorkspace(p))));
                } else {
                    // Repos in a subfolder
                    nodes.push(new FolderNode(folderName, repoPaths));
                }
            }

            return nodes;
        }

        if (element instanceof FolderNode) {
            return element.repoPaths.map((p) => new RepoNode(path.basename(p), p, this.isInWorkspace(p)));
        }

        return [];
    }

    private isInWorkspace(repoPath: string): boolean {
        return vscode.workspace.workspaceFolders?.some((f) => f.uri.fsPath === repoPath) ?? false;
    }
}

class FolderNode extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly repoPaths: string[]
    ) {
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.iconPath = new vscode.ThemeIcon('folder');
        this.contextValue = 'folder';
        this.description = `${repoPaths.length} repos`;
    }
}

class EmptyStateNode extends vscode.TreeItem {
    constructor() {
        super('No repository paths configured', vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('info');
        this.tooltip = 'Add paths to multiRepoWorkspaceExplorer.repoPaths in settings to scan for repositories';
        this.description = 'Click to open settings';
        this.command = {
            command: 'workbench.action.openSettings',
            title: 'Open Settings',
            arguments: ['multiRepoWorkspaceExplorer.repoPaths'],
        };
    }
}

class RepoNode extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly repoPath: string,
        public readonly isActive: boolean
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon(
            isActive ? 'repo' : 'repo',
            isActive ? new vscode.ThemeColor('charts.green') : undefined
        );
        this.contextValue = isActive ? 'activeRepo' : 'gitRepo';
        this.description = isActive ? '✓ In workspace' : '';
        this.tooltip = repoPath;
    }
}

// Favorites management
interface FavoriteRepo {
    name: string;
    path: string;
}

interface FavoriteGroup {
    name: string;
    repos: FavoriteRepo[];
}

interface FavoritesState {
    ungrouped: FavoriteRepo[];
    groups: FavoriteGroup[];
}

class FavoritesProvider
    implements
        vscode.TreeDataProvider<GroupNode | FavoriteRepoNode>,
        vscode.TreeDragAndDropController<GroupNode | FavoriteRepoNode>
{
    private _onDidChangeTreeData: vscode.EventEmitter<GroupNode | FavoriteRepoNode | undefined> =
        new vscode.EventEmitter<GroupNode | FavoriteRepoNode | undefined>();
    readonly onDidChangeTreeData: vscode.Event<GroupNode | FavoriteRepoNode | undefined> =
        this._onDidChangeTreeData.event;

    private readonly storageKey = 'multiRepoWorkspaceExplorer.favorites';

    // Drag and drop support
    dropMimeTypes = ['application/vnd.code.tree.favoriteRepos', 'application/vnd.code.tree.favoriteGroups'];
    dragMimeTypes = ['application/vnd.code.tree.favoriteRepos', 'application/vnd.code.tree.favoriteGroups'];

    constructor(private context: vscode.ExtensionContext) {}

    refresh() {
        this._onDidChangeTreeData.fire(undefined);
    }

    private async getState(): Promise<FavoritesState> {
        const state: FavoritesState = this.context.globalState.get(this.storageKey, { ungrouped: [], groups: [] });

        // Clean up any invalid entries (repos without path property)
        state.ungrouped = state.ungrouped.filter((r: FavoriteRepo) => r?.path && r?.name);
        for (const group of state.groups) {
            group.repos = group.repos.filter((r: FavoriteRepo) => r?.path && r?.name);
        }

        return state;
    }

    private async setState(state: FavoritesState): Promise<void> {
        await this.context.globalState.update(this.storageKey, state);
        this.refresh();
    }

    async addRepoToFavorites(repoPath: string, repoName: string): Promise<void> {
        const state = await this.getState();

        // Check if already exists in ungrouped
        if (state.ungrouped.some((r) => r.path === repoPath)) {
            vscode.window.showWarningMessage('Repository is already in ungrouped favorites');
            return;
        }

        state.ungrouped.push({ name: repoName, path: repoPath });
        await this.setState(state);
    }

    async removeRepoFromFavorites(repoPath: string, groupName: string | null): Promise<void> {
        const state = await this.getState();

        if (groupName === null) {
            // Remove from ungrouped - only remove first instance
            const index = state.ungrouped.findIndex((r) => r.path === repoPath);
            if (index !== -1) {
                state.ungrouped.splice(index, 1);
            }
        } else {
            // Remove from specific group - only remove first instance
            const group = state.groups.find((g) => g.name === groupName);
            if (group) {
                const index = group.repos.findIndex((r) => r.path === repoPath);
                if (index !== -1) {
                    group.repos.splice(index, 1);
                }
            }
        }

        await this.setState(state);
    }

    async cleanupInvalidEntries(): Promise<void> {
        const state = await this.getState();
        // The getState already filters invalid entries, so just save it back
        await this.setState(state);
    }

    async createGroup(groupName: string): Promise<void> {
        const state = await this.getState();

        if (state.groups.some((g) => g.name === groupName)) {
            vscode.window.showWarningMessage('Group already exists');
            return;
        }

        state.groups.push({ name: groupName, repos: [] });
        await this.setState(state);
    }

    async deleteGroup(groupName: string): Promise<void> {
        const state = await this.getState();

        // Simply remove the group (repos are deleted with it)
        state.groups = state.groups.filter((g) => g.name !== groupName);
        await this.setState(state);
    }

    async renameGroup(oldName: string, newName: string): Promise<void> {
        const state = await this.getState();

        const group = state.groups.find((g) => g.name === oldName);
        if (group) {
            group.name = newName;
            await this.setState(state);
        }
    }

    async getGroups(): Promise<string[]> {
        const state = await this.getState();
        return state.groups.map((g) => g.name);
    }

    async moveRepoToGroup(repoPath: string, repoName: string, groupName: string | null): Promise<void> {
        const state = await this.getState();

        // Remove from current location
        state.ungrouped = state.ungrouped.filter((r) => r.path !== repoPath);
        for (const group of state.groups) {
            group.repos = group.repos.filter((r) => r.path !== repoPath);
        }

        // Add to new location
        if (groupName == null) {
            state.ungrouped.push({ name: repoName, path: repoPath });
        } else {
            const group = state.groups.find((g) => g.name === groupName);
            if (group) {
                group.repos.push({ name: repoName, path: repoPath });
            }
        }

        await this.setState(state);
    }

    async addRepoToGroup(repoPath: string, repoName: string, groupName: string): Promise<void> {
        const state = await this.getState();

        const group = state.groups.find((g) => g.name === groupName);
        if (group) {
            // Check if repo already exists in this specific group
            if (group.repos.some((r) => r.path === repoPath)) {
                vscode.window.showWarningMessage(`Repository is already in ${groupName}`);
                return;
            }

            group.repos.push({ name: repoName, path: repoPath });
            await this.setState(state);
        }
    }

    // Drag and drop implementation
    async handleDrag(
        source: (GroupNode | FavoriteRepoNode)[],
        dataTransfer: vscode.DataTransfer,
        _token: vscode.CancellationToken
    ): Promise<void> {
        const repoNodes = source.filter((item) => item instanceof FavoriteRepoNode) as FavoriteRepoNode[];
        const groupNodes = source.filter((item) => item instanceof GroupNode) as GroupNode[];

        if (repoNodes.length > 0) {
            const data = repoNodes.map((node) => ({
                name: node.label,
                path: node.repoPath,
            }));
            dataTransfer.set('application/vnd.code.tree.favoriteRepos', new vscode.DataTransferItem(data));
        }

        if (groupNodes.length > 0) {
            const data = groupNodes.map((node) => node.groupName);
            dataTransfer.set('application/vnd.code.tree.favoriteGroups', new vscode.DataTransferItem(data));
        }
    }

    async handleDrop(
        target: GroupNode | FavoriteRepoNode | undefined,
        dataTransfer: vscode.DataTransfer,
        _token: vscode.CancellationToken
    ): Promise<void> {
        const reposTransfer = dataTransfer.get('application/vnd.code.tree.favoriteRepos');
        const groupsTransfer = dataTransfer.get('application/vnd.code.tree.favoriteGroups');

        // Handle group reordering
        if (groupsTransfer) {
            const groupNames = groupsTransfer.value as string[];
            const state = await this.getState();

            // Only allow dropping at root level or on another group (for reordering)
            let targetIndex = 0;
            if (target instanceof GroupNode) {
                targetIndex = state.groups.findIndex((g) => g.name === target.groupName);
                if (targetIndex === -1) targetIndex = 0;
            } else if (target instanceof FavoriteRepoNode) {
                // Don't allow dropping groups on repos
                return;
            }

            // Remove the dragged groups and reinsert at target position
            const movedGroups = state.groups.filter((g) => groupNames.includes(g.name));
            state.groups = state.groups.filter((g) => !groupNames.includes(g.name));
            state.groups.splice(targetIndex, 0, ...movedGroups);

            await this.setState(state);
            return;
        }

        // Handle repo movement
        if (reposTransfer) {
            const repos = reposTransfer.value as { name: string; path: string }[];

            // Don't allow dropping onto root or into positions that would create invalid structures
            let targetGroup: string | null = null;
            if (target instanceof GroupNode) {
                targetGroup = target.groupName;
            } else if (target instanceof FavoriteRepoNode) {
                // Find which group this repo belongs to
                const state = await this.getState();
                for (const group of state.groups) {
                    if (group.repos.some((r) => r.path === target.repoPath)) {
                        targetGroup = group.name;
                        break;
                    }
                }
            }
            // If target is undefined, drop to ungrouped (targetGroup stays null)

            // Move all repos to target group
            for (const repo of repos) {
                await this.moveRepoToGroup(repo.path, repo.name, targetGroup);
            }
        }
    }

    getTreeItem(element: GroupNode | FavoriteRepoNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: GroupNode | FavoriteRepoNode): Promise<(GroupNode | FavoriteRepoNode)[]> {
        if (!element) {
            // Root level: show groups and ungrouped repos
            const state = await this.getState();
            const items: (GroupNode | FavoriteRepoNode)[] = [];

            // Add groups
            for (const group of state.groups) {
                items.push(new GroupNode(group.name, group.repos));
            }

            // Add ungrouped repos
            for (const repo of state.ungrouped) {
                items.push(new FavoriteRepoNode(repo.name, repo.path, null));
            }

            return items;
        }

        if (element instanceof GroupNode) {
            // Show repos in group
            return element.repos.map((repo) => new FavoriteRepoNode(repo.name, repo.path, element.groupName));
        }

        return [];
    }
}

class GroupNode extends vscode.TreeItem {
    constructor(
        public readonly groupName: string,
        public readonly repos: FavoriteRepo[]
    ) {
        super(groupName, vscode.TreeItemCollapsibleState.Collapsed);
        this.iconPath = new vscode.ThemeIcon('folder');
        this.contextValue = 'group';
        this.description = `${repos.length} repos`;
    }
}

class FavoriteRepoNode extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly repoPath: string,
        public readonly groupName: string | null = null
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.iconPath =
            groupName !== null
                ? new vscode.ThemeIcon('repo')
                : new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow'));
        this.contextValue = 'favoriteRepo';
        this.tooltip = repoPath;
    }
}

function getRepoName(folderPath: string): string {
    try {
        const _gitPath = path.join(folderPath, '.git');
        const remote = execSync('git remote get-url origin', {
            cwd: folderPath,
            encoding: 'utf8',
        }).trim();

        // Extract repo name from git remote URL
        const match = remote.match(/([^/]+?)(?:\.git)?$/);
        return match ? match[1] : path.basename(folderPath);
    } catch {
        return path.basename(folderPath);
    }
}

class FolderTreeDataProvider implements vscode.TreeDataProvider<FileNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<FileNode | undefined | undefined> = new vscode.EventEmitter<
        FileNode | undefined | undefined
    >();
    readonly onDidChangeTreeData: vscode.Event<FileNode | undefined | undefined> = this._onDidChangeTreeData.event;

    constructor(private folder: vscode.WorkspaceFolder | null) {}

    updateFolder(folder: vscode.WorkspaceFolder | null) {
        this.folder = folder;
        this._onDidChangeTreeData.fire(undefined);
    }

    refresh() {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: FileNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: FileNode): Promise<FileNode[]> {
        if (!this.folder) {
            return [];
        }

        if (!element) {
            // Root level: show files/folders in workspace folder
            const files = await vscode.workspace.fs.readDirectory(this.folder.uri);
            const folderUri = this.folder.uri;
            return files
                .map(
                    ([name, type]) =>
                        new FileNode(name, vscode.Uri.joinPath(folderUri, name), type === vscode.FileType.Directory)
                )
                .sort((a, b) => {
                    // Folders first, then files
                    if (a.isDirectory && !b.isDirectory) return -1;
                    if (!a.isDirectory && b.isDirectory) return 1;
                    return a.label.localeCompare(b.label);
                });
        }

        if (element.isDirectory) {
            const files = await vscode.workspace.fs.readDirectory(element.uri);
            return files
                .map(
                    ([name, type]) =>
                        new FileNode(name, vscode.Uri.joinPath(element.uri, name), type === vscode.FileType.Directory)
                )
                .sort((a, b) => {
                    // Folders first, then files
                    if (a.isDirectory && !b.isDirectory) return -1;
                    if (!a.isDirectory && b.isDirectory) return 1;
                    return a.label.localeCompare(b.label);
                });
        }

        return [];
    }
}

class FileNode extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly uri: vscode.Uri,
        public readonly isDirectory: boolean
    ) {
        super(label, isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        this.resourceUri = uri;

        // Set context values to enable VS Code's built-in file operations
        this.contextValue = isDirectory ? 'folder' : 'file';

        // Use theme icons
        if (isDirectory) {
            this.iconPath = vscode.ThemeIcon.Folder;
        } else {
            this.iconPath = vscode.ThemeIcon.File;
        }

        // Open file on click
        this.command = !isDirectory
            ? {
                  command: 'vscode.open',
                  title: 'Open File',
                  arguments: [uri],
              }
            : undefined;
    }
}

export function deactivate() {}
