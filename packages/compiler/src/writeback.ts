// ═════════════════════════════════════════════════════════════════════════════
// Writing a changed graph back into the file that built it
// ═════════════════════════════════════════════════════════════════════════════
//
// A Desmos graph is not only something a file produces; it is something a
// person edits. Dragging a point moves it, dragging a slider re-numbers it, the
// colour picker recolours it, the toolbar pans the viewport - and every one of
// those is a change to the graph that the file it came from now disagrees
// with.
//
// This closes that loop. Given the compilation a graph was built from, the
// graph as the calculator handed it back at that moment, and the graph now, it
// works out which expressions actually changed and writes each of them back
// over the characters of the statement that produced it.
//
// **The unit is the statement, never the file.** Decompiling the whole graph
// and writing that out would be far simpler and would throw away everything a
// file has that a graph does not: the comments, the blank lines, the macros,
// the styles, the folders an import stands for, the order somebody chose. So an
// edit here is a span and its replacement, and a statement nobody touched is
// not in the output at all.
//
// **The change is merged, never taken whole.** A statement is re-read from the
// source, the properties that differ between the two readings of the graph are
// rewritten on it, and everything else stays the node the author wrote - their
// brackets, their `use:` of a style, their property order, the slider bound
// Desmos did not bother to hand back because it matched its own default. Then
// the statement is printed over exactly its own span, which is why statements
// sharing a line through `;` are each as writable as one on a line of its own.
//
// **What cannot be written is said rather than done.** A statement a macro
// expanded into, one in a file this one imports, a graph that is moving by
// itself - each of those is reported as a skipped change with a reason.
// Silently dropping a change the user made with their own hands is the one
// outcome worth ruling out; quietly writing the wrong thing is the other.

import type {
    CalculatorOptions,
    DesmosExpression,
    GraphState,
    Table,
    TickerState,
} from '@axis-dsl/desmos';
import {
    AXIS_GRAPH_PROPERTY_NAMES,
    AXIS_MANIFEST,
    AXIS_STATE_PROPERTY_NAMES,
    AXIS_VIEWPORT_PROPERTY_NAMES,
    type ConfigStatement,
    type Diagnostic,
    type FolderStatement,
    lex,
    type Metadata,
    parse,
    printStatement,
    type PropertyPlacement,
    sameTree,
    type Span,
    type Statement,
    type StringLiteral,
    type TableColumn,
    type TableStatement,
    type TickerStatement,
} from '@axis-dsl/syntax';
import type { CompilationResult, StatementOrigin } from './compile';
import { decompileExpression, decompileSettings, decompileTicker } from './decompile';
import {
    applyPropertyWrites,
    applyWrites,
    cellValues,
    importAliasFor,
    mergeExpression,
    propertyWrites,
    stringNode,
} from './readback';

/**
 * A graph as the calculator holds it: `calculator.getState()`, and the live
 * `calculator.settings` beside it - the same two halves a compilation is
 * applied as.
 */
export interface GraphSnapshot {
    state: GraphState;
    options?: CalculatorOptions;
}

/**
 * What happened between two snapshots: an expression changed, appeared or
 * went; the settings or the viewport moved; the ticker changed.
 */
export type ChangeKind = 'changed' | 'added' | 'removed' | 'settings' | 'ticker';

/** One change to a graph, before anything has been decided about writing it. */
export interface GraphChange {
    kind: ChangeKind;
    /** The expression's id, for the three kinds that are about one. */
    id?: string;
    /** The expression as it was, absent for one that was added. */
    before?: DesmosExpression;
    /** The expression as it is now, absent for one that was removed. */
    after?: DesmosExpression;
}

/**
 * A replacement of characters in one file: `[span.start, span.end)` becomes
 * `text`. An insertion has an empty span, a deletion an empty text.
 */
export interface SourceEdit {
    path: string;
    span: Span;
    text: string;
    /** The change this edit carries out, for a host that wants to explain it. */
    change: GraphChange;
}

/** A change that was seen and deliberately not written, or not all of it. */
export interface SkippedChange {
    change: GraphChange;
    reason: string;
}

export interface WriteBackOptions {
    /**
     * Which kinds of change to take. Left out, all of them are.
     *
     * Worth setting: `settings` fires on every pan and zoom, which is a change
     * to the graph but rarely one somebody meant to make to their file.
     */
    include?: Partial<Record<ChangeKind, boolean>>;
    /**
     * One level of block indentation. Read off the file where it indents
     * anything, and four spaces, as the formatter writes it, where it does not.
     */
    indent?: string;
    /** The file's path, as it was compiled with, for the edits to carry. */
    path?: string;
}

