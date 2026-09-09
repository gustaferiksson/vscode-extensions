import * as vscode from 'vscode';
import { changedLines } from './git';
import type { FileNode } from './tree';

const ADDED = '#3fb950';
const REMOVED = '#f85149';

function stripeIcon(color: string): vscode.Uri {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect x="12" y="0" width="3" height="16" fill="${color}"/></svg>`;
    return vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

function stripeType(color: string): vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
        gutterIconPath: stripeIcon(color),
        gutterIconSize: 'contain',
        overviewRulerColor: color,
        overviewRulerLane: vscode.OverviewRulerLane.Left,
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
 * opens — the alternative to the diff editor's own line backgrounds, which
 * `diffStyle: "gutter"` turns off. Line data comes from `git diff -U0`, so
 * unsaved edits are striped only once the file is saved.
 */
export class DiffStripes {
    private readonly added = stripeType(ADDED);
    private readonly removed = stripeType(REMOVED);
    private readonly tracked = new Map<string, Tracked>();

    dispose(): void {
        this.added.dispose();
        this.removed.dispose();
    }

    track(left: vscode.Uri, right: vscode.Uri, node: FileNode): void {
        this.tracked.set(left.toString(), { node, side: 'left' });
        this.tracked.set(right.toString(), { node, side: 'right' });
    }

    tracks(uri: vscode.Uri): boolean {
        return this.tracked.has(uri.toString());
    }

    async refresh(): Promise<void> {
        const enabled = vscode.workspace.getConfiguration('branchPrViewer').get<string>('diffStyle') === 'gutter';
        for (const editor of vscode.window.visibleTextEditors) {
            const tracked = this.tracked.get(editor.document.uri.toString());
            if (!tracked) continue;
            if (!enabled) {
                this.clear(editor);
                continue;
            }
            await this.decorate(editor, tracked);
        }
    }

    private clear(editor: vscode.TextEditor): void {
        editor.setDecorations(this.added, []);
        editor.setDecorations(this.removed, []);
    }

    private async decorate(editor: vscode.TextEditor, { node, side }: Tracked): Promise<void> {
        const { file, root, mergeBaseRef, right } = node;
        const paths = file.oldPath ? [file.oldPath, file.path] : [file.path];
        const to = right.kind === 'ref' ? right.ref : undefined;
        const lines = await changedLines(root, mergeBaseRef, paths, to);

        editor.setDecorations(this.added, side === 'right' ? toRanges(lines.added) : []);
        editor.setDecorations(this.removed, side === 'left' ? toRanges(lines.removed) : []);
    }
}
