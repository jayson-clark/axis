// ═════════════════════════════════════════════════════════════════════════════
// Diagnostics - editor-agnostic syntax checking
// ═════════════════════════════════════════════════════════════════════════════
//
// This is a syntax checker, not a semantic one: it reports what Axis itself can
// tell is malformed (unbalanced brackets, block headers, entry separators,
// misspelled property names). Anything that only Desmos can judge - whether an
// expression evaluates, whether a variable is defined - is left alone.

import {
    AXIS_CONFIG_PROPERTY_NAMES,
    AXIS_METADATA_PROPERTY_NAMES,
    AXIS_TICKER_PROPERTY_NAMES,
} from '../language-manifest';
import {
    BLOCK_KEYWORDS,
    BlockFrame,
    BlockKind,
    BlockSegment,
    missingSeparators,
    scanBlockLine,
} from './blocks';
import { IMPORT_KEYWORD, parseImportStatement, type LocatedImport } from './imports';
import { parseTickerStatement, TICKER_KEYWORD } from './ticker';
import { splitTopLevelParts, splitTrailingMetadata } from './metadata';
import {
    CLOSER_FOR,
    CLOSERS,
    endOfString,
    OPENER_FOR,
    OPENERS,
    scanCode,
    topLevelIndexOf,
} from './scan';

export type AxisDiagnosticSeverity = 'error' | 'warning';

/** Stable identifiers, so editors and tests can match on a rule rather than its wording. */
export type AxisDiagnosticCode =
    | 'unterminated-string'
    | 'unclosed-bracket'
    | 'unmatched-bracket'
    | 'mismatched-bracket'
    | 'missing-comma'
    | 'block-header'
    | 'empty-folder-name'
    | 'import-syntax'
    | 'import-placement'
    | 'import-not-found'
    | 'nested-folder'
    | 'config-placement'
    | 'ticker-placement'
    | 'empty-ticker'
    | 'duplicate-config'
    | 'entry-syntax'
    | 'missing-value'
    | 'unknown-config-property'
    | 'unknown-metadata-property';

/**
 * One problem found in a document. Positions are zero-based and half-open, so
 * `[startCharacter, endCharacter)` is the text to underline on `line`.
 */
export interface AxisDiagnostic {
    severity: AxisDiagnosticSeverity;
    code: AxisDiagnosticCode;
    message: string;
    line: number;
    startCharacter: number;
    endCharacter: number;
}

const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Metadata keys that are written bare, with no value. */
const FLAG_PROPERTIES = new Set(['hidden', 'secret']);

/**
 * Check `text` for syntax problems.
 *
 * @param text - the whole document
 * @returns every diagnostic found, in document order
 */
export function validateAxis(text: string): AxisDiagnostic[] {
    const diagnostics: AxisDiagnostic[] = [];
    const lines = text.split('\n');
    const scans = lines.map(scanLine);
    const brackets: BracketFrame[] = [];
    const blocks: BlockFrame[] = [];
    const segments: BlockSegment[] = [];

    const report = (
        severity: AxisDiagnosticSeverity,
        code: AxisDiagnosticCode,
        message: string,
        line: number,
        startCharacter: number,
        endCharacter: number,
    ) => {
        diagnostics.push({
            severity,
            code,
            message,
            line,
            startCharacter,
            // An empty range renders as a zero-width squiggle in both editors,
            // so anything degenerate is widened to a single character.
            endCharacter: Math.max(endCharacter, startCharacter + 1),
        });
    };

    for (let i = 0; i < lines.length; i++) {
        const scan = scans[i];

        if (scan.unterminatedStringAt !== undefined) {
            report(
                'error',
                'unterminated-string',
                'Unterminated string - add the closing quote.',
                i,
                scan.unterminatedStringAt,
                lines[i].length,
            );
            continue;
        }

        // Blank lines and whole-line comments carry nothing to check, and must
        // not disturb the bracket stack.
        if (!scan.code && !scan.metadata) {
            continue;
        }

        if (scan.metadata) {
            // Which properties are legal depends on what is being annotated: a
            // ticker takes `minStep` and nothing an expression takes, and an
            // expression takes the reverse.
            checkMetadata(scan.metadata, i, TICKER_KEYWORD.test(scan.code), report);
        }

        applyBrackets(scan, i, brackets, report);
        segments.push(...scanBlockLine(lines[i], i, blocks));
    }

    for (const frame of brackets) {
        report(
            'error',
            'unclosed-bracket',
            `Unclosed '${frame.char}' - expected a matching '${CLOSER_FOR[frame.char]}'.`,
            frame.line,
            frame.index,
            frame.index + 1,
        );
    }

    checkSegments(segments, report);

    // The checks run in passes rather than strictly left to right, so the list
    // is put back into document order before it is handed to an editor.
    return diagnostics.sort((a, b) => a.line - b.line || a.startCharacter - b.startCharacter);
}

