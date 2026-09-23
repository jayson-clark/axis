// ═════════════════════════════════════════════════════════════════════════════
// The Axis decompiler
// ═════════════════════════════════════════════════════════════════════════════
//
// A graph back into the file that would build it. The graph is what a
// compilation hands a host, or what a calculator's `getState` hands back - the
// two are the same shape - and the file is built as a syntax tree first and
// only then printed, by the same printer `format` uses, so what comes out is
// laid out exactly as if somebody had typed it and then formatted it.
//
// The test of a decompiler is not that its output reads well but that it means
// the same thing, so the contract is compiling it again:
//
//     compileAxis(decompileAxis(compileAxis(source))) ≡ compileAxis(source)
//
// which `decompile.test.mts` holds every example to. Most of what
// follows is lowering (`lower.ts`) run backwards: every key it writes is read
// here into the property that writes it, and every default it fills in - the
// ±10 viewport, `movablePointSize` copied from `pointSize`, `parametricDomain`
// copied from `domain`, the options Axis switches off on its own - is left
// out again, so a file that said nothing comes back saying nothing.
//
// Three things a graph can hold have no Axis spelling, and are handled rather
// than dropped:
//
//   - **Imports are gone.** They were flattened into folders when the file
//     was compiled, and nothing in the graph records where the contents came
//     from, so they come back as the folder the reader sees.
//   - **Styles and macros are gone.** Both are resolved away before anything
//     reaches the graph, so what comes back is what they stood for.
//   - **Latex the expression tree has no node for** - `\sum`, `\int`, a
//     derivative - cannot be written as Axis at all yet (#33). The expression
//     is left out, a `// unsupported: <latex>` comment stands where it would
//     have been, and a diagnostic points at the comment. The rest of the graph
//     decompiles as usual: one expression Axis cannot say is no reason to lose
//     the hundred it can.

import type {
    CalculatorOptions,
    ClickableInfo,
    DesmosExpression,
    DomainBounds,
    Expression as DesmosExpressionItem,
    Folder,
    GraphImage,
    GraphState,
    Note,
    SliderState,
    Table,
    TableColumn as DesmosTableColumn,
    TickerState,
} from '@axis-dsl/desmos';
import {
    AXIS_CALCULATOR_PRODUCTS,
    AXIS_DEFAULT_CONFIG,
    AXIS_DEFAULT_STATE,
    AXIS_MANIFEST,
    AXIS_PALETTE,
    AXIS_STATE_PROPERTY_NAMES,
    AXIS_VIEWPORT_PROPERTY_NAMES,
    type ConfigStatement,
    type Diagnostic,
    enumValue,
    type Expression,
    findProperty,
    type FolderStatement,
    type Metadata,
    printStatement,
    type PrintOptions,
    type Property,
    type PropertyPlacement,
    type PropertyValue,
    type Range,
    type Span,
    type Statement,
    type TableColumn,
    type TickerStatement,
} from '@axis-dsl/syntax';
import type { DecompilerDiagnosticCode } from './diagnostics';
import { parseLatex, parseLatexStatement } from './latex/index';

/** A graph to decompile: what {@link compileAxis} hands back, or a calculator's own state. */
export interface DecompileInput {
    /**
     * The graph state, as `setState` takes it and `getState` returns it: the
     * expression list and the ticker beside it, the viewport and the other
     * `graph` settings, and the flags Desmos reads off the top.
     */
    state: GraphState;
    /**
     * The calculator options, as `updateSettings` takes them. Optional,
     * because a graph saved at desmos.com has none - it is a state and nothing
     * else - and anything the state's own `graph` holds is read from there.
     */
    options?: CalculatorOptions;
}

export interface DecompileResult {
    /** The file, formatted, ending in a newline - or empty for an empty graph. */
    source: string;
    /** The statements the file was printed from, for a caller that wants the tree. */
    statements: Statement[];
    /**
     * What the file could not say. Each one's span is into {@link source}:
     * the comment written where the thing it is about would have been.
     */
    diagnostics: Diagnostic[];
}

/** One item decompiled on its own: the statement, or null for nothing to write. */
export interface DecompiledStatement<T extends Statement = Statement> {
    statement: T | null;
    /**
     * What was left out of it. With no source to point into, every span is
     * empty; {@link decompileAxis} is the one that places them.
     */
    diagnostics: Diagnostic[];
}

