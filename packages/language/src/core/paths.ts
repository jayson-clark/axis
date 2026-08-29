// ═════════════════════════════════════════════════════════════════════════════
// Paths - completing the file an import or an image is naming
// ═════════════════════════════════════════════════════════════════════════════
//
// Typing a path is the one completion the language cannot answer on its own:
// what is in a directory is the host's to know. So this is the half that is
// not - whether the cursor is in a path at all, which directory it is in, and
// which of the entries a host listed are worth offering - and the host does the
// listing in between.

import { imageMediaType } from './images';
import { AXIS_FILE_EXTENSION } from './language-config';
import { AxisCompletionItem, AxisPosition } from './types';

/** The statement whose path is being typed. */
export type AxisPathKind = 'import' | 'image';

/** Where the cursor is, when it is inside a path. */
export interface AxisPathContext {
    kind: AxisPathKind;
    /** Everything inside the quotes up to the cursor, e.g. `./lib/cur`. */
    prefix: string;
    /**
     * The directory part of it, `./lib/` - what the host lists. Empty for a
     * path with no `/` in it yet, which is the file's own directory.
     */
    directory: string;
    /** Zero-based line the path is on. */
    line: number;
    /** Column the segment being typed starts at: just past the last `/`. */
    startCharacter: number;
    /** The cursor, which is where that segment ends. */
    endCharacter: number;
}

/** One entry of a directory, as the host read it. */
export interface AxisDirectoryEntry {
    name: string;
    directory: boolean;
}

/**
 * `import` or `image`, and only where a path is what comes next.
 *
 * The `as "Name"` of an import is a title rather than a file, and the quote
 * that opens it is not preceded by the keyword, so it never matches.
 */
const PATH_STATEMENT = /(?:^|[{,])\s*(import|image)\s+$/;

/**
 * The path the cursor sits in, or undefined when it sits anywhere else.
 *
 * Read off the line rather than parsed, because a path is completed while it is
 * being typed and a statement mid-path does not parse: the string it opened is
 * still open, which is exactly what says the cursor is inside it.
 */
export function axisPathContext(text: string, position: AxisPosition): AxisPathContext | undefined {
    const line = text.split('\n')[position.line] ?? '';
    const before = line.slice(0, position.character);

    const quote = openQuoteIndex(before);
    if (quote === undefined) {
        return undefined;
    }

    const statement = PATH_STATEMENT.exec(before.slice(0, quote));
    if (!statement) {
        return undefined;
    }

    const prefix = before.slice(quote + 1);
    const directory = prefix.slice(0, prefix.lastIndexOf('/') + 1);

    return {
        kind: statement[1] as AxisPathKind,
        prefix,
        directory,
        line: position.line,
        startCharacter: quote + 1 + directory.length,
        endCharacter: position.character,
    };
}

/**
 * What is worth offering out of `entries`, which the host read from the
 * directory {@link axisPathContext} named.
 *
 * Directories come first and keep their `/`, since a path is typed a segment at
 * a time. Of the files, only the ones the statement could actually name are
 * offered - a `.axis` for an import, a picture for an image - because anything
 * else is a path that compiles to an error.
 */
export function axisPathCompletions(
    context: AxisPathContext,
    entries: readonly AxisDirectoryEntry[],
): AxisCompletionItem[] {
    const byName = (one: AxisDirectoryEntry, other: AxisDirectoryEntry) =>
        one.name.localeCompare(other.name);

    // A dotfile is not something a script names, and `.git` and its like would
    // otherwise be most of what a list of directories offers.
    const visible = entries.filter(entry => !entry.name.startsWith('.'));

    const directories = visible
        .filter(entry => entry.directory)
        .sort(byName)
        .map((entry): AxisCompletionItem => ({
            label: `${entry.name}/`,
            kind: 'folder',
            detail: 'Folder',
        }));

    const files = visible
        .filter(entry => !entry.directory)
        .sort(byName)
        .flatMap((entry): AxisCompletionItem[] => {
            const detail =
                context.kind === 'import'
                    ? entry.name.endsWith(AXIS_FILE_EXTENSION)
                        ? 'Axis script'
                        : undefined
                    : imageMediaType(entry.name);

            return detail === undefined ? [] : [{ label: entry.name, kind: 'file', detail }];
        });

    return [...directories, ...files];
}

/**
 * Where the string the line ends inside was opened, or undefined when it ends
 * outside one.
 *
 * The closing quote an editor writes for you sits after the cursor, so what is
 * being typed always reads as an open string here - which is the point.
 */
function openQuoteIndex(text: string): number | undefined {
    let opened: number | undefined;
    let quote = '';

    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];

        if (opened === undefined && (character === '"' || character === "'")) {
            opened = index;
            quote = character;
        } else if (opened !== undefined && character === quote) {
            opened = undefined;
        }
    }

    return opened;
}
