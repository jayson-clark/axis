// ═════════════════════════════════════════════════════════════════════════════
// Writing a changed graph back into the script that built it
// ═════════════════════════════════════════════════════════════════════════════
//
// A Desmos graph is not only something a script produces; it is something a
// person edits. Dragging a point moves it, dragging a slider re-numbers it, the
// colour picker recolours it, the toolbar pans the viewport - and every one of
// those is a change to the graph that the script it came from now disagrees
// with.
//
// This closes that loop. Given the compilation a graph was built from, the
// state as the calculator handed it back at that moment, and the state now, it
// works out which expressions actually changed and writes each of them back
// over the lines that produced it.
//
// **The unit is the statement, never the file.** Decompiling the whole graph
// and writing that out would be far simpler and would throw away everything a
// script has that a graph does not: the comments, the blank lines, the macros,
// the folders an import stands for, the order somebody chose. So an edit here
// is a line range and its replacement, and a statement nobody touched is not in
// the output at all.
//
// **What cannot be written is said rather than done.** A statement a macro
// expanded into, several statements sharing one line, an expression that came
// from somewhere this script cannot name - each of those is reported as a
// skipped change with a reason. Silently dropping a change the user made with
// their own hands is the one outcome worth ruling out; quietly writing the
// wrong thing is the other.

import {
    CalculatorOptions,
    DesmosExpression,
    GraphSettings,
    GraphStateFlags,
    TickerState,
} from '@axis-dsl/desmos';
import { scanBlockLine, type BlockFrame } from '@axis-dsl/language';
import type { CompilationResult } from './legacy/compile';
import { decompileExpression, decompileSettings, graphActionNames } from './legacy/decompile';

/** A graph as the calculator holds it: the expression list, and the rest. */
export interface GraphSnapshot {
    expressions: DesmosExpression[];
    settings?: CalculatorOptions;
    graph?: GraphSettings;
    state?: GraphStateFlags;
    ticker?: TickerState;
}

/** What happened to one expression between the two snapshots. */
export type ChangeKind = 'changed' | 'added' | 'removed' | 'settings';

/** One change to a graph, before anything has been decided about writing it. */
export interface GraphChange {
    kind: ChangeKind;
    /** The expression's id, absent for a settings change. */
    id?: string;
    /** What it looks like now, absent for one that was removed. */
    expression?: DesmosExpression;
}

/**
 * A replacement for a run of lines in one file.
 *
 * Zero-based and inclusive at both ends, and `text` is the lines that go there
 * - empty for a deletion. An insertion is written as a zero-width range, with
 * `line` the index it goes before and `endLine` one less than it.
 */
export interface SourceEdit {
    path: string;
    line: number;
    endLine: number;
    /** The replacement lines. Empty deletes the range. */
    text: string[];
    /** The change this edit carries out, for a host that wants to explain it. */
    change: GraphChange;
}

/** A change that was seen and deliberately not written. */
export interface SkippedChange {
    change: GraphChange;
    reason: string;
}

export interface WriteBackOptions {
    /**
     * Which kinds of change to take. Left out, all four are taken.
     *
     * Worth setting: `settings` fires on every pan and zoom, which is a change
     * to the graph but rarely one somebody meant to make to their script.
     */
    include?: Partial<Record<ChangeKind, boolean>>;
    /**
     * The file a new expression is written to when there is nowhere better -
     * which is anything not landing in a folder the script wrote. Defaults to
     * the compilation's entry.
     */
    entryPath?: string;
    /** One level of block indentation. Four spaces, as the formatter writes it. */
    indent?: string;
}

export interface WriteBackResult {
    /**
     * The edits to make, ordered so they can be applied one after another
     * without re-indexing: latest in the file first, within each file.
     */
    edits: SourceEdit[];
    /** Changes that were seen but not written, each with why. */
    skipped: SkippedChange[];
}

