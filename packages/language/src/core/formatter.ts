// ═════════════════════════════════════════════════════════════════════════════
// Formatter - editor-agnostic
// ═════════════════════════════════════════════════════════════════════════════

import { insertMissingSeparators, metadataBlockLines, removeRedundantSeparators } from './blocks';
import { bracketDelta, leadingClosers } from './brackets';
import { splitTopLevel, splitTrailingMetadata } from './metadata';
import { matchingBracket, OPENERS, scanCode } from './scan';
import { IMAGE_KEYWORD } from './images';
import { MacroError, parseMacroDefinition } from './macros';
import { parseTickerStatement } from './ticker';
import { AxisFormattingOptions } from './types';

/**
 * Where a line is wrapped when the caller does not say.
 *
 * The same width the repository's own source is formatted to; `maxLineLength: 0`
 * turns wrapping off for a caller that wants the old line-for-line behaviour.
 */
const DEFAULT_MAX_LINE_LENGTH = 100;

/** A block keyword and the name it may carry, as written before the block's `{`. */
const BLOCK_HEADER = /(?:^|\s)(?:folder\s+"(?:[^"\\]|\\[^])*"|table|config)\s*$/;

/**
 * Re-indent and normalise spacing across a whole document, separate the entries
 * of a block that were written without their commas, and break a line too long
 * for {@link AxisFormattingOptions.maxLineLength} across several.
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
    // A block's entries are separated by their newlines and, where two share a
    // line, by a comma. Formatting settles on that one spelling: it puts back
    // the comma an entry needs rather than leaving the script broken, and takes
    // out the one at the end of a line, which the newline has already done.
    const lines = removeRedundantSeparators(insertMissingSeparators(text.split('\n')));
    // Inside a `#{ … }` block a line is a property, and is spaced as one - the
    // expression rules would rewrite the text of a label rather than its
    // layout, turning `"x-y plane"` into `"x - y plane"`.
    const inMetadata = metadataBlockLines(lines);
    const formatted: string[] = [];
    let indentLevel = initialIndent;
    const indentStr = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';

    for (const [index, rawLine] of lines.entries()) {
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

        const content = inMetadata[index] ? formatEntries(trimmed) : formatLineContent(trimmed);

        for (const line of wrapLine(content, indent, indentStr, options)) {
            formatted.push(line.trimEnd());
        }

        // Whatever the line leaves unclosed - a block's `{`, a list split over
        // several lines - indents what follows it, and whatever it closes on
        // the way past - `x >= 0: x^2}` - de-indents it again. Wrapping does not
        // change any of that: a wrapped line closes exactly what it opened.
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

// ─────────────────────────────────────────────────────────────────────────────
// Wrapping
// ─────────────────────────────────────────────────────────────────────────────
//
// A line is broken at a bracket, one entry to a line, because that is the only
// place Axis lets a statement continue: the compiler joins the lines an
// unclosed bracket spans back into the statement they came from, so
//
//     P = [
//         (0, 0),
//         (4, 0)
//     ]
//
// and the one-line form are the same script. Everything else on a line - an
// operator, a note, a comment - has nowhere to break, and is left long.

/**
 * Break `content` across as many lines as it takes to fit, or return it whole
 * when it already does, when nothing on it can be broken, or when breaking it
 * would not make the longest line any shorter.
 *
 * Returned lines carry their own indentation.
 */