export interface WriteBackResult {
    /**
     * The edits to make to the file, ordered so they can be applied one
     * after another without re-counting: latest in the file first.
     */
    edits: SourceEdit[];
    /** Changes that were seen but not written, each with why. */
    skipped: SkippedChange[];
}

/**
 * The changes between two snapshots of the same graph, as edits to `source`.
 *
 * `source` is the file `compilation` was compiled from - its spans are what
 * say where each statement is. `before` is the graph the calculator handed
 * back immediately after the compilation was applied to it, rather than the
 * compilation itself. That matters: Desmos normalises what it is given -
 * dropping a bound that matches its own default, writing a switched-off
 * clickable by leaving `enabled` off - so comparing against what was sent
 * would report a change on every expression the moment the graph loaded.
 */
export function writeBackGraph(
    source: string,
    { before, after }: { before: GraphSnapshot; after: GraphSnapshot },
    compilation: CompilationResult,
    options: WriteBackOptions = {},
): WriteBackResult {
    const writer = new Writer(source, before, after, compilation, options);
    const wanted = (kind: ChangeKind) => options.include?.[kind] ?? true;
    const changes = diffGraphs(before, after).filter(change => wanted(change.kind));

    // Additions are handled together, since a folder made in the calculator
    // arrives as one change and everything put into it as others.
    const added = changes.filter(change => change.kind === 'added');
    for (const change of changes) {
        switch (change.kind) {
            case 'changed':
                writer.changed(change);
                break;
            case 'removed':
                writer.removed(change);
                break;
            case 'settings':
                writer.settings(change);
                break;
            case 'ticker':
                writer.ticker(change);
                break;
        }
    }
    writer.added(added);

    return writer.result();
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
    const was = new Map(listOf(before).map(expression => [expression.id, expression]));
    const now = new Map(listOf(after).map(expression => [expression.id, expression]));

    for (const [id, expression] of now) {
        const previous = was.get(id);
        if (!previous) {
            changes.push({ kind: 'added', id, after: expression });
        } else if (!same(previous, expression)) {
            changes.push({ kind: 'changed', id, before: previous, after: expression });
        }
    }

    for (const [id, expression] of was) {
        if (!now.has(id)) {
            changes.push({ kind: 'removed', id, before: expression });
        }
    }

    if (CONFIG_NAMES.some(name => !same(configValue(before, name), configValue(after, name)))) {
        changes.push({ kind: 'settings' });
    }

    if (!same(tickerOf(before), tickerOf(after))) {
        changes.push({ kind: 'ticker' });
    }

    return changes;
}

/**
 * Apply edits to the text of the file they are for. The order is the one
 * {@link WriteBackResult.edits} comes in: latest first, so no edit moves the
 * characters a later one is about.
 */
