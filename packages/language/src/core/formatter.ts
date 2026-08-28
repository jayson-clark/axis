// ═════════════════════════════════════════════════════════════════════════════
// Formatter - editor-agnostic
// ═════════════════════════════════════════════════════════════════════════════

import { insertMissingSeparators } from './blocks';
import { bracketDelta, leadingClosers } from './brackets';
import { splitTrailingMetadata } from './metadata';
import { AxisFormattingOptions } from './types';

/**
 * Re-indent and normalise spacing across a whole document, and separate the
 * entries of a block that were written without their commas.
 */
export function formatAxisCode(text: string, options: AxisFormattingOptions): string {
    return formatAxisCodeWithIndent(text, options, 0);
}

/**
 * Same as {@link formatAxisCode}, but for a fragment lifted out of a larger
 * document: `initialIndent` is the block depth the fragment starts at, and also
 * the floor a closing brace can de-indent to.
 */
export function formatAxisCodeWithIndent(
    text: string,
    options: AxisFormattingOptions,
    initialIndent: number,
): string {
    // Entries inside a bracket are comma separated, so formatting puts back the
    // separators that were left out rather than leaving the script broken.
    const lines = insertMissingSeparators(text.split('\n'));
    const formatted: string[] = [];
    let indentLevel = initialIndent;
    const indentStr = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';

    for (const rawLine of lines) {
        const trimmed = rawLine.trim();

        // Preserve blank lines, minus any trailing whitespace.
        if (!trimmed) {
            formatted.push('');
            continue;
        }

        // The brackets a line opens with close blocks it sits outside of, so
        // they de-indent it before it is written; every other bracket on the
        // line only moves what comes after.
        const closers = leadingClosers(trimmed);
        const indent = Math.max(initialIndent, indentLevel - closers);

        formatted.push((indentStr.repeat(indent) + formatLineContent(trimmed)).trimEnd());

        // Whatever the line leaves unclosed - a block's `{`, a list split over
        // several lines - indents what follows it, and whatever it closes on
        // the way past - `x >= 0: x^2}` - de-indents it again.
        indentLevel = Math.max(initialIndent, indent + closers + bracketDelta(trimmed));
    }

    return formatted.join('\n');
}

/**
 * Count the block depth of a line's existing leading whitespace, so range
 * formatting can keep a fragment at the depth it already sits at.
 */
export function indentLevelOf(lineText: string, options: AxisFormattingOptions): number {
    const leadingWhitespace = lineText.match(/^(\s*)/)?.[1] ?? '';
    return options.insertSpaces
        ? Math.floor(leadingWhitespace.length / options.tabSize)
        : leadingWhitespace.split('\t').length - 1;
}

function formatLineContent(line: string): string {
    // Comments and strings are copied through untouched.
    if (line.startsWith('//') || line.startsWith('"')) {
        return line;
    }

    // Block headers and imports carry a quoted argument; leave their spacing
    // alone, since a path is not an expression - `./a.axis` would come back
    // with spaces around the `/`.
    if (
        line.startsWith('config') ||
        line.startsWith('folder') ||
        line.startsWith('table') ||
        line.startsWith('import')
    ) {
        return line;
    }

    // Trailing `# key: value` metadata formats differently from the expression
    // it annotates. Where one ends and the other begins is splitTrailingMetadata's
    // decision, the same one the compiler makes - so a `#` that opens no
    // metadata, such as the hex colour in `backgroundColor: "#f00"`, stays put.
    const { code, metadata } = splitTrailingMetadata(line);
    if (metadata === undefined) {
        return formatExpression(line);
    }

    const entries = metadata
        .replace(/\s*:\s*/g, ': ')
        .replace(/\s*,\s*/g, ', ')
        .trim();
    return `${formatExpression(code)} # ${entries}`;
}

function formatExpression(expr: string): string {
    let result = expr;

    // Spaces around = (but not ==, <=, >=, !=)
    result = result.replace(/([^<>=!])=([^=])/g, '$1 = $2');

    // Spaces around comparison operators
    result = result.replace(/([^<>])<=([^<>])/g, '$1 <= $2');
    result = result.replace(/([^<>])>=([^<>])/g, '$1 >= $2');
    result = result.replace(/([^<>=])>([^=])/g, '$1 > $2');
    result = result.replace(/([^<>=])<([^=])/g, '$1 < $2');

    // Spaces around +, except right after an opening bracket
    result = result.replace(/([^\s\(\[\{])\+/g, '$1 + ');
    result = result.replace(/\+([^\s\)\]\}])/g, '+ $1');

    // Spaces around -, leaving negative numbers alone
    result = result.replace(/([^\s\(\[\{])-/g, '$1 - ');
    result = result.replace(/-([^\s\)\]\}\d])/g, '- $1');

    // Spaces around * and /
    result = result.replace(/([^\s])\*/g, '$1 * ');
    result = result.replace(/\*([^\s])/g, '* $1');
    result = result.replace(/([^\s])\//g, '$1 / ');
    result = result.replace(/\/([^\s])/g, '/ $1');

    // Spaces around ^
    result = result.replace(/([^\s])\^/g, '$1 ^ ');
    result = result.replace(/\^([^\s])/g, '^ $1');

    // Re-join the arrow operator the - and > rules above split apart
    result = result.replace(/-\s*>/g, ' -> ');

    result = result.replace(/\s+/g, ' ');

    // Tighten punctuation: no space before, exactly one after
    result = result.replace(/\s*,\s*/g, ', ');
    result = result.replace(/\s*:\s*/g, ': ');

    // No padding just inside brackets
    result = result.replace(/(\(|\[|\{)\s+/g, '$1');
    result = result.replace(/\s+(\)|\]|\})/g, '$1');

    return result.trim();
}