/**
 * The changes between two snapshots of the same graph, as edits to the script.
 *
 * `before` is the state the calculator handed back immediately after the
 * compilation was applied to it, rather than the compilation itself. That
 * matters: Desmos normalises what it is given - dropping a bound that matches
 * its own default, writing a switched-off clickable by leaving `enabled` off -
 * so comparing against what was sent would report a change on every expression
 * the moment the graph loaded.
 */
export function writeBackGraph(
    compilation: CompilationResult,
    before: GraphSnapshot,
    after: GraphSnapshot,
    files: ReadonlyMap<string, string>,
    options: WriteBackOptions = {},
): WriteBackResult {
    const indent = options.indent ?? '    ';
    const wanted = (kind: ChangeKind) => options.include?.[kind] ?? true;
    const actions = graphActionNames(after.expressions);

    const edits: SourceEdit[] = [];
    const skipped: SkippedChange[] = [];

    for (const change of diffGraphs(before, after)) {
        if (!wanted(change.kind)) {
            continue;
        }

        const edit = editFor(change, compilation, before, after, files, actions, indent, options);
        if ('reason' in edit) {
            skipped.push({ change, reason: edit.reason });
        } else {
            edits.push(edit);
        }
    }

    return { edits: order(edits), skipped };
}

/**
 * What changed between two snapshots, by expression id.
 *
 * Ids are what makes this possible at all: the compiler stamps every expression
 * with one, `setState` keeps it, and `getState` hands it back - so a point that
 * has been dragged halfway across the graph is still recognisably the same
 * expression, which is the only reason there is a statement to write it to.
 */
export function diffGraphs(before: GraphSnapshot, after: GraphSnapshot): GraphChange[] {
    const changes: GraphChange[] = [];
    const was = new Map(before.expressions.map(expression => [expression.id, expression]));
    const now = new Map(after.expressions.map(expression => [expression.id, expression]));

    for (const [id, expression] of now) {
        const previous = was.get(id);
        if (!previous) {
            changes.push({ kind: 'added', id, expression });
        } else if (!same(previous, expression)) {
            changes.push({ kind: 'changed', id, expression });
        }
    }

    for (const [id] of was) {
        if (!now.has(id)) {
            changes.push({ kind: 'removed', id });
        }
    }

    if (
        !same(before.settings, after.settings) ||
        !same(before.graph, after.graph) ||
        !same(before.state, after.state)
    ) {
        changes.push({ kind: 'settings' });
    }

    return changes;
}

/**
 * Two values as a graph means them.
 *
 * Key order is not part of what a graph says, and the calculator does not
 * promise to hand a state back in the order it was given, so the comparison
 * sorts before it compares. Without that, a pan would look like every
 * expression changing.
 */
function same(a: unknown, b: unknown): boolean {
    return stable(a) === stable(b);
}

function stable(value: unknown): string {
    if (value === undefined) {
        return 'undefined';
    }
    return JSON.stringify(value, (_key, held: unknown) => {
        if (held && typeof held === 'object' && !Array.isArray(held)) {
            const record = held as Record<string, unknown>;
            return Object.fromEntries(
                Object.keys(record)
                    .sort()
                    .map(key => [key, record[key]]),
            );
        }
        return held;
    });
}

