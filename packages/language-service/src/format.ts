// ═════════════════════════════════════════════════════════════════════════════
// Formatting
// ═════════════════════════════════════════════════════════════════════════════
//
// The printer in `@axis-dsl/syntax` is the formatter (spec §10); this is its
// editor-facing half - an editor's options in, text edits out.
//
// A range is formatted a whole top-level statement at a time: every statement
// the range's lines touch, and so every line those statements cover. The text
// they span is a file of its own - top-level statements and the comments
// between them - so it goes through `format` like any other, comments and all,
// and a syntax error anywhere else in the document does not stop it.

import { format, parse, type PrintOptions } from '@axis-dsl/syntax';
import { linesOf, spanToRange, type Range, type TextEdit } from './document';

export interface FormattingOptions {
    /** Spaces to an indentation level, when indenting with spaces. 4 by default. */
    tabSize?: number;
    /** Indent with spaces rather than a tab. True by default. */
    insertSpaces?: boolean;
    /** The column a long line is broken at; `0` never breaks one. 100 by default. */
    maxLineLength?: number;
}

function printOptions(options: FormattingOptions): PrintOptions {
    return {
        indent: options.insertSpaces === false ? '\t' : (options.tabSize ?? 4),
        maxLineLength: options.maxLineLength,
    };
}

/** The document, formatted. Returned as it was when it has a syntax error. */
export function formatSource(source: string, options: FormattingOptions = {}): string {
    return format(source, printOptions(options));
}

/** The edits that format the whole document: one replacing all of it, or none. */
export function formatDocument(source: string, options: FormattingOptions = {}): TextEdit[] {
    const formatted = formatSource(source, options);
    if (formatted === source) return [];
    const tree = parse(source);
    return [{ range: spanToRange(tree, { start: 0, end: source.length }), newText: formatted }];
}

/**
 * The edits that format the top-level statements a range touches, or none
 * when they are formatted already, are not well formed, or there are none.
 */
export function formatRange(
    source: string,
    range: Range,
    options: FormattingOptions = {},
): TextEdit[] {
    const tree = parse(source);
    const lines = linesOf(tree);

    // A selection ending at the start of a line has not selected that line.
    let first = range.start.line;
    let last =
        range.end.line > range.start.line && range.end.character === 0
            ? range.end.line - 1
            : range.end.line;

    // Widen to every statement the lines touch, until nothing more is touched:
    // two statements can share a line, and a statement can run over several.
    const statements = tree.file.statements.map(statement => ({
        from: lines.positionAt(statement.span.start).line,
        to: lines.positionAt(statement.span.end).line,
    }));
    let touched = false;
    for (let changed = true; changed;) {
        changed = false;
        for (const { from, to } of statements) {
            if (from > last || to < first) continue;
            touched = true;
            if (from < first) ((first = from), (changed = true));
            if (to > last) ((last = to), (changed = true));
        }
    }
    if (!touched) return [];

    const start = lines.lineStarts[first];
    let end = last + 1 < lines.lineCount ? lines.lineStarts[last + 1] - 1 : source.length;
    if (source[end - 1] === '\r') end--;

    const text = source.slice(start, end);
    const formatted = format(text, printOptions(options));
    if (formatted === text) return [];
    return [{ range: spanToRange(tree, { start, end }), newText: formatted }];
}
