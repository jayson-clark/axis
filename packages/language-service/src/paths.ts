// ═════════════════════════════════════════════════════════════════════════════
// Paths - completing the file an import or an image is naming
// ═════════════════════════════════════════════════════════════════════════════
//
// Typing a path is the one completion the language cannot answer on its own:
// what is in a directory is the host's to know. So this is the half that is
// not - whether the cursor is in a path at all, which directory it is in, and
// which of the entries a host listed are worth offering - and the host does the
// listing in between, synchronously through `getCompletions`' `listDirectory`
// or, where listing is asynchronous, by calling these two itself.

import { AXIS_FILE_EXTENSION, imageMediaType, type SyntaxTree } from '@axis-dsl/syntax';
import { cursorContext } from './context';
import {
    offsetAt,
    spanToRange,
    toTree,
    type DocumentInput,
    type Position,
    type Range,
} from './document';
import type { CompletionItem } from './completions';

/** The statement whose path is being typed. */
export type PathKind = 'import' | 'image';

/** Where the cursor is, when it is inside a path. */
export interface PathContext {
    kind: PathKind;
    /** Everything inside the quotes up to the cursor, e.g. `./lib/cur`. */
    prefix: string;
    /**
     * The directory part of it, `./lib/` - what the host lists. Empty for a
     * path with no `/` in it yet, which is the file's own directory.
     */
    directory: string;
    /** The segment being typed, just past the last `/` to the cursor: what a completion replaces. */
    range: Range;
}

/** One entry of a directory, as the host read it. */
export interface DirectoryEntry {
    name: string;
    directory: boolean;
}

/**
 * The path the cursor sits in, or undefined when it sits anywhere else.
 *
 * Only the quoted path straight after `import` or `image` is one: the `as
 * "Title"` of an import is a folder's name, and a note is prose.
 */
export function getPathContext(input: DocumentInput, position: Position): PathContext | undefined {
    const tree = toTree(input);
    const offset = offsetAt(tree, position);
    const { context } = cursorContext(tree, offset);
    if (context.kind !== 'path') return undefined;

    const opened = context.string.span.start + 1;
    const prefix = tree.source.slice(opened, offset);
    const directory = prefix.slice(0, prefix.lastIndexOf('/') + 1);
    return {
        kind: context.statement,
        prefix,
        directory,
        range: spanToRange(tree, { start: opened + directory.length, end: offset }),
    };
}

/**
 * What is worth offering out of `entries`, which the host read from the
 * directory {@link getPathContext} named.
 *
 * Directories come first and keep their `/`, since a path is typed a segment at
 * a time. Of the files, only the ones the statement could actually name are
 * offered - a `.axis` for an import, a picture for an image - because anything
 * else is a path that compiles to an error.
 */
export function getPathCompletions(
    context: PathContext,
    entries: readonly DirectoryEntry[],
): CompletionItem[] {
    const byName = (one: DirectoryEntry, other: DirectoryEntry) =>
        one.name.localeCompare(other.name);

    // A dotfile is not something a script names, and `.git` and its like would
    // otherwise be most of what a list of directories offers.
    const visible = entries.filter(entry => !entry.name.startsWith('.'));

    const directories = visible
        .filter(entry => entry.directory)
        .sort(byName)
        .map((entry): CompletionItem => ({
            label: `${entry.name}/`,
            kind: 'folder',
            detail: 'Folder',
            range: context.range,
            // Typing on into the directory is what comes next.
            retrigger: true,
        }));

    const files = visible
        .filter(entry => !entry.directory)
        .sort(byName)
        .flatMap((entry): CompletionItem[] => {
            const detail =
                context.kind === 'import'
                    ? entry.name.endsWith(AXIS_FILE_EXTENSION)
                        ? 'Axis script'
                        : undefined
                    : imageMediaType(entry.name);
            return detail === undefined
                ? []
                : [{ label: entry.name, kind: 'file', detail, range: context.range }];
        });

    return [...directories, ...files];
}

/** For `getCompletions`: the path completions at an offset, if the host can list. */
export function pathCompletionsAt(
    tree: SyntaxTree,
    position: Position,
    listDirectory: ((directory: string, kind: PathKind) => readonly DirectoryEntry[]) | undefined,
): CompletionItem[] | undefined {
    const context = getPathContext(tree, position);
    if (!context) return undefined;
    if (!listDirectory) return [];
    return getPathCompletions(context, listDirectory(context.directory, context.kind));
}
