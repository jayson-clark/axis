// ═════════════════════════════════════════════════════════════════════════════
// Write-back - a change made to the graph, made to the file
// ═════════════════════════════════════════════════════════════════════════════
//
// Drag a point, move a slider, recolour a curve in the preview, and the
// statement that drew it is rewritten in the editor. The compiler decides what
// to write (`writeBackGraph`); this applies it the way any other edit to a
// document is applied, as a `WorkspaceEdit` - so it lands in the open
// document, marks it dirty, and is undone with ctrl+z like anything typed.

import * as vscode from 'vscode';
import { writeBackGraph, type CompilationResult } from '@axis-dsl/compiler';
import type { GraphReading } from '@axis-dsl/viewer/protocol';

/** A compilation, and the exact text it was compiled from - whose offsets its source map counts. */
export interface Compiled {
    compilation: CompilationResult;
    source: string;
}

/**
 * Write the change between `before` and `after` into the file at `uri`.
 *
 * Only against the text `compiled` came from. The preview compiles what is
 * saved, and the editor holds what is typed: once the two differ, the spans in
 * the compilation's source map point at statements that may have moved, and
 * writing through them would put the change in the wrong place. The change is
 * refused instead, and the next save - which recompiles, and so resets the
 * graph - is where the two agree again.
 *
 * @returns the file's new text when anything was written, for the caller
 *          to recompile the preview from; undefined when nothing was.
 */
export async function writeBack(
    uri: vscode.Uri,
    compiled: Compiled,
    { before, after }: { before: GraphReading; after: GraphReading },
    log: vscode.LogOutputChannel,
): Promise<string | undefined> {
    const document = await vscode.workspace.openTextDocument(uri);
    const name = vscode.workspace.asRelativePath(uri);

    if (document.getText() !== compiled.source) {
        refuse(log, name, ['the file has changed since this graph was compiled - save it']);
        return undefined;
    }

    const path = uri.toString();
    const { edits, skipped } = writeBackGraph(
        compiled.source,
        { before, after },
        compiled.compilation,
        {
            path,
        },
    );
    refuse(
        log,
        name,
        skipped.map(({ reason }) => reason),
    );

    // Only the file itself is edited: an expression an import drew is skipped by
    // the compiler with a reason, so every edit here should be for `path`.
    const mine = edits.filter(edit => edit.path === path);
    if (mine.length === 0) {
        return undefined;
    }

    // Offsets into the text the compilation came from, which the check above
    // says is the document's. A `WorkspaceEdit` applies every range against
    // the document as it was, so the edits' latest-first order does not
    // matter here the way it does to `applySourceEdits`.
    const edit = new vscode.WorkspaceEdit();
    for (const { span, text } of mine) {
        edit.replace(
            uri,
            new vscode.Range(document.positionAt(span.start), document.positionAt(span.end)),
            text,
        );
    }
    if (!(await vscode.workspace.applyEdit(edit, { isRefactoring: false }))) {
        refuse(log, name, ['VSCode did not apply the edit']);
        return undefined;
    }

    log.info(
        `${name}: wrote back ${mine.length} change${mine.length === 1 ? '' : 's'} from the graph`,
    );
    return document.getText();
}

/**
 * Say why a change was not written. Quietly - an output channel line and a
 * status bar message that goes away - because the change the user made is
 * still on the graph, and a dialog for every drag of something that cannot be
 * written back would be worse than the change not landing.
 */
function refuse(log: vscode.LogOutputChannel, name: string, reasons: string[]): void {
    for (const reason of reasons) {
        log.info(`${name}: not written back: ${reason}`);
    }
    if (reasons.length > 0) {
        const more = reasons.length > 1 ? ` (and ${reasons.length - 1} more)` : '';
        vscode.window.setStatusBarMessage(
            `$(info) Axis: not written back - ${reasons[0]}${more}`,
            5_000,
        );
    }
}