function wrapLine(
    content: string,
    indent: number,
    indentStr: string,
    options: AxisFormattingOptions,
): string[] {
    const width = options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
    const line = indentStr.repeat(indent) + content;

    if (width <= 0 || line.length <= width) {
        return [line];
    }

    const { code, metadata } = splitStatementMetadata(content);

    // A statement short enough on its own is usually made long by what
    // annotates it, and a `#{ … }` block is where a property list too long for
    // the line goes: one property to a line, separated by their newlines.
    if (metadata !== undefined) {
        const properties = splitTopLevel(metadata, ',')
            .map(entry => entry.trim())
            .filter(entry => entry !== '');

        if (properties.length > 1) {
            const wrapped = [
                ...wrapLine(`${code} #{`, indent, indentStr, options),
                ...properties.flatMap(property =>
                    wrapLine(property, indent + 1, indentStr, options),
                ),
                `${indentStr.repeat(indent)}}`,
            ];

            return longestLength(wrapped) < line.length ? wrapped : [line];
        }
    }

    const group = overflowingGroup(code, indentStr.length * indent, width);

    if (!group) {
        return [line];
    }

    const entries = splitTopLevel(code.slice(group.open + 1, group.close), ',')
        .map(entry => entry.trim())
        .filter(entry => entry !== '');

    // Broken across lines, a block's entries are separated by those newlines
    // and take no comma; the entries of a list, a call or a piecewise are
    // separated by commas wherever they are written, and keep them.
    const separator = BLOCK_HEADER.test(code.slice(0, group.open)) ? '' : ',';

    // A single property rides on the closing line whole; there is nothing to
    // separate it from, so a block of its own would only cost two lines.
    const wrapped = [
        indentStr.repeat(indent) + code.slice(0, group.open + 1),
        ...entries.flatMap((entry, index) =>
            wrapLine(
                index < entries.length - 1 ? `${entry}${separator}` : entry,
                indent + 1,
                indentStr,
                options,
            ),
        ),
        indentStr.repeat(indent) +
            code.slice(group.close) +
            (metadata === undefined ? '' : ` # ${metadata}`),
    ];

    // Breaking a line that is long because of something unbreakable - a note, a
    // long property list - only spreads it out without shortening it.
    return longestLength(wrapped) < line.length ? wrapped : [line];
}

/**
 * A statement's own trailing metadata, which is only the metadata that
 * annotates the whole statement.
 *
 * A `#` inside a bracket belongs to whatever entry it follows - a block written
 * on one line, `folder "A" { y = x # color: red }`, annotates `y = x` - and
 * travels with that entry when the line is broken instead.
 */
function splitStatementMetadata(content: string): { code: string; metadata?: string } {
    const { code, metadata } = splitTrailingMetadata(content);

    if (metadata === undefined || bracketDelta(code) !== 0) {
        return { code: content };
    }

    return { code, metadata };
}

/** A bracket pair a line can be broken at, by the offsets of its two brackets. */
interface BreakableGroup {
    open: number;
    close: number;
}

/**
 * The bracket group to break a line at: the first one outside every other
 * bracket that holds separators of its own and runs past `width`.
 *
 * Running past the width is what makes a group worth breaking. Everything a
 * line carries outside its brackets - an operator, a name, a `# key: value`
 * run - stays on the line however its brackets are laid out, so a line that
 * overflows on that has nothing to gain from being spread over several: the
 * overflowing text is still there, with more lines around it. Only bracket
 * contents actually leave the line, and only when they are what hangs over the
 * edge, which is why `(-3, -3)` is left alone on a line made long by the label
 * after it.
 *
 * The first such group rather than the widest, since breaking it re-lays
 * everything to its right, which the recursion then measures again.
 */
function overflowingGroup(
    code: string,
    indentWidth: number,
    width: number,
): BreakableGroup | undefined {
    let overflowing: BreakableGroup | undefined;

    scanCode(code, (char, index, depth) => {
        if (overflowing || depth !== 0 || !OPENERS.includes(char)) {
            return;
        }

        const close = matchingBracket(code, index);

        // A bracket holding no separator is not a group: breaking `sin(x)` open
        // gains a line and loses a reading of it.
        if (close === -1 || splitTopLevel(code.slice(index + 1, close), ',').length < 2) {
            return;
        }

        if (indentWidth + close >= width) {
            overflowing = { open: index, close };
        }
    });

    return overflowing;
}

