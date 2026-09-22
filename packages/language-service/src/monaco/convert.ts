// ═════════════════════════════════════════════════════════════════════════════
// Between Monaco and the service
// ═════════════════════════════════════════════════════════════════════════════
//
// Monaco counts lines and columns from 1, the service from 0; both count
// characters in UTF-16 code units, so the conversion is an offset of one and
// nothing more. And every provider wants the tree of the model's current text,
// which is parsed once per version and shared between them - a keystroke asks
// for completions, semantic tokens, highlights and diagnostics all at once.

import type * as monaco from 'monaco-editor/editor';
import { parse, type SyntaxTree } from '@axis-dsl/syntax';
import type { Position, Range } from '../document';

const trees = new WeakMap<monaco.editor.ITextModel, { version: number; tree: SyntaxTree }>();

/** The model's current text, parsed - once per version. */
export function treeOf(model: monaco.editor.ITextModel): SyntaxTree {
    const version = model.getVersionId();
    const cached = trees.get(model);
    if (cached?.version === version) return cached.tree;
    const tree = parse(model.getValue());
    trees.set(model, { version, tree });
    return tree;
}

export const toPosition = (position: monaco.IPosition): Position => ({
    line: position.lineNumber - 1,
    character: position.column - 1,
});

export const toMonacoRange = (range: Range): monaco.IRange => ({
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
});

export const toRange = (range: monaco.IRange): Range => ({
    start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
    end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
});