export function applySourceEdits(source: string, edits: readonly SourceEdit[]): string {
    let text = source;
    for (const edit of edits) {
        text = text.slice(0, edit.span.start) + edit.text + text.slice(edit.span.end);
    }
    return text;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading snapshots
// ─────────────────────────────────────────────────────────────────────────────

const listOf = (snapshot: GraphSnapshot): DesmosExpression[] =>
    snapshot.state.expressions?.list ?? [];

/** A ticker that exists, or nothing: Desmos reads one with no handler as none. */
function tickerOf(snapshot: GraphSnapshot): TickerState | undefined {
    const ticker = snapshot.state.expressions?.ticker;
    return ticker?.handlerLatex ? ticker : undefined;
}

const CONFIG_NAMES = AXIS_MANIFEST.configProperties.map(property => property.name);
const VIEWPORT = new Set<string>(AXIS_VIEWPORT_PROPERTY_NAMES);
const GRAPH = new Set<string>(AXIS_GRAPH_PROPERTY_NAMES);
const STATE_FLAGS = new Set<string>(AXIS_STATE_PROPERTY_NAMES);

/**
 * A config property's value on a live graph, read from wherever Desmos keeps
 * it: the viewport and a few others in the state, a couple of flags on the top
 * of the state, and everything else in the calculator's options.
 */
function configValue(snapshot: GraphSnapshot, name: string): unknown {
    const graph = snapshot.state.graph as Record<string, unknown> | undefined;
    if (VIEWPORT.has(name)) {
        return (graph?.viewport as Record<string, unknown> | undefined)?.[name];
    }
    if (GRAPH.has(name)) return graph?.[name];
    if (STATE_FLAGS.has(name)) return snapshot.state[name];
    return (snapshot.options as Record<string, unknown> | undefined)?.[name];
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

// ─────────────────────────────────────────────────────────────────────────────
// The writer
// ─────────────────────────────────────────────────────────────────────────────

/** A statement found in the source, with where it sits. */
interface Located {
    statement: Statement;
    /** How many blocks it is inside: 0 at the top of the file. */
    depth: number;
}

/**
 * A statement rebuilt, ready to be printed over the one it replaces, with
 * anything about the change it could not say - or why there is no statement.
 */
type Rebuilt = { statement: Statement; notes: string[] } | { reason: string };

/** A graph item, or a table column, as a bag of keys. */
type Item = Record<string, unknown>;

class Writer {
    private readonly edits: SourceEdit[] = [];
    private readonly skipped: SkippedChange[] = [];
    private readonly statements = new Map<string, Located>();
    private readonly top: Statement[];
    private readonly imports: ReadonlySet<string>;
    private readonly unit: string;
    private readonly path: string;
    /** Folders the calculator no longer has, whose contents went with them. */
    private readonly removedFolders = new Set<string>();

    constructor(
        private readonly source: string,
        private readonly before: GraphSnapshot,
        private readonly after: GraphSnapshot,
        private readonly compilation: CompilationResult,
        options: WriteBackOptions,
    ) {
        const tree = parse(source);
        this.top = tree.file.statements;
        const visit = (statements: readonly Statement[], depth: number) => {
            for (const statement of statements) {
                this.statements.set(key(statement.span), { statement, depth });
                if (statement.kind === 'FolderStatement') visit(statement.body, depth + 1);
            }
        };
        visit(this.top, 0);

        this.imports = new Set(compilation.dependencies.imports);
        this.unit = options.indent ?? /^([ \t]+)\S/m.exec(source)?.[1] ?? '    ';
        this.path =
            options.path ??
            [...compilation.sourceMap.values()].find(origin => !this.imports.has(origin.path))
                ?.path ??
            compilation.configOrigin?.path ??
            '';

        for (const expression of listOf(before)) {
            if (expression.type === 'folder' && !listOf(after).some(e => e.id === expression.id)) {
                this.removedFolders.add(expression.id!);
            }
        }
    }

    result(): WriteBackResult {
        // A statement deleted with the folder it was in is deleted with it, so
        // an edit inside the folder's span would be an edit to text that is
        // no longer there.
        const removals = this.edits.filter(edit => edit.change.kind === 'removed');
        const edits = this.edits.filter(
            edit =>
                !removals.some(
                    removal =>
                        removal !== edit &&
                        removal.span.start <= edit.span.start &&
                        edit.span.end <= removal.span.end &&
                        removal.span.end - removal.span.start > edit.span.end - edit.span.start,
                ),
        );

        // Latest first, so each edit leaves the characters before it where
        // they were. Two insertions at one place go in the order they were
        // made, which applying the later one first is what gives.
        const ordered = edits
            .map((edit, index) => ({ edit, index }))
            .sort(
                (a, b) =>
                    b.edit.span.start - a.edit.span.start ||
                    b.edit.span.end - a.edit.span.end ||
                    b.index - a.index,
            )
            .map(({ edit }) => edit);

        return { edits: ordered, skipped: this.skipped };
    }

    // ── Changed ──────────────────────────────────────────────────────────────

    changed(change: GraphChange): void {
        // A graph that is moving by itself is not a graph anybody is editing.
        //
        // A playing slider changes its own value several times a second and a
        // running ticker changes whatever it drives, so writing either back
        // means a file that rewrites itself for as long as the tab is open -
        // hundreds of edits nobody made. The animation is the graph working,
        // not somebody changing it. What a tick assigns to is an action written
        // in latex, and working out which expressions it reaches is not worth
        // half-doing here: a graph whose ticker runs is a graph running.
        const animated = this.animating(change);
        if (animated) return this.skip(change, animated);

        const found = this.origin(change.id!);
        if ('reason' in found) return this.skip(change, found.reason);
        const { origin, located } = found;
        if (!origin.writable) {
            return this.skip(change, origin.reason ?? 'this statement cannot be rewritten');
        }

        const was = change.before!;
        const now = change.after!;
        if ((was as Item).folderId !== (now as Item).folderId) {
            return this.skip(change, 'moving an expression between folders is not written back');
        }

        // Rewritten from the statement's own tree with the change laid over
        // it, rather than from what the calculator handed back. Those are not
        // the same thing: Desmos leaves a property off the state when it
        // matches its own default, so a slider written `0..10` comes back
        // carrying only the min - and rewriting from that would quietly take
        // the max out of somebody's file as the price of dragging it.
        const rebuilt = this.rebuild(located.statement, was, now);
        if ('reason' in rebuilt) return this.skip(change, rebuilt.reason);
        for (const note of rebuilt.notes) this.skip(change, note);

        // A folder is rewritten up to its `{` and its own metadata, and not
        // one character into its body: its statements are their own.
        if (rebuilt.statement.kind === 'FolderStatement') {
            return this.folderHeader(change, located, rebuilt.statement);
        }

        const printed = this.print(rebuilt.statement, origin.span, located.depth);
        if (typeof printed !== 'string') return this.skip(change, printed.reason);
        this.replace(origin.span, printed, change);
    }

    /** Why this change is the graph animating rather than an edit, or null. */
    private animating(change: GraphChange): string | null {
        if (tickerOf(this.after)?.playing) {
            return 'the ticker is running — pause it to edit from the graph';
        }
        if (tickerOf(this.before)?.playing) {
            return 'the ticker has been running since the graph was loaded, so this may be its doing — edit the file to take a fresh reading';
        }
        const slider = (change.after as { slider?: { isPlaying?: boolean } } | undefined)?.slider;
        if (slider?.isPlaying) {
            return 'this slider is animating — pause it to edit from the graph';
        }
        return null;
    }

    /**
     * A statement with the difference between two readings of it written in.
     *
     * Both readings are decompiled - the decompiler is the one place that
     * knows what a graph item says as Axis - and it is the difference between
     * the two statements that is merged onto the author's, part by part.
     */
    private rebuild(statement: Statement, was: DesmosExpression, now: DesmosExpression): Rebuilt {
        if (statement.kind === 'TableStatement') {
            return this.table(statement, was as Table, now as Table);
        }

        const before = decompileExpression(was);
        const after = decompileExpression(now);
        const notes = problems(before.diagnostics, after.diagnostics);
        const b = before.statement;
        const a = after.statement;
        if (!a || !b) {
            return {
                reason:
                    after.diagnostics[0]?.message ??
                    before.diagnostics[0]?.message ??
                    'an empty expression has no statement to write',
            };
        }
        if (
            statement.kind === 'ImageStatement' &&
            (was as Item).image_url !== (now as Item).image_url
        ) {
            // The source is the one thing never taken from the graph. A
            // picture named by path was read off a disk and inlined as a
            // `data:` URI before the graph existed, so the graph carries the
            // bytes and has no memory of the path - and writing its URL back
            // would put the whole picture, base64'd, where the filename was.
            notes.push(unknownReason(['image_url']));
        }
        // A key whose change alone leaves the reading as it was is one no
        // Axis property says. The rest of the change is still written.
        const unsaid = changedKeys(was, now).filter(key => {
            const alone = decompileExpression({
                ...was,
                [key]: (now as Item)[key],
            } as DesmosExpression);
            return alone.statement !== null && sameTree(alone.statement, b);
        });
        if (unsaid.length > 0) notes.push(unknownReason(unsaid));
        if (sameTree(a, b)) {
            return { reason: notes[0] ?? unknownReason(changedKeys(was, now)) };
        }

        if (
            statement.kind === 'ExpressionStatement' &&
            b.kind === 'ExpressionStatement' &&
            a.kind === 'ExpressionStatement'
        ) {
            const expression = mergeExpression(statement.expression, b.expression, a.expression);
            const metadata = this.merged('expression', statement, b.metadata, a.metadata);
            return { statement: { ...statement, expression, metadata }, notes };
        }
        if (
            statement.kind === 'NoteStatement' &&
            b.kind === 'NoteStatement' &&
            a.kind === 'NoteStatement'
        ) {
            const text: StringLiteral =
                b.text.value === a.text.value
                    ? statement.text
                    : { ...stringNode(a.text.value), span: statement.text.span };
            const metadata = this.merged('note', statement, b.metadata, a.metadata);
            return { statement: { ...statement, text, metadata }, notes };
        }
        if (
            statement.kind === 'ImageStatement' &&
            b.kind === 'ImageStatement' &&
            a.kind === 'ImageStatement'
        ) {
            const metadata = this.merged('image', statement, b.metadata, a.metadata);
            return { statement: { ...statement, metadata }, notes };
        }
        if (b.kind === 'FolderStatement' && a.kind === 'FolderStatement') {
            const renamed = !sameTree(b.title, a.title);
            if (statement.kind === 'FolderStatement') {
                const title = renamed ? a.title : statement.title;
                const metadata = this.merged('folder', statement, b.metadata, a.metadata);
                return { statement: { ...statement, title, metadata }, notes };
            }
            if (statement.kind === 'ImportStatement') {
                // The folder an import stands for is titled by its `as`, or
                // by the file when it has none.
                const alias = renamed
                    ? importAliasFor(a.title?.value, statement.path.value)
                    : statement.alias;
                const metadata = this.merged('import', statement, b.metadata, a.metadata);
                return { statement: { ...statement, alias, metadata }, notes };
            }
        }

        return { reason: 'this statement is not one a graph item is written from' };
    }

    /** A statement's metadata with the properties the two readings disagree on rewritten. */
    private merged(
        placement: PropertyPlacement,
        statement: { metadata: Metadata | null; span: Span },
        before: Metadata | null,
        after: Metadata | null,
    ): Metadata | null {
        const writes = propertyWrites(
            placement,
            before?.entries ?? [],
            after?.entries ?? [],
            statement.metadata?.entries ?? [],
        );
        return applyPropertyWrites(statement.metadata, writes, statement.span.end, this.source);
    }

    /**
     * A table, column by column. The columns are matched to the statement's by
     * position among the ones the table had, and to each other by id - so a
     * column added in the calculator is new, one deleted there goes, and a cell
     * edited in one rewrites that cell and no other.
     */
    private table(statement: TableStatement, was: Table, now: Table): Rebuilt {
        if (statement.columns.length !== was.columns.length) {
            return { reason: "this table's columns do not line up with its statement" };
        }

        const columns: TableColumn[] = [];
        const notes: string[] = [];
        const unsaid = Object.keys({ ...was, ...now }).filter(
            key =>
                !['type', 'id', 'folderId', 'columns'].includes(key) &&
                !same((was as unknown as Item)[key], (now as unknown as Item)[key]),
        );
        if (unsaid.length > 0) notes.push(unknownReason(unsaid));

        for (const column of now.columns) {
            // A blank among a column's cells is something a list cannot hold;
            // the decompiler writes one as `0 / 0`, which is not the blank the
            // graph has, so it is refused here rather than written wrong.
            const cells = cellValues(column.values ?? []);
            if (cells.some(cell => cell.trim() === '')) {
                return { reason: 'a table cell left empty has no Axis spelling' };
            }

            const after = decompiledColumn(now, column);
            if ('reason' in after) return after;
            notes.push(...after.notes);

            const index = was.columns.findIndex(candidate => candidate.id === column.id);
            if (index < 0) {
                columns.push(after.column);
                continue;
            }

            const before = decompiledColumn(was, was.columns[index]);
            if ('reason' in before) return before;
            const written = statement.columns[index];
            const [b, a] = [before.column, after.column];

            let values = written.values;
            if (!same(was.columns[index].values, column.values)) {
                values = a.values
                    ? a.values.map((value, at) =>
                          mergeExpression(written.values?.[at], b.values?.[at], value),
                      )
                    : null;
            }

            columns.push({
                ...written,
                header: mergeExpression(written.header, b.header, a.header),
                values,
                metadata: this.merged('column', written, b.metadata, a.metadata),
            });
        }

        return { statement: { ...statement, columns }, notes: [...new Set(notes)] };
    }

    /** A folder's `folder "Title" { @ …` rewritten, and its body left alone. */
    private folderHeader(change: GraphChange, located: Located, folder: FolderStatement): void {
        const original = located.statement as FolderStatement;
        const open = this.openBrace(original);
        if (open < 0) return this.skip(change, 'this folder has no `{`');
        const end = original.metadata ? original.metadata.span.end : open + 1;

        let text = printStatement(
            { ...folder, metadata: null, body: [] },
            { level: located.depth, indent: this.unit },
        ).replace(/\}$/, '');
        if (folder.metadata) {
            text += ` ${this.printMetadata(folder.metadata, located.depth)}`;
            // Metadata straight after the `{` has to be ended before the first
            // statement, which a folder written on one line has not done.
            if (!original.metadata && !/^[ \t]*(\r?\n|;|\}|\/\/)/.test(this.source.slice(end))) {
                text += ';';
            }
        }

        this.replace({ start: original.span.start, end }, text, change);
    }

    // ── Removed ──────────────────────────────────────────────────────────────

    removed(change: GraphChange): void {
        const folderId = (change.before as { folderId?: string } | undefined)?.folderId;

        // Deleted with its folder, which is one edit for the lot.
        if (folderId !== undefined && this.removedFolders.has(folderId)) {
            const folder = this.compilation.sourceMap.get(folderId);
            if (folder && !this.imports.has(folder.path)) return;
        }

        const found = this.origin(change.id!);
        if ('reason' in found) return this.skip(change, found.reason);

        // Unlike a rewrite, a deletion needs nothing the graph holds, so a
        // statement a macro expanded into can go as well as any other.
        this.replace(removalSpan(this.source, found.origin.span), '', change);
    }

    // ── Added ────────────────────────────────────────────────────────────────

    added(changes: readonly GraphChange[]): void {
        const folders = new Set(
            changes.filter(change => change.after?.type === 'folder').map(change => change.id!),
        );
        const members = new Map<string, Statement[]>();
        const pending: { change: GraphChange; statement: Statement }[] = [];

        // Members first, so a folder made in the calculator is written with
        // what was put in it.
        for (const change of changes) {
            const item = change.after!;
            const folderId = (item as { folderId?: string }).folderId;
            if (item.type === 'folder') continue;

            const statement = this.made(change, item);
            if (!statement) continue;

            if (folderId !== undefined && folders.has(folderId)) {
                members.set(folderId, [...(members.get(folderId) ?? []), statement]);
            } else if (folderId !== undefined) {
                this.intoFolder(change, folderId, statement);
            } else {
                pending.push({ change, statement });
            }
        }

        for (const change of changes) {
            if (change.after?.type !== 'folder') continue;
            const statement = this.made(change, change.after);
            if (statement?.kind === 'FolderStatement') {
                pending.push({
                    change,
                    statement: { ...statement, body: members.get(change.id!) ?? [] },
                });
            }
        }

        // Everything with no folder of its own goes on the end of the file,
        // which is the one placement that is always right and never a guess
        // about where it belonged - in the order the graph lists it.
        const order = new Map(listOf(this.after).map((item, index) => [item.id, index]));
        pending.sort((a, b) => (order.get(a.change.id) ?? 0) - (order.get(b.change.id) ?? 0));
        for (const { change, statement } of pending) {
            this.append(statement, change);
        }
    }

    /**
     * The statement a new item is written as - the decompiler's - or nothing,
     * with the reason reported.
     */
    private made(change: GraphChange, item: DesmosExpression): Statement | null {
        // A picture added in the calculator arrives as its own bytes, and a
        // file has no statement meaning "these bytes" - only ones that name
        // a file or a URL. Writing it out would put the whole picture,
        // base64'd, into somebody's source.
        if (item.type === 'image' && /^data:/i.test(item.image_url ?? '')) {
            this.skip(
                change,
                'add this picture to the project and draw it with `image`, to give it a name',
            );
            return null;
        }
        const { statement, diagnostics } = decompileExpression(item);
        for (const diagnostic of diagnostics) this.skip(change, diagnostic.message);
        if (!statement && diagnostics.length === 0) {
            this.skip(change, 'an empty expression has no statement to write');
        }
        return statement;
    }

    /** A new statement written at the end of the folder it was made in. */
    private intoFolder(change: GraphChange, folderId: string, statement: Statement): void {
        const found = this.origin(folderId);
        if ('reason' in found) {
            return this.skip(
                change,
                this.compilation.sourceMap.has(folderId)
                    ? found.reason
                    : 'this expression is in a folder that is not in this file',
            );
        }
        const { located } = found;
        if (located.statement.kind === 'ImportStatement') {
            return this.skip(
                change,
                'this expression is in the folder an import stands for, and that is the imported file',
            );
        }
        if (located.statement.kind !== 'FolderStatement') {
            return this.skip(change, 'this expression is in a folder that is not in this file');
        }

        const folder = located.statement;
        const depth = located.depth + 1;
        const printed = printStatement(statement, { level: depth, indent: this.unit });
        const open = this.openBrace(folder);
        const close = folder.span.end - 1;

        if (this.source.slice(open, close).includes('\n')) {
            // Spread over lines: on a line of its own before the `}`.
            const lineStart = this.source.lastIndexOf('\n', close - 1) + 1;
            const margin = this.unit.repeat(depth);
            if (/^[ \t]*$/.test(this.source.slice(lineStart, close))) {
                this.insert(lineStart, `${margin}${printed}\n`, change);
            } else {
                this.insert(
                    close,
                    `\n${margin}${printed}\n${this.unit.repeat(located.depth)}`,
                    change,
                );
            }
            return;
        }

        // On one line, it stays on one: another entry after the last.
        const last = folder.body[folder.body.length - 1];
        const anchor = last?.span.end ?? folder.metadata?.span.end;
        if (anchor !== undefined) {
            this.insert(anchor, `; ${printed}`, change);
        } else {
            this.insert(open + 1, ` ${printed}${this.source[open + 1] === '}' ? ' ' : ''}`, change);
        }
    }

    /** A new top-level statement, on the end of the file. */
    private append(statement: Statement, change: GraphChange): void {
        const printed = printStatement(statement, { indent: this.unit });
        const end = this.source.length;
        if (this.source.trim() === '' || this.source.endsWith('\n')) {
            this.insert(end, `${printed}\n`, change);
        } else {
            this.insert(end, `\n${printed}`, change);
        }
    }

    // ── Settings ─────────────────────────────────────────────────────────────

    /**
     * The settings that changed, written into the file's own `config`
     * block - or into one opened at the top for them.
     *
     * The viewport is written only for a file that names one. Panning and
     * zooming are how anybody reads a graph, and they change the viewport
     * constantly; a file that says nothing about its framing was written by
     * somebody who did not care about it, and four `xmin`-and-friends lines
     * appearing the first time they scrolled would be the feature writing
     * something nobody asked for. A file that does name a viewport has an
     * author who cares where the graph sits, and for them a pan is an edit.
     */
    settings(change: GraphChange): void {
        const origin = this.compilation.configOrigin;
        let config: ConfigStatement | undefined;
        if (origin) {
            const located = this.statements.get(key(origin.span));
            if (located?.statement.kind !== 'ConfigStatement') {
                return this.skip(change, 'the file has changed since this graph was compiled');
            }
            config = located.statement;
        }

        const entries = config?.entries ?? [];
        const framed = entries.some(entry => VIEWPORT.has(entry.key.name));
        const all = propertyWrites(
            'config',
            decompileSettings(this.before)?.entries ?? [],
            decompileSettings(this.after)?.entries ?? [],
            entries,
        );
        const writes = all.filter(write => framed || !VIEWPORT.has(write.name));

        if (writes.length === 0) {
            if (all.length > 0) {
                this.skip(change, 'the viewport moved, and this file does not set one');
            }
            return;
        }

        if (config && origin) {
            const updated: ConfigStatement = {
                ...config,
                entries: applyWrites(config.entries, writes, config.span.end - 1, this.source),
            };
            const printed = this.print(updated, origin.span, 0);
            if (typeof printed !== 'string') return this.skip(change, printed.reason);
            return this.replace(origin.span, printed, change);
        }

        // A file with no config block gets one at the very top, which is
        // where every example keeps it.
        const created: ConfigStatement = {
            kind: 'ConfigStatement',
            entries: applyWrites([], writes, 0),
            span: { start: 0, end: 0 },
        };
        const printed = printStatement(created, { indent: this.unit });
        this.insert(0, this.source.trim() === '' ? `${printed}\n` : `${printed}\n\n`, change);
    }

    // ── The ticker ───────────────────────────────────────────────────────────

    /**
     * The ticker, written back into the file's `ticker` statement. Its own
     * running is the one change refused: a ticker started from the graph is
     * the graph being played with, and it is what makes everything else in it
     * move.
     */
    ticker(change: GraphChange): void {
        const was = tickerOf(this.before);
        const now = tickerOf(this.after);
        if (now?.playing) {
            return this.skip(change, 'the ticker is running — pause it to edit from the graph');
        }

        const statement = this.top.find(
            (candidate): candidate is TickerStatement => candidate.kind === 'TickerStatement',
        );
        const after = now && decompileTicker(now);
        for (const diagnostic of after?.diagnostics ?? []) this.skip(change, diagnostic.message);

        if (!statement) {
            if (was) {
                return this.skip(change, 'the ticker is written in a file this one imports');
            }
            if (after?.statement) this.append(after.statement, change);
            return;
        }

        if (!now) {
            return this.replace(removalSpan(this.source, statement.span), '', change);
        }
        const a = after?.statement;
        const b = was && decompileTicker(was).statement;
        if (!a) return;

        const handler = mergeExpression(statement.handler, b?.handler, a.handler);
        const metadata = this.merged('ticker', statement, b?.metadata ?? null, a.metadata);
        const printed = this.print({ ...statement, handler, metadata }, statement.span, 0);
        if (typeof printed !== 'string') return this.skip(change, printed.reason);
        this.replace(statement.span, printed, change);
    }

    // ── Shared ───────────────────────────────────────────────────────────────

    /**
     * Where an expression was written, and the statement found there - or why
     * there is nothing here to write it to.
     */
    private origin(id: string): { origin: StatementOrigin; located: Located } | { reason: string } {
        const origin = this.compilation.sourceMap.get(id);
        if (!origin) {
            return { reason: 'this expression was not compiled from this file' };
        }
        if (this.imports.has(origin.path)) {
            // Only the file handed over is edited. Another file's statement
            // is somebody else's source, and possibly several files'.
            return { reason: `this is written in ${origin.path}, which this file imports` };
        }
        const located = this.statements.get(key(origin.span));
        if (!located) {
            return { reason: 'the file has changed since this graph was compiled' };
        }
        return { origin, located };
    }

    /**
     * A statement as text, ready to go over `span`.
     *
     * Printed against the source it came from, so a bracket the author spread
     * over lines stays spread and a block's comments stay where they were. The
     * printer keeps a statement holding a comment it cannot place exactly as
     * it was written - which here would silently throw the change away - so
     * what it prints is read back, and must be the statement asked for.
     */
    private print(statement: Statement, span: Span, depth: number): string | { reason: string } {
        const options = { level: depth, indent: this.unit };
        const printed = printStatement(statement, { ...options, source: this.source });
        if (readsAs(printed, statement)) return printed;

        const hasComment = lex(this.source.slice(span.start, span.end)).tokens.some(
            token => token.kind === 'comment',
        );
        if (hasComment) {
            return { reason: 'a comment inside this statement would be lost by rewriting it' };
        }
        const fresh = printStatement(statement, options);
        if (readsAs(fresh, statement)) return fresh;
        return { reason: 'this statement could not be written back as it is now' };
    }

    /** Metadata as `@ …` or `@{ … }`, printed the way it would trail a statement. */
    private printMetadata(metadata: Metadata, depth: number): string {
        const printed = printStatement(
            { kind: 'NoteStatement', text: stringNode(''), metadata, span: { start: 0, end: 0 } },
            { level: depth, indent: this.unit },
        );
        return printed.slice('"" '.length);
    }

    /** Where a block statement's `{` is: the first after its keyword and title. */
    private openBrace(folder: FolderStatement): number {
        const from = folder.title ? folder.title.span.end : folder.span.start;
        return this.source.indexOf('{', from);
    }

    private replace(span: Span, text: string, change: GraphChange): void {
        if (this.source.slice(span.start, span.end) === text) return;
        this.edits.push({
            path: this.path,
            span: { start: span.start, end: span.end },
            text,
            change,
        });
    }

    private insert(at: number, text: string, change: GraphChange): void {
        this.edits.push({ path: this.path, span: { start: at, end: at }, text, change });
    }

    private skip(change: GraphChange, reason: string): void {
        this.skipped.push({ change, reason });
    }
}

