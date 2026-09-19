// ═════════════════════════════════════════════════════════════════════════════
// Platform-neutral language service types
// ═════════════════════════════════════════════════════════════════════════════
//
// Nothing in `core/` may import an editor SDK. VSCode and Monaco each get a thin
// adapter package that maps these shapes onto their own APIs, so the actual
// language behaviour is written once.

/** Editor-agnostic completion category. Adapters map these to their own enums. */
export type AxisCompletionKind =
    'function' | 'constant' | 'keyword' | 'property' | 'variable' | 'file' | 'folder';

export interface AxisCompletionItem {
    label: string;
    kind: AxisCompletionKind;
    detail: string;
    /**
     * TextMate snippet body (`${1:x}`, `${1|a,b|}`, `$0`) inserted instead of
     * the label. Both VSCode and Monaco speak this dialect natively.
     */
    snippet?: string;
}

export interface AxisPosition {
    /** Zero-based. */
    line: number;
    /** Zero-based offset within the line. */
    character: number;
}

export interface AxisFormattingOptions {
    tabSize: number;
    insertSpaces: boolean;
    /**
     * Column the formatter breaks a long line at, counting its indentation.
     * `0` never breaks a line; left out, the formatter picks its own default.
     */
    maxLineLength?: number;
}

/**
 * A line of a script, and the lines of the file it came from.
 *
 * The layout passes a script goes through before it is compiled -
 * {@link foldMetadataBlocks}, {@link joinContinuedLines},
 * {@link expandBlockEntries} - merge lines together and split them apart, so by
 * the time the compiler sees a statement there is nothing left in it saying
 * where it was written. Threading this through those passes is what lets a
 * compiled expression be traced back to the text that produced it, which is
 * what writing a change to a graph back into its source needs.
 *
 * The span is inclusive at both ends and zero-based, and a statement written on
 * one line has `line === endLine`. Several statements can share a span: a block
 * written inline is one line holding all of them.
 */
export interface SourceLine {
    text: string;
    /** Zero-based index of the first line of the file this came from. */
    line: number;
    /** Zero-based index of its last line, inclusive. */
    endLine: number;
}
