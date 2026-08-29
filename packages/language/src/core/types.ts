// ═════════════════════════════════════════════════════════════════════════════
// Platform-neutral language service types
// ═════════════════════════════════════════════════════════════════════════════
//
// Nothing in `core/` may import an editor SDK. VSCode and Monaco each get a thin
// adapter package that maps these shapes onto their own APIs, so the actual
// language behaviour is written once.

/** Editor-agnostic completion category. Adapters map these to their own enums. */
export type AxisCompletionKind = 'function' | 'constant' | 'keyword' | 'property' | 'variable';

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