const key = (span: Span) => `${span.start}:${span.end}`;

/**
 * One column of a table, decompiled on its own - so a column whose header
 * cannot be read is that column's problem, and the rest stay lined up.
 */
function decompiledColumn(
    table: Table,
    column: Table['columns'][number],
): { column: TableColumn; notes: string[] } | { reason: string } {
    const { statement, diagnostics } = decompileExpression({ ...table, columns: [column] });
    const read = statement?.kind === 'TableStatement' ? statement.columns[0] : undefined;
    if (!read) {
        return { reason: diagnostics[0]?.message ?? 'a column of this table cannot be read' };
    }
    return { column: read, notes: diagnostics.map(diagnostic => diagnostic.message) };
}

/** What the decompiler could not say about `after` that it could about `before`. */
function problems(before: readonly Diagnostic[], after: readonly Diagnostic[]): string[] {
    const known = new Set(before.map(diagnostic => diagnostic.message));
    return after.map(diagnostic => diagnostic.message).filter(message => !known.has(message));
}

/** The keys of an item that differ between two readings of it. */
function changedKeys(was: DesmosExpression, now: DesmosExpression): string[] {
    const [a, b] = [was as unknown as Item, now as unknown as Item];
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
        key => !same(a[key], b[key]),
    );
}

/** Whether `text` parses back as exactly `statement`, layout aside. */
function readsAs(text: string, statement: Statement): boolean {
    const tree = parse(text);
    if (tree.diagnostics.some(diagnostic => diagnostic.severity === 'error')) return false;
    const [read, ...rest] = tree.file.statements;
    return read !== undefined && rest.length === 0 && sameTree(read, statement);
}

