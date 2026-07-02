import * as vscode from 'vscode';
import { type FileStatus, showFile } from './git';

/** Custom scheme backing the read-only left/right sides of every diff. */
export const CONTENT_SCHEME = 'branch-pr-viewer';

const STATUSES: readonly FileStatus[] = ['A', 'M', 'D', 'R', 'C', 'T', 'U'];

type ContentRef = {
    readonly root: string;
    readonly ref: string;
    readonly status?: FileStatus;
};

/**
 * Builds a read-only content URI. The path carries the file name (so the editor
 * picks the right language and tab title); the query carries the repo root and
 * the immutable commit SHA the content is read from — immutability makes VS
 * Code's document cache correct without invalidation.
 */
export function buildContentUri(root: string, ref: string, relPath: string, status?: FileStatus): vscode.Uri {
    return vscode.Uri.from({
        scheme: CONTENT_SCHEME,
        path: `/${relPath}`,
        query: JSON.stringify({ root, ref, status }),
    });
}

/**
 * URI for a directory tree item. Setting it as a collapsible item's `resourceUri`
 * (with no `iconPath`) lets the active file icon theme render the folder icon —
 * including per-name icons like `src` or `test` — matching the Explorer. It has
 * no `ref`, so it serves no content and carries no decoration.
 */
export function buildFolderUri(root: string, relDir: string): vscode.Uri {
    return vscode.Uri.from({
        scheme: CONTENT_SCHEME,
        path: `/${relDir}`,
        query: JSON.stringify({ root }),
    });
}

function asStatus(value: unknown): FileStatus | undefined {
    return STATUSES.find((status) => status === value);
}

function decode(uri: vscode.Uri): ContentRef | null {
    let raw: unknown;
    try {
        raw = JSON.parse(uri.query);
    } catch {
        return null;
    }
    if (typeof raw !== 'object' || raw === null) return null;

    const root = 'root' in raw ? raw.root : undefined;
    const ref = 'ref' in raw ? raw.ref : undefined;
    if (typeof root !== 'string' || typeof ref !== 'string') return null;

    return { root, ref, status: asStatus('status' in raw ? raw.status : undefined) };
}

type Decoration = { readonly badge: string; readonly color: string; readonly tooltip: string };

const DECORATIONS: Record<FileStatus, Decoration> = {
    A: { badge: 'A', color: 'gitDecoration.addedResourceForeground', tooltip: 'Added' },
    M: { badge: 'M', color: 'gitDecoration.modifiedResourceForeground', tooltip: 'Modified' },
    D: { badge: 'D', color: 'gitDecoration.deletedResourceForeground', tooltip: 'Deleted' },
    R: { badge: 'R', color: 'gitDecoration.renamedResourceForeground', tooltip: 'Renamed' },
    C: { badge: 'C', color: 'gitDecoration.renamedResourceForeground', tooltip: 'Copied' },
    T: { badge: 'T', color: 'gitDecoration.modifiedResourceForeground', tooltip: 'Type changed' },
    U: { badge: 'U', color: 'gitDecoration.conflictingResourceForeground', tooltip: 'Unmerged' },
};

/**
 * Serves file content at a ref (`git show`) and the matching A/M/D/R badge for
 * tree items. Both are keyed off the same self-describing content URI.
 */
class BranchPrProvider implements vscode.TextDocumentContentProvider, vscode.FileDecorationProvider {
    provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const decoded = decode(uri);
        if (!decoded) return Promise.resolve('');
        const relPath = uri.path.replace(/^\/+/, '');
        return showFile(decoded.root, decoded.ref, relPath);
    }

    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        if (uri.scheme !== CONTENT_SCHEME) return undefined;
        const status = decode(uri)?.status;
        if (!status) return undefined;

        const { badge, color, tooltip } = DECORATIONS[status];
        return new vscode.FileDecoration(badge, tooltip, new vscode.ThemeColor(color));
    }
}

/** Registers the content and decoration providers; returns their disposables. */
export function registerProviders(): vscode.Disposable[] {
    const provider = new BranchPrProvider();
    return [
        vscode.workspace.registerTextDocumentContentProvider(CONTENT_SCHEME, provider),
        vscode.window.registerFileDecorationProvider(provider),
    ];
}