/** The edit one change calls for, or why it is not one that can be made. */
function editFor(
    change: GraphChange,
    compilation: CompilationResult,
    before: GraphSnapshot,
    after: GraphSnapshot,
    files: ReadonlyMap<string, string>,
    actions: readonly string[],
    indent: string,
    options: WriteBackOptions,
): SourceEdit | { reason: string } {
    if (change.kind === 'settings') {
        return settingsEdit(change, compilation, before, after, files, indent, options);
    }

    if (change.kind === 'added') {
        return additionEdit(change, compilation, files, actions, indent, options);
    }

    // A graph that is moving by itself is not a graph anybody is editing.
    //
    // A playing slider changes its own value several times a second and a
    // running ticker changes whatever it drives, so writing either back means a
    // file that rewrites itself for as long as the tab is open - hundreds of
    // edits nobody made, each one a version in everybody else's history. The
    // animation is the script working, not somebody changing it.
    const animated = animating(change, after);
    if (animated) {
        return { reason: animated };
    }

    const origin = compilation.sourceMap.get(change.id!);
    if (!origin) {
        return { reason: 'this expression was not compiled from this script' };
    }
    if (!origin.writable) {
        return { reason: origin.reason ?? 'this statement cannot be rewritten' };
    }

    const source = files.get(origin.path);
    if (source === undefined) {
        return { reason: `${origin.path} is not among the files given` };
    }
    const lines = source.split('\n');

    if (change.kind === 'removed') {
        return { path: origin.path, line: origin.line, endLine: origin.endLine, text: [], change };
    }

    // Rewritten from the statement's own expression with the change laid over
    // it, rather than from what the calculator handed back. Those are not the
    // same thing: Desmos leaves a property off the state when it matches its
    // own default, so a slider written `{min: 0, max: 10}` comes back carrying
    // only the min - and rewriting from that would quietly take `max: 10` out
    // of somebody's script as the price of dragging the slider.
    const expression =
        merged(
            compilation.expressions.find(candidate => candidate.id === change.id),
            before.expressions.find(candidate => candidate.id === change.id),
            change.expression!,
        ) ?? change.expression!;

    const written = decompileExpression(expression, {
        indent,
        actions,
        // A statement inside a folder block is one of a run the block separates
        // by commas, so a run held together by its own commas has to be
        // bracketed there or it would read as several statements.
        separated: folderOf(expression) !== undefined,
    });

    if (!written.length) {
        return { reason: 'this expression has no statement form' };
    }

    const replacing = lines.slice(origin.line, origin.endLine + 1);

    // A picture's URL is not the picture's URL. `image "./beach.png"` is read
    // off a disk and inlined as a `data:` URI before the graph exists, so what
    // a graph carries is the bytes and the path is gone - and writing the graph
    // back over the statement would put a megabyte of base64 where the filename
    // was. Dragging a picture is a real edit and worth keeping; the name it was
    // written with is not the decompiler's to supply.
    if (expression.type === 'image') {
        const kept = keepImagePath(written[0], replacing[0]);
        if (!kept) {
            return { reason: 'cannot tell which file this picture names' };
        }
        written[0] = kept;
    }

    return {
        path: origin.path,
        line: origin.line,
        endLine: origin.endLine,
        text: relaid(written, replacing, indent),
        change,
    };
}

/** The `image "…"` a statement opens with, whatever follows it. */
const IMAGE_HEAD = /^\s*(image\s+"(?:[^"\\]|\\[^])*")/;

/**
 * `written`, wearing the picture the source named rather than the one the graph
 * carries.
 *
 * Null where the statement being replaced does not open with an `image "…"` at
 * all - which means the line is not what this expression was compiled from, and
 * the safe answer is to write nothing rather than to guess. Everything after
 * the URL is the decompiler's, since that is the half a drag actually changed.
 */
function keepImagePath(written: string, replacing: string): string | null {
    const source = IMAGE_HEAD.exec(replacing);
    const fresh = IMAGE_HEAD.exec(written);

    if (!source || !fresh) {
        return null;
    }

    return `${source[1]}${written.slice(fresh[0].length)}`;
}

/**
 * A rewritten statement, wearing the layout of the one it replaces.
 *
 * The decompiler writes a statement one way: code, then its metadata behind a
 * `#`, on one line. The statement being replaced was written by a person, who
 * may well have spread that metadata over a `#{ … }` block and indented the
 * whole thing inside a folder - and having a graph edit silently reflow
 * somebody's script is exactly the kind of thing that makes a feature like this
 * not worth having switched on.
 *
 * So the indentation is taken from the line being replaced, a metadata block is
 * written back as a block, and any `//` comment on the lines going away is kept
 * and moved to the end.
 */
