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
// graph as the calculator handed it back at that moment, and the graph now, it
// works out which expressions actually changed and writes each of them back
// over the characters of the statement that produced it.
//
// **The unit is the statement, never the file.** Decompiling the whole graph
// and writing that out would be far simpler and would throw away everything a
// script has that a graph does not: the comments, the blank lines, the macros,
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
// expanded into, one in a file this script imports, a graph that is moving by
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
    type Expression,
    type FolderStatement,
    lex,
    type Metadata,
    parse,
    printStatement,
    sameTree,
    type Span,
    type Statement,
    type StringLiteral,
    type TableColumn,
    type TableStatement,
    type TickerStatement,
} from '@axis-dsl/syntax';
import type { CompilationResult, StatementOrigin } from './compile';
import {
    applyPropertyWrites,
    applyWrites,
    cellValues,
    columnFor,
    configNode,
    importAliasFor,
    type Item,
    latexNode,
    mergeExpression,
    metadataFor,
    propertyWrites,
    type PropertyWrite,
    type ReadbackPlacement,
    statementFor,
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
     * to the graph but rarely one somebody meant to make to their script.
     */
    include?: Partial<Record<ChangeKind, boolean>>;
    /**
     * One level of block indentation. Read off the script where it indents
     * anything, and four spaces, as the formatter writes it, where it does not.
     */
    indent?: string;
    /** The script's path, as it was compiled with, for the edits to carry. */
    path?: string;
}

export interface WriteBackResult {
    /**
     * The edits to make to the script, ordered so they can be applied one
     * after another without re-counting: latest in the file first.
     */
    edits: SourceEdit[];
    /** Changes that were seen but not written, each with why. */
    skipped: SkippedChange[];
}

