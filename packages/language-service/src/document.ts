// ═════════════════════════════════════════════════════════════════════════════
// Documents, positions and ranges
// ═════════════════════════════════════════════════════════════════════════════
//
// Every service takes either a `SyntaxTree` or the source it would be parsed
// from, and speaks to its caller in lines and characters - zero-based, UTF-16,
// exactly as `lineIndex` in `@axis-dsl/syntax` counts them, which is what the
// Language Server Protocol and Monaco count by default. Inside, everything is
// offsets, because that is what the tree carries.
//
// A host that asks several questions of one version of a document should parse
// it once and hand the tree to each: the line index, and the symbol analysis
// in `symbols.ts`, are both cached against the tree object.

import { lineIndex, parse, type LineIndex, type Position, type Span } from '@axis-dsl/syntax';
import type { SyntaxTree } from '@axis-dsl/syntax';

export type { Position };

/** A range of a document, `end` exclusive, as an editor addresses one. */
export interface Range {
    start: Position;
    end: Position;
}

/** A replacement of the text a range covers. */
export interface TextEdit {
    range: Range;
    newText: string;
}

/** What every service accepts: a tree already parsed, or the source to parse. */
export type DocumentInput = SyntaxTree | string;

export function toTree(input: DocumentInput): SyntaxTree {
    return typeof input === 'string' ? parse(input) : input;
}

const indexes = new WeakMap<SyntaxTree, LineIndex>();

/** The tree's line index, built once. */
export function linesOf(tree: SyntaxTree): LineIndex {
    let index = indexes.get(tree);
    if (!index) {
        index = lineIndex(tree.source);
        indexes.set(tree, index);
    }
    return index;
}

export function spanToRange(tree: SyntaxTree, span: Span): Range {
    const lines = linesOf(tree);
    return { start: lines.positionAt(span.start), end: lines.positionAt(span.end) };
}

export function rangeToSpan(tree: SyntaxTree, range: Range): Span {
    const lines = linesOf(tree);
    return { start: lines.offsetAt(range.start), end: lines.offsetAt(range.end) };
}

export function offsetAt(tree: SyntaxTree, position: Position): number {
    return linesOf(tree).offsetAt(position);
}

/** Whether an offset falls within a span, its end included - a cursor just past a word is on it. */
export const touches = (span: Span, offset: number): boolean =>
    span.start <= offset && offset <= span.end;

/** Whether two spans share any character, or meet at a point. */
export const overlaps = (a: Span, b: Span): boolean => a.start <= b.end && b.start <= a.end;
