import * as vscode from 'vscode';

const TRANSPARENT = '#00000000';
const ADDED = '#3fb95080';
const REMOVED = '#f8514980';

const GUTTER_COLORS: Readonly<Record<string, string>> = {
    'diffEditor.insertedTextBackground': TRANSPARENT,
    'diffEditor.removedTextBackground': TRANSPARENT,
    'diffEditor.insertedLineBackground': TRANSPARENT,
    'diffEditor.removedLineBackground': TRANSPARENT,
    'diffEditorGutter.insertedLineBackground': ADDED,
    'diffEditorGutter.removedLineBackground': REMOVED,
};

type Customizations = Record<string, unknown>;

function globalCustomizations(): Customizations {
    const inspected = vscode.workspace.getConfiguration('workbench').inspect<Customizations>('colorCustomizations');
    return { ...(inspected?.globalValue ?? {}) };
}

function withGutterColors(current: Customizations): Customizations {
    return { ...current, ...GUTTER_COLORS };
}

function withoutGutterColors(current: Customizations): Customizations {
    const next = { ...current };
    for (const [key, value] of Object.entries(GUTTER_COLORS)) {
        if (next[key] === value) delete next[key];
    }
    return next;
}

function sameColors(a: Customizations, b: Customizations): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function style(): string {
    return vscode.workspace.getConfiguration('branchPrViewer').get<string>('diffStyle', 'theme');
}

/**
 * Diff highlighting is a workbench colour, not something an editor can be opened
 * with, so `gutter` style is applied by writing the relevant colour IDs into the
 * user's `workbench.colorCustomizations` — which affects every diff editor.
 */
export async function applyDiffStyle(): Promise<void> {
    const current = globalCustomizations();
    const next = style() === 'gutter' ? withGutterColors(current) : withoutGutterColors(current);
    if (sameColors(current, next)) return;

    await vscode.workspace
        .getConfiguration('workbench')
        .update('colorCustomizations', next, vscode.ConfigurationTarget.Global);
}

export async function toggleDiffStyle(): Promise<void> {
    const next = style() === 'gutter' ? 'theme' : 'gutter';
    await vscode.workspace
        .getConfiguration('branchPrViewer')
        .update('diffStyle', next, vscode.ConfigurationTarget.Global);
}