function relaid(written: string[], replacing: string[], indent: string): string[] {
    const margin = /^\s*/.exec(replacing[0] ?? '')?.[0] ?? '';
    const comments = replacing.map(trailingComment).filter((text): text is string => !!text);
    const comment = comments.length ? ` ${comments.join(' ')}` : '';

    // A table, which the decompiler already writes as several lines, keeps that
    // shape; only its margin is restored.
    if (written.length > 1) {
        const laid = written.map(line => `${margin}${line}`);
        laid[laid.length - 1] += comment;
        return laid;
    }

    const statement = written[0];
    const split = splitMetadata(statement);

    if (!split) {
        return [`${margin}${statement}${comment}`];
    }

    // The properties in the order the author had them, rather than the order
    // the decompiler writes them in. Both are correct and they are rarely the
    // same, so without this every rewritten statement also silently shuffles
    // its own metadata - a diff about nothing, on a line the user is watching.
    const entries = inAuthorsOrder(splitProperties(split.metadata), replacing);

    // Written as a `#{ … }` block before, so written as one again.
    if (replacing.length > 1 && /#\{/.test(replacing[0])) {
        return [
            `${margin}${split.code} #{`,
            ...entries.map(entry => `${margin}${indent}${entry}`),
            `${margin}}${comment}`,
        ];
    }

    return [`${margin}${split.code} # ${entries.join(', ')}${comment}`];
}

/**
 * `entries` sorted the way the lines they are replacing had them.
 *
 * A property the statement did not carry before is new, and goes on the end in
 * the order the decompiler chose - which for a colour picked in Desmos means
 * `color` lands where `color` belongs rather than wherever it was noticed.
 */
function inAuthorsOrder(entries: readonly string[], replacing: readonly string[]): string[] {
    const before = replacing.join('\n');
    const at = (entry: string) => {
        const key = entry.slice(0, entry.indexOf(':'));
        // Matched as a property rather than as text, so a `label: "color: red"`
        // does not decide where `color` goes.
        const found = new RegExp(`(?:^|[#,{\\s])${key}\\s*:`).exec(before);
        return found ? found.index : Number.MAX_SAFE_INTEGER;
    };

    return entries
        .map((entry, index) => ({ entry, was: at(entry), index }))
        .sort((a, b) => a.was - b.was || a.index - b.index)
        .map(held => held.entry);
}

/**
 * A graph's settings, with the viewport dropped unless the script named one.
 *
 * Panning and zooming are how anybody reads a graph, and they change the
 * viewport constantly. A script that says nothing about its framing was written
 * by somebody who did not care about it, and putting four `xmin`-and-friends
 * lines into their config the first time they scrolled would be the feature
 * writing something they did not ask for - which is the one thing it must never
 * do. A script that *does* name a viewport has an author who cares where the
 * graph sits, and for them panning is an edit like any other.
 */
function framing(
    graph: GraphSettings | undefined,
    declared: GraphSettings | undefined,
): GraphSettings | undefined {
    if (!graph || declared?.viewport) {
        return graph;
    }

    const { viewport, ...rest } = graph;
    return rest;
}

/**
 * Why this change is the graph animating rather than somebody editing it, or
 * null where it is not.
 *
 * The ticker is checked for every expression rather than only the ones it
 * names: what a tick assigns to is an action written in latex, and reading it
 * well enough to know which expressions it touches is the ticker's own problem,
 * not something worth half-solving here. A graph whose ticker is running is a
 * graph running, so nothing in it is written back until it is stopped.
 */
function animating(change: GraphChange, after: GraphSnapshot): string | null {
    if (after.ticker?.playing) {
        return 'the ticker is running — stop it to edit from the graph';
    }

    const expression = change.expression as { slider?: { isPlaying?: boolean } } | undefined;
    if (expression?.slider?.isPlaying) {
        return 'this slider is animating — pause it to edit from the graph';
    }

    return null;
}

/**
 * `source` with the difference between `before` and `after` laid over it.
 *
 * The change is taken from what actually changed on the calculator rather than
 * from the whole of its answer, so everything the script said that Desmos
 * merely did not bother to save - a bound at its default, a property it
 * normalised away - stays in the script. A key that went is taken out; a key
 * that arrived or moved is written; everything else is left exactly as the
 * statement had it.
 */
