// ═════════════════════════════════════════════════════════════════════════════
// Import statements - editor-agnostic
// ═════════════════════════════════════════════════════════════════════════════
//
// `import "./curves.axis"` drops another script into this one. Only the syntax
// lives here - what a specifier means, and where its source is read from, is
// the compiler's and its host's business.

import { scanBlockLine, type BlockFrame } from './blocks';
import { AXIS_FILE_EXTENSION } from './language-config';
import { splitTrailingMetadata } from './metadata';

/** An `import "…"` statement, as written. */
export interface ImportStatement {
    /** The path as written, before anything resolves it. */
    specifier: string;
    /** The `as "Name"` title, when the import renames the folder it lands in. */
    title?: string;
}

/** An import statement, and where in the document its path is written. */
export interface LocatedImport extends ImportStatement {
    /** Zero-based line the statement sits on. */
    line: number;
    /** Column of the specifier's opening quote. */
    startCharacter: number;
    /** Column just past its closing quote. */
    endCharacter: number;
}

/**
 * `import "./lib/curves.axis"`, optionally `as "Curves"`.
 *
 * Anchored, so `import` opens an import only when the whole statement is one: a
 * variable named `imports` is not an import, and neither is a note that happens
 * to begin with the word.
 */
const IMPORT_STATEMENT = /^import\s+("[^"]*"|'[^']*')(?:\s+as\s+("[^"]*"|'[^']*'))?$/;

/** True when a statement starts with the `import` keyword, however it goes on. */
export const IMPORT_KEYWORD = /^import\b/;

/** Read an import statement, or undefined when `code` is not a well-formed one. */
export function parseImportStatement(code: string): ImportStatement | undefined {
    const match = IMPORT_STATEMENT.exec(code.trim());
    if (!match) {
        return undefined;
    }

    return {
        specifier: unquote(match[1]),
        ...(match[2] !== undefined && { title: unquote(match[2]) }),
    };
}

/**
 * Every import in `text`, with the path each one names underlined.
 *
 * The document is scanned the way the compiler reads it, so an import written
 * inline inside a folder is found as readily as one on a line of its own - and
 * the range points at the path rather than the whole statement, since the path
 * is the part a host has anything to say about.
 */
export function findImportStatements(text: string): LocatedImport[] {
    const found: LocatedImport[] = [];
    const stack: BlockFrame[] = [];

    text.split('\n').forEach((line, number) => {
        for (const segment of scanBlockLine(line, number, stack)) {
            if (segment.comment) {
                continue;
            }

            const code = splitTrailingMetadata(segment.text).code;
            const statement = parseImportStatement(code);
            if (!statement) {
                continue;
            }

            // The first quote in the statement opens the path: `import` itself
            // holds nothing that could be mistaken for one.
            const quote = code.search(/["']/);
            const startCharacter = segment.start + quote;
            found.push({
                ...statement,
                line: segment.line,
                startCharacter,
                endCharacter: startCharacter + statement.specifier.length + 2,
            });
        }
    });

    return found;
}

/**
 * The folder title an import takes when it does not give one: the file's name,
 * without its directory or its `.axis`.
 */
export function importTitle(path: string): string {
    const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
    return name.endsWith(AXIS_FILE_EXTENSION) ? name.slice(0, -AXIS_FILE_EXTENSION.length) : name;
}

/** `./curves` and `./curves.axis` name the same file; this is the latter. */
export function withAxisExtension(specifier: string): string {
    return specifier.endsWith(AXIS_FILE_EXTENSION)
        ? specifier
        : `${specifier}${AXIS_FILE_EXTENSION}`;
}

function unquote(value: string): string {
    return value.slice(1, -1);
}
