import * as vscode from 'vscode';
import { changedLines, untrackedFiles } from './git';
import type { FileNode } from './tree';

const ADDED = '#3fb950';
const REMOVED = '#f85149';
const LOCAL = '#4c9aff';

function stripeIcon(color: string): vscode.Uri {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect x="12" y="0" width="3" height="16" fill="${color}"/></svg>`;
    return vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

function stripeType(color: string): vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
        gutterIconPath: stripeIcon(color),
        gutterIconSize: 'contain',
        isWholeLine: true,
    });
}

function toRanges(ranges: readonly [number, number][]): vscode.Range[] {
    return ranges.map(([start, end]) => new vscode.Range(start - 1, 0, end - 1, 0));
}

type Side = 'left' | 'right';
type Tracked = { readonly node: FileNode; readonly side: Side };

/**
 * Paints changed lines as a thin gutter stripe in the diffs this extension
 * opens: blue on the right for lines that differ from HEAD (always), plus, with
 * `diffStyle: "gutter"`, green/red for the rest of the branch's changes. Line
 * data comes from `git diff -U0`, so unsaved edits are striped only once saved.
 */
export class DiffStripes {
    private readonly added = stripeType(ADDED);
    private readonly removed = stripeType(REMOVED);
    private readonly local = stripeType(LOCAL);
    private readonly tracked = new Map<string, Tracked>();

    dispose(): void {
        this.added.dispose();
        this.removed.dispose();
        this.local.dispose();
    }

    track(left: vscode.Uri, right: vscode.Uri, node: FileNode): void {
        this.tracked.set(left.toString(), { node, side: 'left' });
        this.tracked.set(right.toString(), { node, side: 'right' });
    }

    tracks(uri: vscode.Uri): boolean {
        return this.tracked.has(uri.toString());
    }

    async refresh(): Promise<void> {
        for (const editor of vscode.window.visibleTextEditors) {
            const tracked = this.tracked.get(editor.document.uri.toString());
            if (tracked) await this.decorate(editor, tracked);
        }
    }

    private async decorate(editor: vscode.TextEditor, { node, side }: Tracked): Promise<void> {
        const { file, root, mergeBaseRef } = node;
        const paths = file.oldPath ? [file.oldPath, file.path] : [file.path];
        const gutter = vscode.workspace.getConfiguration('branchPrViewer').get<string>('diffStyle') === 'gutter';
        const branch = gutter ? await changedLines(root, mergeBaseRef, paths) : { added: [], removed: [] };

        if (side === 'left') {
            editor.setDecorations(this.removed, toRanges(branch.removed));
            return;
        }
        if (file.status === 'D') return;

        const { document } = editor;
        const lastLine = document.lineCount - (document.lineAt(document.lineCount - 1).text === '' ? 1 : 0);
        const untracked = (await untrackedFiles(root, [file.path])).length > 0;
        const local: readonly [number, number][] = untracked
            ? [[1, Math.max(lastLine, 1)]]
            : (await changedLines(root, 'HEAD', paths)).added;

        const committed: [number, number][] = [];
        for (const [start, end] of branch.added) {
            let next = start;
            for (const [localStart, localEnd] of local) {
                if (localEnd < next || localStart > end) continue;
                if (localStart > next) committed.push([next, localStart - 1]);
                next = localEnd + 1;
            }
            if (next <= end) committed.push([next, end]);
        }

        editor.setDecorations(this.added, toRanges(committed));
        editor.setDecorations(this.local, toRanges(local));
    }
}
