// ═════════════════════════════════════════════════════════════════════════════
// Lines and offsets
// ═════════════════════════════════════════════════════════════════════════════
//
// The tree speaks in offsets (`Span`), because an offset is one number that
// every tool agrees on. Editors speak in lines and characters. This is the one
// place the two are converted, so every tool counts lines the same way.
//
// Both are zero-based, and a character is a UTF-16 code unit - which is what
// the Language Server Protocol and Monaco count by default, and what a
// JavaScript string index already is.

/** A zero-based line and character, as an editor addresses a position. */
export interface Position {
    line: number;
    character: number;
}

export interface LineIndex {
    /** How many lines the source has. An empty source has one. */
    readonly lineCount: number;
    /** The offset each line starts at. */
    readonly lineStarts: readonly number[];
    /** The line and character of an offset, clamped into the source. */
    positionAt(offset: number): Position;
    /**
     * The offset of a line and character. A character past the end of its
     * line lands at the end of that line, before its newline; a line past the
     * last lands at the end of the source.
     */
    offsetAt(position: Position): number;
}

export function lineIndex(source: string): LineIndex {
    const lineStarts = [0];
    for (let i = 0; i < source.length; i++) {
        if (source[i] === '\n') lineStarts.push(i + 1);
    }

    const lineEnd = (line: number) =>
        line + 1 < lineStarts.length ? lineStarts[line + 1] - 1 : source.length;

    return {
        lineCount: lineStarts.length,
        lineStarts,

        positionAt(offset) {
            const clamped = Math.max(0, Math.min(offset, source.length));
            // The last line starting at or before the offset.
            let low = 0;
            let high = lineStarts.length - 1;
            while (low < high) {
                const middle = (low + high + 1) >> 1;
                if (lineStarts[middle] <= clamped) low = middle;
                else high = middle - 1;
            }
            return { line: low, character: clamped - lineStarts[low] };
        },

        offsetAt({ line, character }) {
            if (line < 0) return 0;
            if (line >= lineStarts.length) return source.length;
            return Math.min(lineStarts[line] + Math.max(0, character), lineEnd(line));
        },
    };
}