/**
 * The diagnostic for an import whose file is not there.
 *
 * Whether a path resolves is not something the language can answer - only the
 * host knows what its paths mean and what it has - so this is built here and
 * reported by whoever did the looking.
 */
export function missingImportDiagnostic(located: LocatedImport): AxisDiagnostic {
    return {
        severity: 'error',
        code: 'import-not-found',
        message: `Cannot find "${located.specifier}".`,
        line: located.line,
        startCharacter: located.startCharacter,
        endCharacter: located.endCharacter,
    };
}

type Report = (
    severity: AxisDiagnosticSeverity,
    code: AxisDiagnosticCode,
    message: string,
    line: number,
    startCharacter: number,
    endCharacter: number,
) => void;

// ─────────────────────────────────────────────────────────────────────────────
// Line scanning
// ─────────────────────────────────────────────────────────────────────────────

interface MetadataSpan {
    /** The `key: value, ...` text, trimmed. */
    text: string;
    /** Column `text[0]` sits at in the raw line. */
    start: number;
}

interface ScannedLine {
    /** The statement, with any `//` comment and trailing metadata removed. */
    code: string;
    /** Column `code[0]` sits at in the raw line. */
    codeStart: number;
    metadata?: MetadataSpan;
    unterminatedStringAt?: number;
    /** Brackets in `code`, in order, at their raw-line columns. */
    brackets: { char: string; index: number }[];
}

/**
 * Split one raw line into the parts the checks work on.
 *
 * Strings and comments are skipped while scanning, so a note such as
 * `"an unmatched ( here"` contributes no brackets and `// {` opens no block.
 */