/**
 * The changes between two snapshots of the same graph, as edits to `source`.
 *
 * `source` is the script `compilation` was compiled from - its spans are what
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

/** A statement rebuilt, ready to be printed over the one it replaces. */
type Rebuilt = { statement: Statement; unknown: string[] } | { reason: string };

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
        // hundreds of edits nobody made. The animation is the script working,
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

        const was = change.before as unknown as Item;
        const now = change.after as unknown as Item;
        if (was.folderId !== now.folderId) {
            return this.skip(change, 'moving an expression between folders is not written back');
        }

        // Rewritten from the statement's own tree with the change laid over
        // it, rather than from what the calculator handed back. Those are not
        // the same thing: Desmos leaves a property off the state when it
        // matches its own default, so a slider written `0..10` comes back
        // carrying only the min - and rewriting from that would quietly take
        // the max out of somebody's script as the price of dragging it.
        let rebuilt: Rebuilt;
        try {
            rebuilt = this.rebuild(located.statement, was, now);
        } catch (error) {
            rebuilt = {
                reason: `Desmos holds latex Axis cannot read: ${(error as Error).message}`,
            };
        }
        if ('reason' in rebuilt) return this.skip(change, rebuilt.reason);

        if (rebuilt.unknown.length > 0) {
            this.skip(change, unknownReason(rebuilt.unknown));
        }

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
            return 'the ticker has been running since the graph was loaded, so this may be its doing — edit the script to take a fresh reading';
        }
        const slider = (change.after as { slider?: { isPlaying?: boolean } } | undefined)?.slider;
        if (slider?.isPlaying) {
            return 'this slider is animating — pause it to edit from the graph';
        }
        return null;
    }

    /** A statement with the difference between two readings of it written in. */
    private rebuild(statement: Statement, was: Item, now: Item): Rebuilt {
        switch (statement.kind) {
            case 'ExpressionStatement': {
                let expression = statement.expression;
                if (was.latex !== now.latex) {
                    if (typeof now.latex !== 'string' || now.latex.trim() === '') {
                        return { reason: 'an empty expression has no statement to write' };
                    }
                    expression = mergeExpression(
                        statement.expression,
                        readLatex(was.latex),
                        latexNode(now.latex),
                    );
                }
                const { metadata, unknown } = this.properties('expression', statement, was, now);
                return { statement: { ...statement, expression, metadata }, unknown };
            }

            case 'NoteStatement': {
                const text: StringLiteral =
                    was.text === now.text
                        ? statement.text
                        : { ...stringNode(String(now.text ?? '')), span: statement.text.span };
                const { metadata, unknown } = this.properties('note', statement, was, now);
                return { statement: { ...statement, text, metadata }, unknown };
            }

            case 'ImageStatement': {
                // The source is the one thing never taken from the graph. A
                // picture named by path was read off a disk and inlined as a
                // `data:` URI before the graph existed, so the graph carries
                // the bytes and has no memory of the path - and writing its
                // URL back would put the whole picture, base64'd, where the
                // filename was.
                const { metadata, unknown } = this.properties('image', statement, was, now);
                if (was.image_url !== now.image_url) unknown.push('image_url');
                return { statement: { ...statement, metadata }, unknown };
            }

            case 'FolderStatement': {
                const title =
                    was.title === now.title
                        ? statement.title
                        : typeof now.title === 'string'
                          ? stringNode(now.title)
                          : null;
                const { metadata, unknown } = this.properties('folder', statement, was, now);
                return { statement: { ...statement, title, metadata }, unknown };
            }

            case 'ImportStatement': {
                const alias =
                    was.title === now.title
                        ? statement.alias
                        : importAliasFor(
                              typeof now.title === 'string' ? now.title : undefined,
                              statement.path.value,
                          );
                const { metadata, unknown } = this.properties('import', statement, was, now);
                return { statement: { ...statement, alias, metadata }, unknown };
            }

            case 'TableStatement':
                return this.table(statement, was as unknown as Table, now as unknown as Table);
        }

        return { reason: 'this statement is not one a graph item is written from' };
    }

    /** A statement's metadata with the properties that changed rewritten. */
    private properties(
        placement: ReadbackPlacement,
        statement: { metadata: Metadata | null; span: Span },
        was: Item,
        now: Item,
    ): { metadata: Metadata | null; unknown: string[] } {
        const { writes, unknown } = propertyWrites(
            placement,
            was,
            now,
            statement.metadata?.entries ?? [],
        );
        return {
            metadata: applyPropertyWrites(
                statement.metadata,
                writes,
                statement.span.end,
                this.source,
            ),
            unknown,
        };
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
        const unknown = Object.keys({ ...was, ...now }).filter(
            key =>
                !['type', 'id', 'folderId', 'columns'].includes(key) &&
                !same((was as unknown as Item)[key], (now as unknown as Item)[key]),
        );

        for (const column of now.columns) {
            const index = was.columns.findIndex(candidate => candidate.id === column.id);
            if (index < 0) {
                columns.push(columnFor(column as unknown as Item));
                continue;
            }

            const written = statement.columns[index];
            const before = was.columns[index] as unknown as Item;
            const after = column as unknown as Item;

            const header =
                before.latex === after.latex
                    ? written.header
                    : mergeExpression(
                          written.header,
                          readLatex(before.latex),
                          latexNode(String(after.latex)),
                      );

            let values = written.values;
            if (!same(before.values, after.values)) {
                const cells = cellValues((after.values as string[] | undefined) ?? []);
                if (cells.some(cell => cell.trim() === '')) {
                    return { reason: 'a table cell left empty has no Axis spelling' };
                }
                const previous = (before.values as string[] | undefined) ?? [];
                values =
                    written.values === null && cells.length === 0
                        ? null
                        : cells.map((cell, at) =>
                              mergeExpression(
                                  written.values?.[at],
                                  readLatex(previous[at]),
                                  latexNode(cell),
                              ),
                          );
            }

            const writes = propertyWrites('column', before, after, written.metadata?.entries ?? []);
            unknown.push(...writes.unknown);
            columns.push({
                ...written,
                header,
                values,
                metadata: applyPropertyWrites(
                    written.metadata,
                    writes.writes,
                    written.span.end,
                    this.source,
                ),
            });
        }

        return { statement: { ...statement, columns }, unknown: [...new Set(unknown)] };
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

            const statement = statementFor(item);
            if ('reason' in statement) {
                this.skip(change, statement.reason);
                continue;
            }

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
            const statement = statementFor(change.after, members.get(change.id!) ?? []);
            if ('reason' in statement) {
                this.skip(change, statement.reason);
            } else {
                pending.push({ change, statement });
            }
        }

        // Everything with no folder of its own goes on the end of the script,
        // which is the one placement that is always right and never a guess
        // about where it belonged - in the order the graph lists it.
        const order = new Map(listOf(this.after).map((item, index) => [item.id, index]));
        pending.sort((a, b) => (order.get(a.change.id) ?? 0) - (order.get(b.change.id) ?? 0));
        for (const { change, statement } of pending) {
            this.append(statement, change);
        }
    }

    /** A new statement written at the end of the folder it was made in. */
    private intoFolder(change: GraphChange, folderId: string, statement: Statement): void {
        const found = this.origin(folderId);
        if ('reason' in found) {
            return this.skip(
                change,
                this.compilation.sourceMap.has(folderId)
                    ? found.reason
                    : 'this expression is in a folder that is not in this script',
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
            return this.skip(change, 'this expression is in a folder that is not in this script');
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

    /** A new top-level statement, on the end of the script. */
    private append(statement: Statement, change: GraphChange): void {
        const printed = printStatement(statement, { indent: this.unit });
        const end = this.source.length;
        if (this.source.trim() === '') {
            this.insert(end, `${printed}\n`, change);
        } else if (this.source.endsWith('\n')) {
            this.insert(end, `${printed}\n`, change);
        } else {
            this.insert(end, `\n${printed}`, change);
        }
    }

    // ── Settings ─────────────────────────────────────────────────────────────

    /**
     * The settings that changed, written into the script's own `config`
     * block - or into one opened at the top for them.
     *
     * The viewport is written only for a script that names one. Panning and
     * zooming are how anybody reads a graph, and they change the viewport
     * constantly; a script that says nothing about its framing was written by
     * somebody who did not care about it, and four `xmin`-and-friends lines
     * appearing the first time they scrolled would be the feature writing
     * something nobody asked for. A script that does name a viewport has an
     * author who cares where the graph sits, and for them a pan is an edit.
     */
    settings(change: GraphChange): void {
        const origin = this.compilation.configOrigin;
        let config: ConfigStatement | undefined;
        if (origin) {
            const located = this.statements.get(key(origin.span));
            if (located?.statement.kind !== 'ConfigStatement') {
                return this.skip(change, 'the script has changed since this graph was compiled');
            }
            config = located.statement;
        }

        const entries = config?.entries ?? [];
        const framed = entries.some(entry => VIEWPORT.has(entry.key.name));
        const changed = CONFIG_NAMES.filter(
            name => !same(configValue(this.before, name), configValue(this.after, name)),
        );
        const writable = changed.filter(name => framed || !VIEWPORT.has(name));

        const writes: PropertyWrite[] = [];
        const unwritable: string[] = [];
        for (const name of writable) {
            const property = [...entries].reverse().find(entry => entry.key.name === name);
            const now = configValue(this.after, name);
            const value = configNode(name, now, property);
            if (value !== undefined) {
                writes.push({ name, value });
            } else if (now === undefined) {
                if (property) writes.push({ name, remove: true });
            } else {
                unwritable.push(name);
            }
        }

        if (unwritable.length > 0) {
            this.skip(change, `${list(unwritable)} changed to a value the script cannot write`);
        }
        if (writes.length === 0) {
            if (changed.length > writable.length) {
                this.skip(change, 'the viewport moved, and this script does not set one');
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

        // A script with no config block gets one at the very top, which is
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
     * The ticker, written back into the script's `ticker` statement. Its own
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

        if (!statement) {
            if (was)
                return this.skip(change, 'the ticker is written in a file this script imports');
            if (!now) return;
            try {
                const made: TickerStatement = {
                    kind: 'TickerStatement',
                    handler: latexNode(now.handlerLatex!),
                    metadata: metadataFor('ticker', now as unknown as Item),
                    span: { start: 0, end: 0 },
                };
                return this.append(made, change);
            } catch (error) {
                return this.skip(
                    change,
                    `Desmos holds latex Axis cannot read: ${(error as Error).message}`,
                );
            }
        }

        if (!now) {
            return this.replace(removalSpan(this.source, statement.span), '', change);
        }

        let handler: Expression;
        try {
            handler =
                was?.handlerLatex === now.handlerLatex
                    ? statement.handler
                    : mergeExpression(
                          statement.handler,
                          readLatex(was?.handlerLatex),
                          latexNode(now.handlerLatex!),
                      );
        } catch (error) {
            return this.skip(
                change,
                `Desmos holds latex Axis cannot read: ${(error as Error).message}`,
            );
        }

        const { metadata, unknown } = this.properties(
            'ticker',
            statement,
            (was ?? {}) as unknown as Item,
            now as unknown as Item,
        );
        if (unknown.length > 0) this.skip(change, unknownReason(unknown));

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
            return { reason: 'this expression was not compiled from this script' };
        }
        if (this.imports.has(origin.path)) {
            // Only the script handed over is edited. Another file's statement
            // is somebody else's source, and possibly several scripts'.
            return { reason: `this is written in ${origin.path}, which this script imports` };
        }
        const located = this.statements.get(key(origin.span));
        if (!located) {
            return { reason: 'the script has changed since this graph was compiled' };
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

/** Latex off a reading, as a tree, or nothing for latex that is not there. */
function readLatex(latex: unknown): Expression | undefined {
    return typeof latex === 'string' && latex !== '' ? latexNode(latex) : undefined;
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