export interface DecompileExpressionOptions {
    /**
     * The names the graph defines. A palette name the graph also defines is
     * that variable rather than the colour (spec §4.3), so a colour is only
     * written as `RED` when nothing called `RED` is in the graph.
     */
    definedNames?: ReadonlySet<string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry points
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The folder a geometry calculator keeps its constructions in. It adds one,
 * hidden, to every graph, so it is the calculator's rather than the file's:
 * written into the file it would come back as a second one. Anything in it is
 * written at the top level, which is the best Axis can do until it has
 * geometry of its own.
 */
const GEOMETRY_FOLDER_ID = '**dcg_geo_folder**';

/** Turn a graph back into the `.axis` source that builds it. */
export function decompileAxis(input: DecompileInput, options: PrintOptions = {}): DecompileResult {
    const list = input.state.expressions?.list ?? [];
    const context = new Context(definedNames(list));

    const units: Unit[] = [];
    const config = settingsStatement(input);
    if (config) {
        units.push({ statements: [config] });
    }

    // A folder's contents are wherever the list happens to keep them, so they
    // are gathered up front: the folder is written where it stands, holding
    // everything that claims it. Desmos has one level of folders, so a folder
    // that claims to sit in another is written beside it - which is what the
    // compiler makes of a folder written inside a folder.
    const folders = new Map<string, DesmosExpression[]>();
    for (const item of list) {
        if (item.type === 'folder' && item.id !== GEOMETRY_FOLDER_ID) {
            folders.set(item.id, []);
        }
    }
    const inFolder = (item: DesmosExpression) =>
        item.type !== 'folder' && item.folderId !== undefined && folders.has(item.folderId);
    for (const item of list) {
        if (inFolder(item)) {
            folders.get((item as { folderId: string }).folderId)!.push(item);
        }
    }

    for (const item of list) {
        if (inFolder(item) || item.id === GEOMETRY_FOLDER_ID) {
            continue;
        }
        if (item.type === 'folder') {
            const folder = context.folder(item);
            folder.body = (folders.get(item.id) ?? []).flatMap(member => context.item(member));
            units.push({ statements: [folder] });
            continue;
        }
        const statements = context.item(item);
        if (statements.length) {
            units.push({ statements });
        }
    }

    const ticker = input.state.expressions?.ticker;
    if (ticker) {
        const statements = context.ticker(ticker);
        if (statements.length) {
            units.push({ statements });
        }
    }

    return context.print(units, options);
}

/**
 * One item of the list, as the statement that builds it.
 *
 * The decompiler's unit of work, exposed because it is also the unit a change
 * to a live graph arrives in: a dragged point is one expression the calculator
 * hands back different from how it was given, and writing it back into a
 * file means printing this one statement over the characters that produced
 * it. A folder comes back as its header and metadata, with an empty body - its
 * members are items of their own.
 */
export function decompileExpression(
    item: DesmosExpression,
    options: DecompileExpressionOptions = {},
): DecompiledStatement {
    const context = new Context(options.definedNames ?? new Set());
    if (item.type === 'folder') {
        return { statement: context.folder(item), diagnostics: [] };
    }
    const statements = context.item(item);
    const statement = statements.find(node => !context.isPlaceholder(node)) ?? null;
    return { statement, diagnostics: context.unplacedDiagnostics() };
}

/**
 * The `config { … }` block a graph's settings decompile to, or null when every
 * setting is one Axis would have applied anyway - a file that needs no block.
 *
 * Exposed for the same reason as {@link decompileExpression}: a setting changed
 * on a live graph - the viewport panned, the grid switched off - is written
 * back by replacing this one block.
 */
export function decompileSettings(input: DecompileInput): ConfigStatement | null {
    return settingsStatement(input);
}

/** The graph's ticker, as the `ticker` statement that runs it. */
export function decompileTicker(ticker: TickerState): DecompiledStatement<TickerStatement> {
    const context = new Context(new Set());
    const statement =
        context
            .ticker(ticker)
            .find((node): node is TickerStatement => node.kind === 'TickerStatement') ?? null;
    return { statement, diagnostics: context.unplacedDiagnostics() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Nodes
// ─────────────────────────────────────────────────────────────────────────────
//
// A tree built here was never read from any source, so every span is empty:
// the printer lays such a tree out by its own rules alone, which is the point.

const span = (): Span => ({ start: 0, end: 0 });

const identifier = (name: string) => ({ kind: 'Identifier' as const, name, span: span() });

const string = (value: string) => ({ kind: 'String' as const, value, span: span() });

/** A number as a literal the lexer reads back as the same number, negated if it has to be. */
function number(value: number): Expression {
    // `String` writes a large or small enough number with an exponent, and
    // `1e+21` is not a number to the lexer - which takes a digit, or `-` and
    // a digit, after the `e` and nothing else.
    let text = String(Math.abs(value));
    if (text.includes('e+')) {
        text = Math.abs(value).toLocaleString('en-US', {
            useGrouping: false,
            maximumFractionDigits: 20,
        });
    }
    const literal: Expression = { kind: 'Number', value: text, span: span() };
    return value < 0 || Object.is(value, -0)
        ? { kind: 'Unary', operator: '-', operand: literal, span: span() }
        : literal;
}

/** `key: value`, or `key` bare for a flag that is on. */
function property(key: string, value: PropertyValue | true): Property {
    return value === true
        ? { kind: 'Property', key: identifier(key), colon: false, value: null, span: span() }
        : { kind: 'Property', key: identifier(key), colon: true, value, span: span() };
}

/** A boolean as Axis writes it: bare when it is on (spec §4.1), `key: false` when it is off. */
function flag(key: string, value: boolean): Property {
    return property(key, value ? true : identifier('false'));
}

function metadata(entries: Property[]): Metadata | null {
    return entries.length ? { kind: 'Metadata', block: false, entries, span: span() } : null;
}

function range(
    min: Expression | null,
    max: Expression | null,
    step: Expression | null = null,
    soft: Range['soft'] = 'none',
): Range {
    return { kind: 'Range', min, max, step, soft, span: span() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading a graph
// ─────────────────────────────────────────────────────────────────────────────

/** What one expression, property or item could not be written as, to report and comment. */
interface Problem {
    code: DecompilerDiagnosticCode;
    /** The comment written in its place, without the `// `. */
    comment: string;
    message: string;
}

/** The statements one item of the list became, kept together when the file is laid out. */
interface Unit {
    statements: Statement[];
}

/**
 * A comment stands in the tree as a note whose text is this and an index into
 * the problems, and is swapped for the comment once the tree is printed. The
 * printer places and indents it like any other statement, which is all a
 * comment on a line of its own needs - and a note's text cannot hold a NUL,
 * so nothing a graph says can be mistaken for one.
 */
const PLACEHOLDER = '\u0000';

/** The expression-level properties, in the order they are written. */
const SLIDER_ANIMATION = ['playing', 'loopMode', 'playDirection', 'animationPeriod'] as const;

class Context {
    private readonly problems: Problem[] = [];
    /** The palette names the graph does not take for variables of its own. */
    private readonly palette: ReadonlyMap<string, string>;

    constructor(defined: ReadonlySet<string>) {
        this.palette = new Map(
            AXIS_PALETTE.filter(color => !defined.has(color.name)).map(color => [
                color.hex,
                color.name,
            ]),
        );
    }

    // ── Problems ─────────────────────────────────────────────────────────────

    /** Record a problem, and the placeholder that stands where its comment goes. */
    private problem(problem: Problem): Statement {
        this.problems.push(problem);
        return {
            kind: 'NoteStatement',
            text: string(`${PLACEHOLDER}${this.problems.length - 1}`),
            metadata: null,
            span: span(),
        };
    }

    isPlaceholder(statement: Statement): boolean {
        return statement.kind === 'NoteStatement' && statement.text.value.startsWith(PLACEHOLDER);
    }

    /** Every problem as a diagnostic with nowhere to point, for a caller with no source. */
    unplacedDiagnostics(): Diagnostic[] {
        return this.problems.map(problem => diagnostic(problem, span()));
    }

    /**
     * Latex read as an expression, or undefined - with the problem recorded -
     * for latex the tree has no node for. `what` names it in the comment and
     * the message: the item, and the property if it is one. An expression
     * list's row is read with `parseLatexStatement` instead, since its `=`
     * is a statement's.
     */
    private latex(
        latex: string | number,
        what: { id?: string; property?: string },
        pending: Statement[],
        read: (latex: string) => Expression = parseLatex,
    ): Expression | undefined {
        if (typeof latex === 'number') {
            return number(latex);
        }
        try {
            return read(latex);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            const oneLine = latex.replace(/\s*\n\s*/g, ' ');
            const where = what.property ? ` ${what.property}` : '';
            pending.push(
                this.problem({
                    code: 'unsupported-latex',
                    comment: `unsupported${where}: ${oneLine}`,
                    message: `${describe(what)} is latex Axis cannot write yet, so it was left out: ${reason}.`,
                }),
            );
            return undefined;
        }
    }

    // ── Items ────────────────────────────────────────────────────────────────

    /**
     * One item of the list: the statement it becomes, preceded by a comment
     * for anything in it that could not be written.
     */
    item(item: DesmosExpression): Statement[] {
        const pending: Statement[] = [];
        const statement = this.statement(item, pending);
        return statement ? [...pending, statement] : pending;
    }

    private statement(item: DesmosExpression, pending: Statement[]): Statement | null {
        // A graph saved long enough ago writes a note as a bare `text` with
        // no type at all, and Desmos still reads it as one - so the type is
        // not what says a note is a note, the text is.
        const untyped = item as { type?: string; text?: unknown };
        if (
            untyped.type === 'text' ||
            (untyped.type === undefined && typeof untyped.text === 'string')
        ) {
            return this.note(item as Note);
        }

        switch (item.type) {
            case undefined:
            case 'expression':
                return this.expression(item, pending);
            case 'table':
                return this.table(item, pending);
            case 'image':
                return this.image(item, pending);
            case 'folder':
                return this.folder(item);
            default: {
                const type = String((item as { type?: unknown }).type);
                pending.push(
                    this.problem({
                        code: 'unsupported-item',
                        comment: `unsupported ${type}`,
                        message: `${describe({ id: (item as { id?: string }).id })} is a ${type}, which Axis has no statement for, so it was left out.`,
                    }),
                );
                return null;
            }
        }
    }

    private note(note: Note): Statement {
        return {
            kind: 'NoteStatement',
            text: string(note.text ?? ''),
            // A note takes `secret` and nothing else, and says so only when it is.
            metadata: metadata(
                (note as Note & { secret?: boolean }).secret === true ? [flag('secret', true)] : [],
            ),
            span: span(),
        };
    }

    folder(folder: Folder): FolderStatement {
        // Desmos says "not collapsed" by leaving the key off, and the compiler
        // writes these flags only when they are on - so only those are read.
        const entries = (['collapsed', 'hidden', 'secret'] as const)
            .filter(key => folder[key] === true)
            .map(key => flag(key, true));
        return {
            kind: 'FolderStatement',
            // An untitled folder is one Desmos stores with no title at all,
            // which `folder { … }` writes; an empty title is still a title.
            title: folder.title === undefined ? null : string(folder.title),
            metadata: metadata(entries),
            body: [],
            span: span(),
        };
    }

    private expression(item: DesmosExpressionItem, pending: Statement[]): Statement | null {
        // A row with no latex is the blank Desmos keeps for spacing, or at the
        // bottom of the list. There is no statement that writes one, and it
        // draws nothing.
        if (item.latex === undefined || item.latex.trim() === '') {
            return null;
        }
        const expression = this.latex(item.latex, { id: item.id }, pending, parseLatexStatement);
        if (!expression) {
            return null;
        }
        return {
            kind: 'ExpressionStatement',
            expression: unbracketed(expression),
            metadata: metadata(this.expressionProperties(item, pending)),
            span: span(),
        };
    }

    private expressionProperties(item: DesmosExpressionItem, pending: Statement[]): Property[] {
        const at = { id: item.id };
        return [
            ...this.slider(item.slider, at, pending),
            ...this.color(item, at, pending),
            ...this.styling(item, 'expression', at, pending),
            ...this.latexProperties(item, ['fillOpacity'], at, pending),
            ...this.flags(item, ['fill', 'hidden', 'secret']),
            ...this.enums(item, 'expression', ['dragMode'], at, pending),
            ...this.strings(item, ['label']),
            ...this.flags(item, ['showLabel']),
            ...this.latexProperties(item, ['labelSize'], at, pending),
            ...this.enums(item, 'expression', ['labelOrientation'], at, pending),
            ...this.flags(item, ['suppressTextOutline', 'pointOutline']),
            ...this.strings(item, ['description']),
            ...this.domains(item, at, pending),
            ...this.clickable(item.clickableInfo, at, pending),
        ];
    }

    /**
     * How a line or a point is drawn, which an expression and a table column
     * share. `movablePointSize` is left out where it only repeats `pointSize`:
     * the compiler copies one into the other for a file that named one size
     * (lower.ts), so writing both back would grow a property nobody typed.
     *
     * A calculator hands a point style it will not draw on a movable point -
     * `SQUARE`, `STAR` - back stashed under a key of its own rather than as
     * `pointStyle`, even for a graph that asked it not to migrate the style.
     * It is still the style the file gave, and compiled again it is stashed
     * again, so it is read as `pointStyle`.
     */
    private styling(
        item: DesmosExpressionItem | DesmosTableColumn,
        placement: PropertyPlacement,
        at: { id?: string },
        pending: Statement[],
    ): Property[] {
        const stashed = (item as { __stashed_V12PointStyle?: unknown }).__stashed_V12PointStyle;
        const sized = {
            ...item,
            ...(item.pointStyle === undefined &&
                typeof stashed === 'string' && { pointStyle: stashed }),
            ...(item.movablePointSize !== undefined &&
                String(item.movablePointSize) === String(item.pointSize ?? '') && {
                    movablePointSize: undefined,
                }),
        };
        return [
            ...this.enums(sized, placement, ['lineStyle'], at, pending),
            ...this.latexProperties(sized, ['lineWidth', 'lineOpacity'], at, pending),
            ...this.enums(sized, placement, ['pointStyle'], at, pending),
            ...this.latexProperties(
                sized,
                ['pointSize', 'movablePointSize', 'pointOpacity'],
                at,
                pending,
            ),
            ...this.flags(sized, ['lines', 'points']),
        ];
    }

    /**
     * A colour, in whichever of the three spellings says it (spec §4.3): a
     * palette name for the hex Desmos names, a hex literal for any other, and
     * the expression itself for `colorLatex`. A graph off a calculator carries
     * the cycled `color` beside a `colorLatex`, and the expression is the one
     * Desmos draws with.
     */
    private color(
        item: { color?: string; colorLatex?: string },
        at: { id?: string },
        pending: Statement[],
    ): Property[] {
        if (item.colorLatex !== undefined && item.colorLatex !== '') {
            const expression = this.latex(item.colorLatex, { ...at, property: 'color' }, pending);
            return expression ? [property('color', expression)] : [];
        }
        if (item.color === undefined) {
            return [];
        }
        const color = this.hex(item.color);
        if (!color) {
            pending.push(
                this.problem({
                    code: 'unsupported-value',
                    comment: `unsupported color: ${item.color}`,
                    message: `${describe({ ...at, property: 'color' })} is "${item.color}", which is not a colour Axis can write, so it was left out.`,
                }),
            );
            return [];
        }
        return [property('color', color)];
    }

    /** A hex colour as a palette name or a literal, or undefined for anything but hex. */
    private hex(value: string): Expression | undefined {
        const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
        if (!match) return undefined;
        const digits = match[1].toLowerCase();
        const full = `#${digits.length === 3 ? [...digits].map(d => d + d).join('') : digits}`;
        const name = this.palette.get(full);
        return name ? identifier(name) : { kind: 'Color', value: full, span: span() };
    }

    /**
     * `slider` back into `slider: lo..hi step s soft …` and the animation
     * properties beside it.
     *
     * A bound Desmos leaves off is its own default and is left off here too,
     * and a bound that is not a limit is one it says by leaving `hardMin` or
     * `hardMax` off - which the range writes as `soft` on that end, since a
     * range's ends are hard unless it says otherwise (spec §4.4).
     */
    private slider(
        slider: SliderState | undefined,
        at: { id?: string },
        pending: Statement[],
    ): Property[] {
        if (!slider) return [];
        const entries: Property[] = [];

        const bounded =
            slider.min !== undefined ||
            slider.max !== undefined ||
            slider.step !== undefined ||
            slider.hardMin === true ||
            slider.hardMax === true;
        if (bounded) {
            const end = (latex: string | undefined, name: string) =>
                latex === undefined || latex === ''
                    ? null
                    : (this.latex(latex, { ...at, property: `slider ${name}` }, pending) ?? null);
            const hardMin = slider.hardMin === true;
            const hardMax = slider.hardMax === true;
            const soft: Range['soft'] =
                hardMin && hardMax ? 'none' : hardMin ? 'max' : hardMax ? 'min' : 'both';
            entries.push(
                property(
                    'slider',
                    range(
                        end(slider.min, 'min'),
                        end(slider.max, 'max'),
                        end(slider.step, 'step'),
                        soft,
                    ),
                ),
            );
        }

        for (const key of SLIDER_ANIMATION) {
            switch (key) {
                case 'playing':
                    if (typeof slider.isPlaying === 'boolean') {
                        entries.push(flag('playing', slider.isPlaying));
                    }
                    break;
                case 'loopMode':
                    entries.push(...this.enums(slider, 'expression', ['loopMode'], at, pending));
                    break;
                case 'playDirection':
                case 'animationPeriod':
                    if (typeof slider[key] === 'number') {
                        entries.push(property(key, number(slider[key])));
                    }
                    break;
            }
        }
        return entries;
    }

    /**
     * `domain`, `parametricDomain` and `polarDomain`, each a range of its two
     * ends. Desmos keeps the first two as copies of one another and the
     * compiler writes one `domain` into both, so the older key is written out
     * only where the two disagree - which a graph off desmos.com does, since
     * it spells an unset end as `0` under one and as `""` under the other.
     */
    private domains(
        item: DesmosExpressionItem,
        at: { id?: string },
        pending: Statement[],
    ): Property[] {
        const same = (a: DomainBounds, b: DomainBounds) =>
            String(a.min) === String(b.min) && String(a.max) === String(b.max);
        const bounds = (name: string, domain: DomainBounds): Property => {
            // An end Desmos has no value for is the empty string, which is
            // what an end left off a range lowers to.
            const end = (latex: string | number, which: string) =>
                latex === ''
                    ? null
                    : (this.latex(latex, { ...at, property: `${name} ${which}` }, pending) ?? null);
            return property(name, range(end(domain.min, 'min'), end(domain.max, 'max')));
        };

        const entries: Property[] = [];
        if (item.domain) {
            entries.push(bounds('domain', item.domain));
        }
        if (item.parametricDomain && !(item.domain && same(item.domain, item.parametricDomain))) {
            entries.push(bounds('parametricDomain', item.parametricDomain));
        }
        if (item.polarDomain) {
            entries.push(bounds('polarDomain', item.polarDomain));
        }
        return entries;
    }

    /**
     * `clickableInfo` back into `onClick` and `clickable`.
     *
     * An action implies a click that runs, so `clickable` is only written when
     * it says something the action does not: a click switched off - which
     * Desmos says by leaving `enabled` off rather than storing `false` - or an
     * object made clickable with nothing of its own to run.
     */
    private clickable(
        info: ClickableInfo | undefined,
        at: { id?: string },
        pending: Statement[],
    ): Property[] {
        if (!info) return [];
        const entries: Property[] = [];
        const action =
            info.latex === undefined || info.latex === ''
                ? undefined
                : this.latex(info.latex, { ...at, property: 'onClick' }, pending);
        if (action) {
            entries.push(property('onClick', action));
        }
        const enabled = info.enabled === true;
        if (!enabled || !action) {
            entries.push(flag('clickable', enabled));
        }
        return entries;
    }

    private table(table: Table, pending: Statement[]): Statement {
        const columns: TableColumn[] = [];

        for (const column of table.columns ?? []) {
            const at = { id: column.id ?? table.id };
            const header = this.latex(column.latex ?? '', { ...at, property: 'column' }, pending);
            if (!header) continue;

            // Desmos pads a column with blank cells to the length of the
            // longest, so trailing ones are nothing the file has to say.
            const cells = [...(column.values ?? [])];
            while (cells.length && cells[cells.length - 1].trim() === '') cells.pop();

            let values: Expression[] | null = null;
            if (cells.length) {
                values = [];
                for (const [index, cell] of cells.entries()) {
                    const value =
                        cell.trim() === ''
                            ? this.blankCell(at, index, pending)
                            : this.latex(cell, { ...at, property: `cell ${index + 1}` }, pending);
                    values.push(value ?? this.blankCell(at, index, pending, false));
                }
            }

            columns.push({
                kind: 'TableColumn',
                // A column with no values is a computed one, `x ^ 2`. One with
                // a header and an empty list (`x = []`) lowers to the same
                // thing, so the two are written the one way.
                header,
                values,
                metadata: metadata([
                    ...this.color(column, at, pending),
                    ...this.styling(column, 'column', at, pending),
                    ...this.flags(column, ['hidden']),
                    ...this.enums(column, 'column', ['dragMode'], at, pending),
                ]),
                span: span(),
            });
        }

        return { kind: 'TableStatement', metadata: null, columns, span: span() };
    }

    /**
     * A cell with nothing in it, among cells that have something - which a
     * list has no way to write. It is written as `0 / 0`, undefined as the
     * blank is, so the rows after it stay in their rows, and reported.
     */
    private blankCell(
        at: { id?: string },
        index: number,
        pending: Statement[],
        report = true,
    ): Expression {
        if (report) {
            pending.push(
                this.problem({
                    code: 'unsupported-value',
                    comment: `blank cell ${index + 1} written as 0 / 0`,
                    message: `${describe({ ...at, property: `cell ${index + 1}` })} is blank, which a list cannot hold, so it was written as 0 / 0.`,
                }),
            );
        }
        const zero = (): Expression => ({ kind: 'Number', value: '0', span: span() });
        return { kind: 'Binary', operator: '/', left: zero(), right: zero(), span: span() };
    }

    private image(image: GraphImage, pending: Statement[]): Statement | null {
        const at = { id: image.id };
        if (!image.image_url) {
            pending.push(
                this.problem({
                    code: 'unsupported-item',
                    comment: 'unsupported image with no picture',
                    message: `${describe(at)} is an image with no URL, so it was left out.`,
                }),
            );
            return null;
        }
        return {
            kind: 'ImageStatement',
            // A picture the compiler read from a file was inlined as a
            // `data:` URI, and nothing in the graph remembers the path - so
            // the URI is what comes back, and compiles to the same picture.
            source: string(image.image_url),
            metadata: metadata([
                ...this.strings(image, ['name']),
                ...this.latexProperties(
                    image,
                    ['center', 'width', 'height', 'angle', 'opacity'],
                    at,
                    pending,
                ),
                ...this.flags(image, ['foreground', 'hidden', 'secret']),
                // Desmos keeps `draggable` for an image and ignores `dragMode`
                // on one, and the compiler makes any mode but `NONE` into it -
                // so a draggable image is written with the mode that says
                // "anywhere", which is what dragging an image does.
                ...(image.draggable === true ? [property('dragMode', identifier('XY'))] : []),
                ...this.clickable(image.clickableInfo, at, pending),
            ]),
            span: span(),
        };
    }

    /**
     * The ticker, which rides beside the list rather than in it. `playing`
     * and `open` are written only when they are on, which is how Desmos
     * writes them itself.
     */
    ticker(ticker: TickerState): Statement[] {
        // A ticker with no handler is no ticker, to Desmos as much as here.
        if (!ticker.handlerLatex) return [];
        const pending: Statement[] = [];
        const at = { id: 'the ticker' };
        const handler = this.latex(ticker.handlerLatex, at, pending);
        if (!handler) return pending;

        const minStep =
            ticker.minStepLatex === undefined || ticker.minStepLatex === ''
                ? undefined
                : this.latex(ticker.minStepLatex, { ...at, property: 'minStep' }, pending);
        const statement: TickerStatement = {
            kind: 'TickerStatement',
            handler,
            metadata: metadata([
                ...(minStep ? [property('minStep', minStep)] : []),
                ...(ticker.playing === true ? [flag('playing', true)] : []),
                ...(ticker.open === true ? [flag('open', true)] : []),
            ]),
            span: span(),
        };
        return [...pending, statement];
    }

    // ── Property readers ─────────────────────────────────────────────────────

    /** The booleans an item sets, each as a flag or `key: false`. */
    private flags(item: object, keys: readonly string[]): Property[] {
        const record = item as Record<string, unknown>;
        return keys
            .filter(key => typeof record[key] === 'boolean')
            .map(key => flag(key, record[key] as boolean));
    }

    /** The text properties an item sets, as strings. */
    private strings(item: object, keys: readonly string[]): Property[] {
        const record = item as Record<string, unknown>;
        return keys
            .filter(key => typeof record[key] === 'string')
            .map(key => property(key, string(record[key] as string)));
    }

    /** The properties Desmos holds as latex, each read back as the expression it is. */
    private latexProperties(
        item: object,
        keys: readonly string[],
        at: { id?: string },
        pending: Statement[],
    ): Property[] {
        const record = item as Record<string, unknown>;
        const entries: Property[] = [];
        for (const key of keys) {
            const value = record[key];
            if ((typeof value !== 'string' || value === '') && typeof value !== 'number') continue;
            const expression = this.latex(value, { ...at, property: key }, pending);
            if (expression) entries.push(property(key, expression));
        }
        return entries;
    }

    /**
     * The enum properties an item sets, as the identifiers the manifest lists,
     * in Desmos' spelling. A value the manifest does not list would be an
     * error to write, so it is reported and left out instead.
     */
    private enums(
        item: object,
        placement: PropertyPlacement,
        keys: readonly string[],
        at: { id?: string },
        pending: Statement[],
    ): Property[] {
        const record = item as Record<string, unknown>;
        const entries: Property[] = [];
        for (const key of keys) {
            const value = record[key];
            if (typeof value !== 'string') continue;
            const definition = findProperty(key, placement);
            const spelled = definition && enumValue(definition, value);
            if (spelled) {
                entries.push(property(key, identifier(spelled)));
            } else {
                pending.push(
                    this.problem({
                        code: 'unsupported-value',
                        comment: `unsupported ${key}: ${value}`,
                        message: `${describe({ ...at, property: key })} is "${value}", which is not one of the values Axis knows for it, so it was left out.`,
                    }),
                );
            }
        }
        return entries;
    }

    // ── Printing ─────────────────────────────────────────────────────────────

    /**
     * The file, laid out as the examples are: a blank line either side of
     * anything written over several lines - a block, or a statement long
     * enough to wrap - and the comment for a problem right above the
     * statement it is about. Every statement is printed by the printer; the
     * only text written here is the comments that stand in for placeholders.
     */
    print(units: Unit[], options: PrintOptions): DecompileResult {
        const lines: string[] = [];
        const statements: Statement[] = [];

        for (const unit of units) {
            const printed = unit.statements.map(statement =>
                printStatement(statement, options).split('\n'),
            );
            const apart = printed.some(
                (text, index) => text.length > 1 && !this.isPlaceholder(unit.statements[index]),
            );
            if (apart && lines.length && lines[lines.length - 1] !== '') {
                lines.push('');
            }
            lines.push(...printed.flat());
            if (apart) {
                lines.push('');
            }
            statements.push(...unit.statements.filter(node => !this.isPlaceholder(node)));
        }
        while (lines[lines.length - 1] === '') {
            lines.pop();
        }

        // Swap each placeholder for its comment, noting where it lands so a
        // diagnostic can point at it.
        const diagnostics: Diagnostic[] = [];
        let offset = 0;
        const placeholder = new RegExp(`^(\\s*)"${PLACEHOLDER}(\\d+)"$`);
        const text = lines
            .map(line => {
                const match = placeholder.exec(line);
                if (match) {
                    const problem = this.problems[Number(match[2])];
                    line = `${match[1]}// ${problem.comment}`;
                    const start = offset + match[1].length;
                    diagnostics.push(diagnostic(problem, { start, end: offset + line.length }));
                }
                offset += line.length + 1;
                return line;
            })
            .join('\n');

        return { source: text ? `${text}\n` : '', statements, diagnostics };
    }
}

/**
 * A definition's value, without the brackets the compiler put round it.
 *
 * The compiler brackets a `with` or `for` on the right of a definition -
 * `g=\left(a-b\operatorname{with}a=2\right)` - so that its latex never
 * depends on how `=` and `with` bind. In source the statement's `=` already
 * does that grouping (spec §5.1), so the brackets would come back as ones
 * nobody wrote.
 */
function unbracketed(expression: Expression): Expression {
    if (
        expression.kind !== 'Comparison' ||
        expression.operators.length !== 1 ||
        expression.operators[0] !== '='
    ) {
        return expression;
    }
    const [target, value] = expression.operands;
    if (
        value.kind !== 'Paren' ||
        (value.expression.kind !== 'With' && value.expression.kind !== 'For')
    ) {
        return expression;
    }
    return { ...expression, operands: [target, value.expression] };
}

/** "expr_3", "expr_3's color" - what a message says a problem is about. */
function describe(what: { id?: string; property?: string }): string {
    const item = what.id === undefined ? 'An expression' : `Expression ${what.id}`;
    const subject = what.id === 'the ticker' ? 'The ticker' : item;
    return what.property ? `${subject}'s ${what.property}` : subject;
}

function diagnostic(problem: Problem, at: Span): Diagnostic {
    return { code: problem.code, severity: 'warning', message: problem.message, span: at };
}

/**
 * The names the graph defines - `a` in `a = 1`, `f` in `f(x) = …`, a table
 * column's header - which is what decides whether a palette name is free to
 * be written as the colour it names.
 */
function definedNames(list: readonly DesmosExpression[]): Set<string> {
    const names = new Set<string>();
    const define = (node: Expression) => {
        if (node.kind === 'Identifier') names.add(node.name);
        if (node.kind === 'Call') names.add(node.callee.name);
    };
    const read = (latex: string | undefined, parse = parseLatex) => {
        if (!latex) return undefined;
        try {
            return parse(latex);
        } catch {
            return undefined;
        }
    };

    for (const item of list) {
        if (item.type === 'table') {
            for (const column of item.columns ?? []) {
                const header = read(column.latex);
                if (header) define(header);
            }
            continue;
        }
        const tree = read((item as DesmosExpressionItem).latex, parseLatexStatement);
        if (
            tree?.kind === 'Comparison' &&
            tree.operators.length === 1 &&
            tree.operators[0] === '='
        ) {
            define(tree.operands[0]);
        }
    }
    return names;
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG_PROPERTIES = new Map(
    AXIS_MANIFEST.configProperties.map(definition => [definition.name, definition] as const),
);

/** The framing lowering fills in for an edge a file leaves out, and so is left out here. */
const DEFAULT_VIEWPORT: Readonly<Record<string, number>> = {
    xmin: -10,
    ymin: -10,
    xmax: 10,
    ymax: 10,
};

/**
 * The `config { … }` block, read from the three places Desmos keeps settings:
 * the calculator options, the state's `graph`, and the flags at the top of the
 * state. The options win where two say the same thing - a real calculator
 * mirrors some of them into `graph` - and whatever Axis would have applied on
 * its own is left out: its default options, its default state flags, the
 * ±10 viewport, and the `actions: true` a ticker switches on for itself.
 */
function settingsStatement({ state, options }: DecompileInput): ConfigStatement | null {
    const settings = new Map<string, unknown>();
    const { viewport, ...graph } = state.graph ?? {};

    for (const [key, value] of Object.entries(graph)) {
        settings.set(key, value);
    }
    // The calculator is named by the product it writes, and the graphing
    // calculator - Axis's default - writes none.
    const calculator = Object.entries(AXIS_CALCULATOR_PRODUCTS).find(
        ([, product]) => product !== undefined && product === graph.product,
    );
    if (calculator) settings.set('calculator', calculator[0]);
    for (const [key, value] of Object.entries(viewport ?? {})) {
        settings.set(key, value);
    }
    for (const key of AXIS_STATE_PROPERTY_NAMES) {
        // Desmos reads a state without the flag as the legacy behaviour, so a
        // state without it is a state that says `false`.
        settings.set(key, state[key] ?? false);
    }
    // A calculator hands its seed back at the top of every state, and a new
    // one is drawn for every graph that does not set one - so it is worth a
    // line only to a graph that draws random numbers, where it is the
    // difference between the same draw and another one.
    if (typeof state.randomSeed === 'string' && drawsRandomly(state)) {
        settings.set('randomSeed', state.randomSeed);
    }
    for (const [key, value] of Object.entries(options ?? {})) {
        settings.set(key, value);
    }

    for (const [key, value] of Object.entries({ ...AXIS_DEFAULT_CONFIG, ...AXIS_DEFAULT_STATE })) {
        if (settings.get(key) === value) settings.delete(key);
    }
    if (state.expressions?.ticker?.handlerLatex && settings.get('actions') === true) {
        settings.delete('actions');
    }
    for (const key of AXIS_VIEWPORT_PROPERTY_NAMES) {
        if (settings.get(key) === DEFAULT_VIEWPORT[key]) settings.delete(key);
    }

    // Manifest order, so the block reads the way the language documents it.
    const entries: Property[] = [];
    for (const [name, definition] of CONFIG_PROPERTIES) {
        if (!settings.has(name)) continue;
        const value = configValue(settings.get(name), definition.valueType, definition.values);
        if (value !== undefined) entries.push(property(name, value));
    }

    return entries.length ? { kind: 'ConfigStatement', entries, span: span() } : null;
}

/** Whether anything in the graph calls `random` or `shuffle`, which the seed decides. */
function drawsRandomly(state: GraphState): boolean {
    return /\\operatorname\{(?:random|shuffle)\}/.test(JSON.stringify(state.expressions ?? {}));
}

/**
 * A setting as the value a config entry writes it with, or undefined for a
 * value of the wrong kind - which a real calculator's settings can hold for a
 * key the manifest types more narrowly, and which is better left out than
 * written as an error.
 */
function configValue(
    value: unknown,
    valueType: string,
    values: readonly string[] | undefined,
): PropertyValue | true | undefined {
    switch (valueType) {
        case 'boolean':
            return typeof value === 'boolean' ? (value ? true : identifier('false')) : undefined;
        case 'number':
            return typeof value === 'number' && Number.isFinite(value) ? number(value) : undefined;
        case 'string':
            return typeof value === 'string' ? string(value) : undefined;
        case 'enum': {
            // `actions` is the one enum Desmos holds as a boolean or a word.
            const written = typeof value === 'boolean' ? String(value) : value;
            const spelled =
                typeof written === 'string'
                    ? values?.find(option => option.toLowerCase() === written.toLowerCase())
                    : undefined;
            return spelled === undefined ? undefined : identifier(spelled);
        }
        case 'color': {
            // Config colours take only a hex literal or a palette name.
            if (typeof value !== 'string') return undefined;
            const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
            if (!match) return undefined;
            const digits = match[1].toLowerCase();
            const full = `#${digits.length === 3 ? [...digits].map(d => d + d).join('') : digits}`;
            const named = AXIS_PALETTE.find(color => color.hex === full);
            return named ? identifier(named.name) : { kind: 'Color', value: full, span: span() };
        }
    }
    return undefined;
}