function merged<T>(source: T | undefined, before: unknown, after: T | undefined): T | undefined {
    if (after === undefined) {
        return undefined;
    }
    if (source === undefined) {
        return after;
    }

    const was = (before ?? {}) as Record<string, unknown>;
    const now = after as unknown as Record<string, unknown>;
    const result = { ...(source as unknown as Record<string, unknown>) };

    for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
        if (same(was[key], now[key])) {
            continue;
        }
        if (key in now) {
            result[key] = now[key];
        } else {
            delete result[key];
        }
    }

    return result as T;
}

/**
 * The folder an expression belongs to, or undefined at the top level.
 *
 * A folder has no folder of its own - Desmos has one level of them - so the key
 * is absent from that member of the union rather than optional on it.
 */
function folderOf(expression: DesmosExpression): string | undefined {
    return 'folderId' in expression ? expression.folderId : undefined;
}

/** A statement's code and metadata, or null where it carries none. */
function splitMetadata(statement: string): { code: string; metadata: string } | null {
    const at = statement.lastIndexOf(' # ');
    if (at === -1) {
        return null;
    }
    return { code: statement.slice(0, at), metadata: statement.slice(at + 3) };
}

/** `color: red, lineWidth: 3` as its entries, ignoring commas inside brackets. */
function splitProperties(metadata: string): string[] {
    const entries: string[] = [];
    let depth = 0;
    let buffer = '';

    for (const char of metadata) {
        if ('([{'.includes(char)) {
            depth++;
        } else if (')]}'.includes(char)) {
            depth--;
        } else if (char === ',' && depth === 0) {
            entries.push(buffer.trim());
            buffer = '';
            continue;
        }
        buffer += char;
    }

    if (buffer.trim()) {
        entries.push(buffer.trim());
    }
    return entries;
}

/** The `// …` on the end of a line, or null - one inside a string is not one. */
function trailingComment(line: string): string | null {
    let quote: string | null = null;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (quote) {
            if (char === '\\') {
                i++;
            } else if (char === quote) {
                quote = null;
            }
        } else if (char === '"' || char === "'") {
            quote = char;
        } else if (char === '/' && line[i + 1] === '/') {
            return line.slice(i).trim();
        }
    }

    return null;
}

/** The edit that rewrites the `config { … }` block, or opens one. */
function settingsEdit(
    change: GraphChange,
    compilation: CompilationResult,
    before: GraphSnapshot,
    after: GraphSnapshot,
    files: ReadonlyMap<string, string>,
    indent: string,
    options: WriteBackOptions,
): SourceEdit | { reason: string } {
    // Merged for the same reason an expression is: the state a calculator
    // hands back is not everything the script said, only everything Desmos
    // thought worth saving.
    const written = decompileSettings(
        {
            settings: merged(compilation.settings, before.settings, after.settings),
            graph: framing(merged(compilation.graph, before.graph, after.graph), compilation.graph),
            state: merged(compilation.state, before.state, after.state),
            ticker: after.ticker,
        },
        { indent },
    );

    const origin = compilation.configOrigin;

    if (origin) {
        if (files.get(origin.path) === undefined) {
            return { reason: `${origin.path} is not among the files given` };
        }
        // Every setting back at its default leaves no block to write, and the
        // one that is there goes rather than being left empty.
        return {
            path: origin.path,
            line: origin.line,
            endLine: origin.endLine,
            text: written,
            change,
        };
    }

    if (!written.length) {
        return { reason: 'the settings are all defaults, so there is no block to write' };
    }

    const path = options.entryPath ?? entryOf(compilation, files);
    if (path === undefined) {
        return { reason: 'there is no entry file to open a config block in' };
    }

    // A script with no config block gets one at the very top, which is where
    // the decompiler puts it and where every example keeps it.
    return { path, line: 0, endLine: -1, text: [...written, ''], change };
}

