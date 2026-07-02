import * as path from 'node:path';
import * as vscode from 'vscode';

type FileItem = vscode.QuickPickItem & { readonly uri: vscode.Uri };

export function activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(vscode.commands.registerCommand('diff.file', diffActiveFile));
}

/**
 * Diffs the active editor against another file picked from a quick pick.
 *
 * Candidates come from three sources: open untitled buffers, other open files,
 * and files found in the workspace. The active file and any open files are
 * compared via their live document URIs, so unsaved edits (dirty buffers and
 * never-saved untitled files) are diffed as-is — no temp-file snapshots.
 */
async function diffActiveFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
        vscode.window.showErrorMessage('Open a file in the editor to diff it against another file.');
        return;
    }

    const target = editor.document.uri;
    const targetKey = target.toString();

    const config = vscode.workspace.getConfiguration('diff');
    const showOpenFiles = config.get<boolean>('showOpenFiles', true);
    const showUntitledFiles = config.get<boolean>('showUntitledFiles', true);
    const showFoundFiles = config.get<boolean>('showFoundFiles', true);
    const include = config.get<string>('include', '**/*') || '**/*';
    const exclude = config.get<string>('exclude', '');

    const openUris = getOpenTextUris().filter((uri) => uri.toString() !== targetKey);
    const untitledUris = showUntitledFiles ? openUris.filter((uri) => uri.scheme === 'untitled') : [];
    const openFileUris = showOpenFiles ? openUris.filter((uri) => uri.scheme !== 'untitled') : [];

    const openFileKeys = new Set(openFileUris.map((uri) => uri.toString()));
    const found = showFoundFiles ? await vscode.workspace.findFiles(include, exclude || undefined) : [];
    const foundUris = found.filter((uri) => uri.toString() !== targetKey && !openFileKeys.has(uri.toString()));

    const items = buildItems(untitledUris, openFileUris, foundUris);

    if (items.length === 0) {
        vscode.window.showErrorMessage('No other files found to diff against.');
        return;
    }

    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a file to diff against…',
        matchOnDescription: true,
    });

    if (!picked || !('uri' in picked)) return;

    await vscode.commands.executeCommand('vscode.diff', target, picked.uri, diffTitle(target, picked.uri));
}

/** Builds the quick-pick entries, grouped under section separators. */
function buildItems(
    untitledUris: vscode.Uri[],
    openFileUris: vscode.Uri[],
    foundUris: vscode.Uri[]
): Array<FileItem | vscode.QuickPickItem> {
    const items: Array<FileItem | vscode.QuickPickItem> = [];

    if (untitledUris.length > 0) {
        items.push({ label: 'untitled', kind: vscode.QuickPickItemKind.Separator });
        for (const uri of sortUris(untitledUris)) {
            items.push({ label: path.basename(uri.path), uri });
        }
    }

    if (openFileUris.length > 0) {
        items.push({ label: 'open', kind: vscode.QuickPickItemKind.Separator });
        for (const uri of sortUris(openFileUris)) {
            items.push({ label: vscode.workspace.asRelativePath(uri), uri });
        }
    }

    if (foundUris.length > 0) {
        items.push({ label: 'workspace', kind: vscode.QuickPickItemKind.Separator });
        for (const uri of sortUris(foundUris)) {
            items.push({ label: vscode.workspace.asRelativePath(uri), uri });
        }
    }

    return items;
}

/** Collects the URIs of every open text tab, de-duplicated across tab groups. */
function getOpenTextUris(): vscode.Uri[] {
    const seen = new Set<string>();
    const uris: vscode.Uri[] = [];

    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            const input = tab.input;
            if (!(input instanceof vscode.TabInputText)) continue;

            const key = input.uri.toString();
            if (seen.has(key)) continue;

            seen.add(key);
            uris.push(input.uri);
        }
    }

    return uris;
}

/** Sorts shallower paths first, then alphabetically — mirrors the original extension. */
function sortUris(uris: vscode.Uri[]): vscode.Uri[] {
    return [...uris].sort((a, b) => fileDepth(a.path) - fileDepth(b.path) || a.path.localeCompare(b.path));
}

function fileDepth(filePath: string): number {
    return filePath.split(/[\\/]/g).length;
}

/** Builds a readable diff-editor title, disambiguating with paths when names collide. */
function diffTitle(left: vscode.Uri, right: vscode.Uri): string {
    const leftName = path.basename(left.path);
    const rightName = path.basename(right.path);

    if (leftName !== rightName) return `${leftName} ↔ ${rightName}`;

    const leftPath = vscode.workspace.asRelativePath(left);
    const rightPath = vscode.workspace.asRelativePath(right);
    return `${leftName} (${leftPath}) ↔ ${rightName} (${rightPath})`;
}