function longestLength(lines: string[]): number {
    return lines.reduce((longest, line) => Math.max(longest, line.length), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Spacing
// ─────────────────────────────────────────────────────────────────────────────

function formatLineContent(line: string): string {
    // Comments and strings are copied through untouched.
    if (line.startsWith('//') || line.startsWith('"')) {
        return line;
    }

    // Block headers, imports and images carry a quoted argument; leave the
    // statement's own spacing alone, since a path is not an expression -
    // `./a.axis` would come back with spaces around the `/`, and so would every
    // URL an image names. What they carry behind a `#` is metadata like any
    // other, and is spaced like it.
    if (
        line.startsWith('config') ||
        line.startsWith('folder') ||
        line.startsWith('table') ||
        line.startsWith('import') ||
        IMAGE_KEYWORD.test(line)
    ) {
        const { code, metadata } = splitTrailingMetadata(line);
        return metadata === undefined ? line : `${code} # ${formatEntries(metadata)}`;
    }

    // A ticker is a keyword and then an expression, so only the expression is
    // spaced - running the whole line through would read `ticker a` as two
    // names multiplied together and close the gap between them.
    const ticker = parseTickerStatement(line);
    if (ticker) {
        return ticker.handler ? `ticker ${formatLineContent(ticker.handler)}` : line;
    }

    // A macro is a keyword, a name, a parameter list and then whatever it
    // expands to - which is spaced as the statement it will become, since that
    // is what it is read as everywhere it is used.
    const macro = readMacro(line);
    if (macro) {
        const parameters = macro.parameters ? `(${macro.parameters.join(', ')})` : '';
        return `macro ${macro.name}${parameters} ${formatMacroBody(macro.body)}`;
    }

    // Trailing `# key: value` metadata formats differently from the expression
    // it annotates. Where one ends and the other begins is splitTrailingMetadata's
    // decision, the same one the compiler makes - so a `#` that opens no
    // metadata, such as the hex colour in `backgroundColor: "#f00"`, stays put.
    const { code, metadata } = splitTrailingMetadata(line);
    if (metadata === undefined) {
        return formatExpression(line);
    }

    return `${formatExpression(code)} # ${formatEntries(metadata)}`;
}

/**
 * Space a `key: value` run, whether it was written after a `#` or on a line of
 * its own inside a `#{ … }` block.
 *
 * Only the punctuation between the entries is touched. A property's value is
 * left as it was written, since what looks like an operator inside one may be
 * text - the `-` of a label, the `:` of a note.
 */
/**
 * A macro definition, or undefined when the line is not one - including when it
 * is one that does not parse, which is most of them while it is being typed.
 * Formatting leaves those exactly as they are for the diagnostics to explain.
 */
function readMacro(line: string) {
    try {
        return parseMacroDefinition(line);
    } catch (error) {
        if (error instanceof MacroError) {
            return undefined;
        }
        throw error;
    }
}

/**
 * Space a macro's body as the statement it will become - or, where the body is
 * a run of properties, as the run it will become.
 *
 * A body opening with a `#` is metadata and nothing else, which the expression
 * rules would take apart: there is no statement in front of the `#` for them to
 * space. The `#{ … }` spelling settles to the `# …` one on the way, since that
 * is what the compiler folds it to before it reads the line anyway.
 */
function formatMacroBody(body: string): string {
    if (!body.startsWith('#')) {
        return formatLineContent(body);
    }

    // A body that opens a `#{ … }` block and does not close it is the first line
    // of a definition the rest of the block finishes - which is how wrapping
    // writes one too long for its line. There is nothing on this line to space.
    if (bracketDelta(body) > 0) {
        return body;
    }

    const rest = body.slice(1).trim();
    const braced = rest.startsWith('{') && rest.endsWith('}');

    return `# ${formatEntries(braced ? rest.slice(1, -1) : rest)}`;
}

function formatEntries(text: string): string {
    return text
        .replace(/\s*:\s*/g, ': ')
        .replace(/\s*,\s*/g, ', ')
        .trim();
}

/**
 * Space out every `-`.
 *
 * A subtraction takes a space either side; a unary minus takes none and belongs
 * to what it negates - `-x`, `(-3, -3)`, `exp(-decay * x)`. Which one a `-` is
 * comes from what stands before it: where there is nothing to subtract from -
 * the start of the expression, an opening bracket, a separator, another
 * operator - it negates.
 *
 * The `-` of an action arrow is left alone for {@link formatExpression}'s arrow
 * rule to put back together, since the `>` rule has already split the two.
 */
function spaceMinusSigns(expr: string): string {
    let result = '';

    for (let index = 0; index < expr.length; index++) {
        const char = expr[index];

        if (char !== '-' || expr[index + 1] === '>') {
            result += char;
            continue;
        }

        const before = result.trimEnd();

        if (!/(^|[([{,:=+\-*/^<>])$/.test(before)) {
            result = `${before} - `;
            continue;
        }

        // Unary, so it belongs to what it negates and nothing comes between
        // them. The space it sits *after* is whatever was already there: the
        // padding rules below close up `(-3` and open up `x, -3` in their turn.
        result += '-';
        while (/\s/.test(expr[index + 1] ?? '')) {
            index++;
        }
    }

    return result;
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

    // Spaces around -, which is two operators wearing one character.
    result = spaceMinusSigns(result);

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