/** Where an expression Desmos grew on its own is written. */
function additionEdit(
    change: GraphChange,
    compilation: CompilationResult,
    files: ReadonlyMap<string, string>,
    actions: readonly string[],
    indent: string,
    options: WriteBackOptions,
): SourceEdit | { reason: string } {
    const expression = change.expression!;
    const folderId = folderOf(expression);

    // A picture added in Desmos arrives carrying its own bytes, and a script
    // has no `image` statement that means "these bytes" - only ones that name a
    // file or a URL. Writing the statement out would put the whole picture,
    // base64'd, into somebody's source, which for a photograph is megabytes on
    // one line. It stays in the graph and is said rather than written.
    if (expression.type === 'image' && /^data:/i.test(expression.image_url ?? '')) {
        return {
            reason: 'add this picture to the plot and draw it with `image`, to give it a name',
        };
    }

    const written = decompileExpression(expression, {
        indent,
        actions,
        separated: folderId !== undefined,
    });
    if (!written.length) {
        return { reason: 'this expression has no statement form' };
    }

    // Inside a folder the script wrote, it goes at the end of that folder's
    // block - which is the only placement that keeps the graph it describes the
    // same as the graph it came from.
    if (folderId !== undefined) {
        const folder = compilation.sourceMap.get(folderId);
        if (!folder) {
            return { reason: 'this expression is in a folder that is not in this script' };
        }
        if (!folder.writable) {
            return { reason: folder.reason ?? 'its folder cannot be written into' };
        }

        const source = files.get(folder.path);
        if (source === undefined) {
            return { reason: `${folder.path} is not among the files given` };
        }

        const close = closingBrace(source.split('\n'), folder.line);
        if (close === -1) {
            return { reason: 'its folder has no closing brace' };
        }

        return {
            path: folder.path,
            line: close,
            endLine: close - 1,
            text: written.map(line => `${indent}${line}`),
            change,
        };
    }

    const path = options.entryPath ?? entryOf(compilation, files);
    if (path === undefined) {
        return { reason: 'there is no entry file to write it to' };
    }

    // Everything else goes on the end of the entry, which is the one placement
    // that is always correct and never a guess about where it belonged.
    const lines = (files.get(path) ?? '').split('\n');
    const at = lines.length;
    return { path, line: at, endLine: at - 1, text: written, change };
}

/**
 * The line holding the `}` that closes the block opened on `from`.
 *
 * Read the way the compiler reads a script rather than by counting braces: a
 * brace inside a string or a comment closes nothing, and a block written inline
 * opens and closes on the one line.
 */
function closingBrace(lines: readonly string[], from: number): number {
    const stack: BlockFrame[] = [];
    scanBlockLine(lines[from] ?? '', from, stack);

    if (!stack.length) {
        // Opened and closed on its own line, so there is nowhere inside it.
        return -1;
    }

    for (let at = from + 1; at < lines.length; at++) {
        const depth = stack.length;
        scanBlockLine(lines[at], at, stack);
        if (stack.length < depth && !stack.length) {
            return at;
        }
    }

    return -1;
}

/** The file to write something with nowhere else to go into. */
function entryOf(
    compilation: CompilationResult,
    files: ReadonlyMap<string, string>,
): string | undefined {
    for (const origin of compilation.sourceMap.values()) {
        if (files.has(origin.path) && !compilation.imports.includes(origin.path)) {
            return origin.path;
        }
    }
    return files.keys().next().value;
}

/**
 * Edits ordered so a host can apply them one after another.
 *
 * Latest in the file first, so an edit never moves the lines a later one is
 * about. Files are kept apart, since ranges in one say nothing about the other.
 */
function order(edits: readonly SourceEdit[]): SourceEdit[] {
    return [...edits].sort((a, b) =>
        a.path === b.path ? b.line - a.line : a.path < b.path ? -1 : 1,
    );
}

/** Apply edits for one file to its text. Order is {@link WriteBackResult.edits}. */
export function applySourceEdits(source: string, edits: readonly SourceEdit[]): string {
    const lines = source.split('\n');

    for (const edit of edits) {
        lines.splice(edit.line, edit.endLine - edit.line + 1, ...edit.text);
    }

    return lines.join('\n');
}