/**
 * The characters to delete to take a statement out.
 *
 * A statement alone on its lines takes the lines with it, and the comment on
 * the end of its last line, which was about it. One sharing a line through `;`
 * takes its separator, whichever side it is on, and leaves its neighbours.
 */
function removalSpan(source: string, span: Span): Span {
    const lineStart = source.lastIndexOf('\n', span.start - 1) + 1;
    const newline = source.indexOf('\n', span.end);
    const lineEnd = newline < 0 ? source.length : newline;
    const leading = source.slice(lineStart, span.start);
    const trailing = source.slice(span.end, lineEnd);

    if (/^[ \t]*$/.test(leading) && /^[ \t]*(\/\/.*)?\r?$/.test(trailing)) {
        if (newline >= 0) return { start: lineStart, end: newline + 1 };
        // The last line of the file: the newline before it goes instead.
        return { start: Math.max(0, lineStart - 1), end: source.length };
    }

    const after = /^[ \t]*;[ \t]*/.exec(trailing);
    if (after) return { start: span.start, end: span.end + after[0].length };
    const before = /[ \t]*;[ \t]*$/.exec(leading);
    if (before) return { start: span.start - before[0].length, end: span.end };
    return span;
}

function unknownReason(keys: readonly string[]): string {
    return keys.length === 1
        ? `\`${keys[0]}\` changed, and no Axis property says it, so it stays in the graph only`
        : `${list(keys)} changed, and no Axis property says them, so they stay in the graph only`;
}

function list(names: readonly string[]): string {
    return names.map(name => `\`${name}\``).join(', ');
}