function scanLine(text: string): ScannedLine {
    const brackets: { char: string; index: number }[] = [];
    let unterminated = false;
    let quoteStart = -1;
    let commentStart = -1;
    let hashStart = -1;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (char === '"' || char === "'") {
            const end = endOfString(text, i);
            if (end === -1) {
                quoteStart = i;
                unterminated = true;
                break;
            }
            i = end - 1;
        } else if (char === '/' && text[i + 1] === '/') {
            commentStart = i;
            break;
        } else if (char === '#' && hashStart === -1 && (i === 0 || /\s/.test(text[i - 1]))) {
            hashStart = i;
        } else if (OPENERS.includes(char) || CLOSERS.includes(char)) {
            brackets.push({ char, index: i });
        }
    }

    if (unterminated) {
        return { code: '', codeStart: 0, brackets: [], unterminatedStringAt: quoteStart };
    }

    // A `#{` opens a block, whose properties are checked one at a time off the
    // segments they become - each on the line it was written on, which a run
    // read off a single line could never give them. Here it is only structure:
    // its braces pair up like any others, and nothing on the line is metadata.
    const metadataBlock = hashStart !== -1 && text[hashStart + 1] === '{';

    // A `#` only opens metadata when what follows reads as properties; anything
    // else - a stray hex colour, a `#` used as a comment - is left in place.
    let metadata: MetadataSpan | undefined;
    const trailing =
        hashStart === -1 || metadataBlock
            ? ''
            : text.slice(hashStart + 1, commentStart === -1 ? undefined : commentStart);
    if (trailing.includes(':') || FLAG_PROPERTIES.has(trailing.trim())) {
        const leading = trailing.length - trailing.trimStart().length;
        metadata = { text: trailing.trim(), start: hashStart + 1 + leading };
    }

    let codeEnd = text.length;
    if (metadata) {
        codeEnd = hashStart;
    } else if (commentStart !== -1) {
        codeEnd = commentStart;
    }

    const region = text.slice(0, codeEnd);
    const codeStart = region.length - region.trimStart().length;
    const code = region.trim();

    // A line whose first character is `#` is a comment, not a statement - but a
    // `#{` is the brace that opens a block, and has to be counted as one.
    if (code.startsWith('#') && !metadataBlock) {
        return { code: '', codeStart, brackets: [], metadata };
    }

    return {
        code,
        codeStart,
        metadata,
        brackets: brackets.filter(bracket => bracket.index < codeEnd),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Brackets and block structure
// ─────────────────────────────────────────────────────────────────────────────

/** One bracket left open, tracked only so that it can be paired with its closer. */
interface BracketFrame {
    char: string;
    line: number;
    index: number;
}

/** Push and pop `stack` over the line's brackets, reporting the ones that do not pair up. */
function applyBrackets(
    scan: ScannedLine,
    line: number,
    stack: BracketFrame[],
    report: Report,
): void {
    for (const bracket of scan.brackets) {
        if (OPENERS.includes(bracket.char)) {
            stack.push({ char: bracket.char, line, index: bracket.index });
            continue;
        }

        const open = stack[stack.length - 1];
        if (!open) {
            report(
                'error',
                'unmatched-bracket',
                `Unmatched '${bracket.char}' - nothing was opened here.`,
                line,
                bracket.index,
                bracket.index + 1,
            );
            continue;
        }

        if (open.char !== OPENER_FOR[bracket.char]) {
            report(
                'error',
                'mismatched-bracket',
                `Expected '${CLOSER_FOR[open.char]}' to close the '${open.char}' opened on line ${open.line + 1}, found '${bracket.char}'.`,
                line,
                bracket.index,
                bracket.index + 1,
            );
        }

        stack.pop();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Entries
// ─────────────────────────────────────────────────────────────────────────────

/** How a block's contents are named in a message. */
function entryLabel(kind: BlockKind): string {
    switch (kind) {
        case 'config':
            return 'Config';
        case 'table':
            return 'Table';
        case 'folder':
            return 'Folder';
        case 'metadata':
            return 'Metadata';
        default:
            return 'List';
    }
}

/**
 * What to say about a separator that is missing.
 *
 * Inside a block the newline is the separator, so a comma is only wanted where
 * one was not taken; inside an ordinary bracket the comma is the only separator
 * there is.
 */
function separatorAdvice(kind: BlockKind): string {
    return kind === 'list'
        ? 'List entries are separated by commas'
        : `Two ${entryLabel(kind).toLowerCase()} entries on one line are separated by a comma`;
}

/**
 * Check the statements a document is built from.
 *
 * Everything here works off {@link scanBlockLine}'s segments rather than off
 * raw lines, so a block written inline is held to exactly the same rules as one
 * spread over several lines.
 */
function checkSegments(segments: BlockSegment[], report: Report): void {
    const unseparated = new Set(missingSeparators(segments));
    let configBlocks = 0;

    for (const segment of segments.filter(entry => !entry.comment)) {
        // A `#{` header is the statement it annotates with the brace on the
        // end, so it is checked as one - the brace itself has no spelling to
        // get wrong.
        if (segment.kind === 'header' && segment.block?.kind === 'metadata') {
            checkEntry({ ...segment, text: segment.text.slice(0, -2).trimEnd() }, report);
            continue;
        }

        if (segment.kind === 'header' && segment.block) {
            checkHeader(segment, segment.block, report);
            if (segment.block.kind === 'config' && ++configBlocks > 1) {
                report(
                    'warning',
                    'duplicate-config',
                    'A second config block overrides the first; the calculator only takes one.',
                    segment.line,
                    segment.start,
                    segment.start + 6,
                );
            }
        }

        if (segment.kind === 'entry') {
            checkEntry(segment, report);
        }

        if (!unseparated.has(segment) || !segment.parent) {
            continue;
        }

        const end = segment.start + segment.text.length;
        report(
            'error',
            'missing-comma',
            `${separatorAdvice(segment.parent.kind)} - add a \`,\` after this one.`,
            segment.line,
            Math.max(end - 1, segment.start),
            end,
        );
    }
}

/** `folder`, `table` and `config` are block keywords; each has one legal spelling. */
function checkHeader(segment: BlockSegment, block: BlockFrame, report: Report): void {
    const { line, start } = segment;
    const end = start + segment.text.length;
    // A header carries metadata of its own - `folder "A" { # collapsed: true` -
    // which the compiler reads off it and the spelling rules below ignore.
    const text = splitTrailingMetadata(segment.text).code;

    // A header that is misspelt never becomes the block it names - `folder A {`
    // opens an anonymous one - so the keyword, not the block, is what decides
    // which rule to hold it to.
    const keyword = /^(folder|table|config)\b/.exec(text)?.[1];

    if (keyword === 'folder' || block.kind === 'folder') {
        if (!/^folder\s+"[^"]*"\s*\{$/.test(text)) {
            report(
                'error',
                'block-header',
                'A folder is written as `folder "Name" {`.',
                line,
                start,
                end,
            );
            return;
        }
        // Desmos has nothing to label a nameless folder with, and the compiler
        // will not read one as a folder at all - `folder "" {` falls through
        // and compiles as an expression, which is a graph nobody meant.
        if (/^folder\s+""\s*\{$/.test(text)) {
            report(
                'error',
                'empty-folder-name',
                'A folder needs a name - Desmos has nothing to label an empty one with.',
                line,
                start,
                end,
            );
            return;
        }

        for (let frame = block.parent; frame; frame = frame.parent) {
            if (frame.kind === 'folder') {
                report(
                    'error',
                    'nested-folder',
                    'Folders cannot be nested - Desmos only supports one level.',
                    line,
                    start,
                    end,
                );
                return;
            }
        }
        return;
    }

    if (keyword === 'table' || block.kind === 'table') {
        if (!/^table\s*\{$/.test(text)) {
            report('error', 'block-header', 'A table is written as `table {`.', line, start, end);
        }
        return;
    }

    if (keyword === 'config' || block.kind === 'config') {
        if (!/^config\s*\{$/.test(text)) {
            report(
                'error',
                'block-header',
                'A config block is written as `config {`.',
                line,
                start,
                end,
            );
            return;
        }
        if (block.parent) {
            report(
                'error',
                'config-placement',
                'A config block must sit at the top level, outside every folder and table.',
                line,
                start,
                end,
            );
        }
    }
}

/** Check one statement: its shape, and whether it hides an entry that lost its comma. */
function checkEntry(segment: BlockSegment, report: Report): void {
    // Metadata is checked against its own rules, on the line it was found.
    const { code } = splitTrailingMetadata(segment.text);
    if (!code) {
        return;
    }

    if (IMPORT_KEYWORD.test(code)) {
        checkImport(code, segment, report);
        return;
    }

    if (TICKER_KEYWORD.test(code)) {
        checkTicker(code, segment, report);
        return;
    }

    const keyword = BLOCK_KEYWORDS.exec(code)?.[1];
    if (keyword) {
        report(
            'error',
            'block-header',
            keyword === 'folder'
                ? 'A folder is written as `folder "Name" {`.'
                : `A ${keyword} block is written as \`${keyword} {\`.`,
            segment.line,
            segment.start,
            segment.start + code.length,
        );
        return;
    }

    if (!segment.parent) {
        return;
    }

    if (segment.parent.kind === 'config') {
        checkEntries(
            code,
            segment.line,
            segment.start,
            CONFIG_PROPERTIES,
            'Config',
            false,
            'unknown-config-property',
            report,
        );
        return;
    }

    // A `#{ … }` entry is a property, and is held to the same rules as the one
    // written after a `#` - which of the two sets it comes from depends on what
    // the block was opened on, the ticker taking properties of its own.
    if (segment.parent.kind === 'metadata') {
        const onTicker = TICKER_KEYWORD.test(segment.parent.header ?? '');
        checkEntries(
            code,
            segment.line,
            segment.start,
            onTicker ? TICKER_PROPERTIES : METADATA_PROPERTIES,
            onTicker ? 'Ticker' : 'Metadata',
            !onTicker,
            'unknown-metadata-property',
            report,
        );
        return;
    }

    // Two statements with no comma between them read as one entry: `x = [1, 2]
    // y = [3, 4]` is a single column until the comma is put back.
    const second = findSecondStatement(code);
    if (second !== -1) {
        report(
            'error',
            'missing-comma',
            `${separatorAdvice(segment.parent.kind)} - add a \`,\` before this one.`,
            segment.line,
            segment.start + second,
            segment.start + code.length,
        );
    }
}

/**
 * Check a `ticker` statement: that it has an action to run, and that it is
 * written where the graph's own ticker belongs.
 *
 * A graph has exactly one, kept beside the expression list rather than in it,
 * so a ticker inside a folder is not a ticker for that folder - it is the same
 * one graph's ticker, written somewhere misleading.
 */
function checkTicker(code: string, segment: BlockSegment, report: Report): void {
    const { line, start } = segment;
    const end = start + code.length;
    const handler = parseTickerStatement(code)?.handler;

    if (!handler) {
        report(
            'error',
            'empty-ticker',
            'A ticker is written as `ticker a -> a + 1` - give it an action to run.',
            line,
            start,
            end,
        );
        return;
    }

    if (segment.parent) {
        report(
            'error',
            'ticker-placement',
            'A ticker belongs to the whole graph, so it is written at the top level, outside every folder and table.',
            line,
            start,
            end,
        );
    }
}

/**
 * Check an `import` statement: its shape, and that it lands somewhere a folder
 * of expressions can go.
 */
function checkImport(code: string, segment: BlockSegment, report: Report): void {
    const { line, start } = segment;
    const end = start + code.length;

    if (!parseImportStatement(code)) {
        report(
            'error',
            'import-syntax',
            'An import is written as `import "./file.axis"`, optionally followed by `as "Name"`.',
            line,
            start,
            end,
        );
        return;
    }

    // Anywhere else is a block whose entries are not expressions, so there is
    // nowhere for an imported script to go.
    if (segment.parent && segment.parent.kind !== 'folder') {
        report(
            'error',
            'import-placement',
            `An import belongs at the top level or inside a folder, not in a ${entryLabel(segment.parent.kind).toLowerCase()}.`,
            line,
            start,
            end,
        );
    }
}

/**
 * A run of `key: value` entries, checked for shape, separators and spelling.
 *
 * `known` is consulted for spelling only; an unrecognised name is a warning,
 * since the manifest trails whatever Desmos has most recently added.
 */
function checkEntries(
    text: string,
    line: number,
    offset: number,
    known: ReadonlySet<string>,
    label: string,
    allowFlags: boolean,
    unknownCode: AxisDiagnosticCode,
    report: Report,
): void {
    for (const raw of splitTopLevelParts(text, ',')) {
        const leading = raw.text.length - raw.text.trimStart().length;
        const entry = raw.text.trim();
        if (!entry) {
            continue;
        }

        const start = offset + raw.start + leading;
        const end = start + entry.length;
        const colon = topLevelIndexOf(entry, ':');

        if (colon === -1) {
            if (allowFlags && FLAG_PROPERTIES.has(entry)) {
                continue;
            }
            report(
                'error',
                'entry-syntax',
                `${label} entries are written as \`key: value\`.`,
                line,
                start,
                end,
            );
            continue;
        }

        const key = entry.slice(0, colon).trim();
        if (!IDENTIFIER.test(key)) {
            report(
                'error',
                'entry-syntax',
                `\`${key}\` is not a valid property name.`,
                line,
                start,
                end,
            );
            continue;
        }

        if (!known.has(key)) {
            report(
                'warning',
                unknownCode,
                `Unknown ${label.toLowerCase()} property '${key}'.`,
                line,
                start,
                start + key.length,
            );
        }

        const value = entry.slice(colon + 1);
        if (!value.trim()) {
            report('error', 'missing-value', `'${key}' has no value.`, line, start, end);
            continue;
        }

        // `color: red lineWidth: 2` is two entries with the comma left out; the
        // second key is still sitting in the first one's value.
        const stray = findTopLevelKey(value);
        if (stray !== -1) {
            const strayStart = start + colon + 1 + stray;
            report(
                'error',
                'missing-comma',
                `${label} entries are separated by commas - add a \`,\` before this one.`,
                line,
                strayStart,
                strayStart + 1,
            );
        }
    }
}

const CONFIG_PROPERTIES = new Set(AXIS_CONFIG_PROPERTY_NAMES);
const METADATA_PROPERTIES = new Set(AXIS_METADATA_PROPERTY_NAMES);
const TICKER_PROPERTIES = new Set(AXIS_TICKER_PROPERTY_NAMES);

function checkMetadata(
    metadata: MetadataSpan,
    line: number,
    onTicker: boolean,
    report: Report,
): void {
    checkEntries(
        metadata.text,
        line,
        metadata.start,
        onTicker ? TICKER_PROPERTIES : METADATA_PROPERTIES,
        onTicker ? 'Ticker' : 'Metadata',
        !onTicker,
        'unknown-metadata-property',
        report,
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small scanning helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where a second `=` statement starts inside `text`, or -1.
 *
 * Only assignments are looked for: they are what a table column or a defined
 * value is written as, and so are what a missing comma runs together.
 *
 * A `for` or a `with` binds names of its own - `x = a for a = [-10, 10]` - and
 * every `=` after one belongs to it rather than to a statement that has run
 * into this one, so the search stops where the bindings start.
 */
function findSecondStatement(text: string): number {
    let seen = 0;
    let start = -1;

    scanCode(
        text,
        (char, index, depth) => {
            if (depth <= 0 && /[a-zA-Z]/.test(char) && opensBindings(text, index)) {
                return true;
            }
            if (
                char === '=' &&
                depth <= 0 &&
                !'<>=!'.includes(text[index - 1]) &&
                text[index + 1] !== '=' &&
                ++seen === 2
            ) {
                start = startOfStatement(text, index);
                return true;
            }
        },
        { stopAtLineComment: false },
    );

    return start;
}

/** Whether the word at `index` is a `for` or a `with` taking bindings. */
function opensBindings(text: string, index: number): boolean {
    return (
        /^(?:for|with)(?![a-zA-Z0-9_])/.test(text.slice(index)) &&
        !/[a-zA-Z0-9_]/.test(text[index - 1] ?? '')
    );
}

/** Walk back from an `=` over the name - `x`, or `f(t)` - being defined. */
function startOfStatement(text: string, equals: number): number {
    let i = equals - 1;
    while (i >= 0 && text[i] === ' ') i--;

    if (text[i] === ')') {
        let depth = 0;
        for (; i >= 0; i--) {
            if (text[i] === ')') depth++;
            else if (text[i] === '(' && --depth === 0) break;
        }
        i--;
    }

    while (i >= 0 && /[a-zA-Z0-9_]/.test(text[i])) i--;
    return i + 1;
}

/**
 * Index of the first `name:` sitting at the top level of `input`, or -1.
 *
 * Used to spot a property that has run into the previous one's value. Colons
 * nested in brackets (`sliderBounds: {min: 0}`) or quotes belong to the value.
 */
function findTopLevelKey(input: string): number {
    let found = -1;

    scanCode(
        input,
        (char, index, depth) => {
            // Only the first character of a name, sitting outside every bracket.
            if (depth > 0 || !/[a-zA-Z_]/.test(char)) {
                return;
            }
            if (index > 0 && /[a-zA-Z0-9_]/.test(input[index - 1])) {
                return;
            }

            let end = index;
            while (end < input.length && /[a-zA-Z0-9_]/.test(input[end])) {
                end++;
            }
            let after = end;
            while (input[after] === ' ') {
                after++;
            }

            if (input[after] === ':') {
                found = index;
                return true;
            }
        },
        { stopAtLineComment: false },
    );

    return found;
}
