// ═════════════════════════════════════════════════════════════════════════════
// The Axis decompiler
// ═════════════════════════════════════════════════════════════════════════════
//
// A graph back into the script that would build it: every expression becomes a
// statement, its Desmos properties become the `# key: value` metadata that sets
// them, folders become `folder "…" { … }` blocks, and the calculator's settings
// become the `config { … }` block at the top.
//
// The test of a decompiler is not that its output reads well but that it means
// the same thing, so the contract here is compiling it again:
//
//     compileAxis(decompileAxis(compileAxis(source))) ≡ compileAxis(source)
//
// which `decompile.test.mts` holds every example script to. That is what
// decides the details below - where a value is quoted, where a fraction takes
// brackets - rather than taste.
//
// Two things a graph carries cannot be written in Axis, and are handled rather
// than dropped:
//
//   - **Imports are gone.** They were flattened into folders when the script
//     was compiled, and nothing in the graph records where the contents came
//     from, so they come back as the folder the reader sees.
//   - **A note is one line, in double quotes, and Axis has no escape for
//     either.** A newline in the text becomes a space and a `"` becomes a `'`,
//     because a note that cannot be reopened is worse than one whose quotes
//     changed shape.

import {
    CalculatorOptions,
    DesmosExpression,
    DomainBounds,
    Expression,
    GraphImage,
    GraphSettings,
    TableColumn,
    TickerState,
} from '@axis-dsl/desmos';
import {
    AXIS_ALWAYS_STRING_PROPERTIES,
    AXIS_CONFIG_PROPERTY_NAMES,
    AXIS_DEFAULT_CONFIG,
    bracketDelta,
    escapeString,
    formatAxisCode,
    splitTopLevel,
    splitTopLevelParts,
} from '@axis-dsl/language';
import { convertFromLatex } from './unlatex';

/** A graph to decompile: what {@link compileAxis} produces, or a graph's state. */
export interface DecompileInput {
    expressions: DesmosExpression[];
    settings?: CalculatorOptions;
    /**
     * The graph-state half of a `config` block — the viewport and `squareAxes`.
     * A state off desmos.com holds these under its own `graph` key, which is
     * exactly the shape {@link compileAxis} hands back, so either can be passed
     * through unchanged.
     */
    graph?: GraphSettings;
    /**
     * The graph's ticker, which a state off desmos.com keeps under
     * `expressions.ticker` — beside the list rather than in it, so it has to be
     * handed over separately from the expressions.
     */
    ticker?: TickerState;
}

export interface DecompileOptions {
    /** One level of block indentation. Four spaces, as the formatter writes it. */
    indent?: string;
}

/** The metadata a plain expression carries, in the order it is written out. */
const EXPRESSION_PROPERTIES = [
    'color',
    'colorLatex',
    'lineStyle',
    'lineWidth',
    'lineOpacity',
    'pointStyle',
    'pointSize',
    'movablePointSize',
    'pointOpacity',
    'fillOpacity',
    'fill',
    'lines',
    'points',
    'hidden',
    'secret',
    'dragMode',
    'label',
    'showLabel',
    'labelSize',
    'labelOrientation',
    'suppressTextOutline',
    'pointOutline',
    'description',
] as const;

/** The same, for a table column, which styles itself with a subset of them. */
const COLUMN_PROPERTIES = [
    'color',
    'lineStyle',
    'lineWidth',
    'lineOpacity',
    'pointStyle',
    'pointSize',
    'pointOpacity',
    'lines',
    'points',
    'hidden',
    'dragMode',
] as const;

/** The flags a folder carries, which are only written when they are set. */
const FOLDER_PROPERTIES = ['collapsed', 'hidden', 'secret'] as const;

/** Turn a compiled graph back into the `.axis` source that produces it. */
export function decompileAxis(input: DecompileInput, options: DecompileOptions = {}): string {
    const indent = options.indent ?? '    ';
    const document = new Document();
    const actions = actionNames(input.expressions);

    document.add(decompileConfig(input.settings, input.graph, input.ticker !== undefined, indent));
    document.add(decompileTicker(input.ticker), true);

    // A folder's contents are wherever the expression list happens to keep
    // them, so they are gathered up front: the folder is written where it
    // stands, holding everything that claims it.
    const members = new Map<string, DesmosExpression[]>();
    for (const expression of input.expressions) {
        if (expression.type === 'folder') {
            members.set(expression.id, []);
        }
    }
    for (const expression of input.expressions) {
        if (expression.type !== 'folder' && expression.folderId !== undefined) {
            members.get(expression.folderId)?.push(expression);
        }
    }

    for (const expression of input.expressions) {
        if (expression.type === 'folder') {
            const entries = (members.get(expression.id) ?? [])
                .map(member => decompileStatement(member, indent, actions, true))
                .filter(entry => entry.length);

            document.add(
                block(
                    `folder ${quote(expression.title ?? '')} {`,
                    entries,
                    indent,
                    properties(expression, FOLDER_PROPERTIES, true),
                ),
            );
            continue;
        }

        // An expression inside a folder is written inside it, not again here.
        if (expression.folderId !== undefined && members.has(expression.folderId)) {
            continue;
        }

        document.add(decompileStatement(expression, indent, actions));
    }

    return document.text();
}

/**
 * One expression, as the lines it is written on.
 *
 * `separated` says the statement is going somewhere a comma separates one
 * statement from the next - inside a folder - which is what decides whether a
 * run held together by a top-level comma can be written bare.
 */
function decompileStatement(
    expression: DesmosExpression,
    indent: string,
    actions: ReadonlySet<string>,
    separated = false,
): string[] {
    switch (expression.type) {
        case 'text':
            return [quote(expression.text ?? '')];

        case 'image':
            return decompileImage(expression);

        case 'table':
            return block(
                'table {',
                expression.columns.map(column => [decompileColumn(column)]),
                indent,
            );

        // A folder is never an entry of another one: Desmos has one level of
        // folders, so a folder that claims to sit inside one is written where
        // the list keeps it, as its sibling - which is what the compiler makes
        // of a folder written inside a folder.
        case 'folder':
            return [];

        default: {
            // A graph saved long enough ago writes a note as a bare `text` with
            // no type at all, and Desmos still reads it as one - so the type is
            // not what says a note is a note, the text is.
            const untyped = expression as { text?: string };
            if (typeof untyped.text === 'string') {
                return [quote(untyped.text)];
            }

            const run = convertFromLatex(expression.latex ?? '');
            const code = formatExpression(separated ? groupCommaRun(run, actions) : run);
            const entries = expressionProperties(expression);

            // A row with no expression in it is the blank Desmos keeps for
            // spacing. It is still a row, and still carries the colour of one,
            // so it is written as the metadata alone rather than dropped.
            if (!code) {
                return entries.length ? [`# ${entries.join(', ')}`] : [];
            }

            return [`${code}${trailing(entries)}`];
        }
    }
}

/**
 * A run of things separated by a top-level comma, in the brackets that hold it
 * together: `(1, 2), (3, 4)` -> `[(1, 2), (3, 4)]`.
 *
 * Only for a statement inside a folder, where a comma is what separates one
 * entry from the next and the run would otherwise decompile to an entry apiece
 * - a different graph, and silently so. At the top level the comma separates
 * nothing, so the run is written exactly as Desmos holds it.
 *
 * The two kinds of run Desmos lets be written bare mean different things, and
 * take different brackets:
 *
 *   - **Points** are a list. `length` of one is its number of points, indexing
 *     one gives a point back, and it matches the bracketed list element for
 *     element. Brackets are how Axis writes a list.
 *   - **Actions** are a multi-action, and emphatically not a list - Desmos
 *     answers `\left[a\to1,b\to2\right]` with "Cannot store an action in a
 *     list". Parentheses are what holds one: `\left(a\to1,b\to2\right)` runs
 *     exactly as the bare run does, and the compiler takes them off again.
 */
function groupCommaRun(code: string, actions: ReadonlySet<string>): string {
    const parts = splitTopLevel(code, ',');

    if (parts.length <= 1) {
        return code;
    }

    // Only the value is the run; the name in front of it is not part of one.
    const defined = definitionEnd(code);
    const acts = parts.some(part => isAction(part, actions));

    // A run whose commas belong to a `with` or a `for` is not a run at all -
    // one value, whose bindings reach to the end of it - so it takes the
    // brackets a multi-action takes, which say "this is one thing" and nothing
    // more. Only a genuine list gets the square pair.
    const [open, close] = acts || bindsCommas(parts[0]) ? ['(', ')'] : ['[', ']'];

    return `${code.slice(0, defined)}${open}${code.slice(defined).trim()}${close}`;
}

/**
 * Whether the commas after `part` are bindings of a `with` or a `for`.
 *
 * Only one at the top level counts: a `for` inside a bracketed comprehension
 * belongs to that comprehension, and its bindings are held apart by the
 * brackets already.
 */
function bindsCommas(part: string): boolean {
    let depth = 0;

    for (let i = 0; i < part.length; i++) {
        const char = part[i];
        if ('([{'.includes(char)) {
            depth += 1;
        } else if (')]}'.includes(char)) {
            depth -= 1;
        } else if (depth === 0 && /[a-zA-Z]/.test(char)) {
            const word = /^(?:with|for)(?![a-zA-Z0-9_])/.exec(part.slice(i));
            if (word && !/[a-zA-Z0-9_]/.test(part[i - 1] ?? '')) {
                return true;
            }
        }
    }

    return false;
}

/**
 * The names the graph defines as actions, which may not go in a list either.
 *
 * A run of them - `Randomize = RandBeach, RandCloud` - is a multi-action like
 * any other, but nothing in the run itself says so: the arrows are in the
 * definitions elsewhere. So the graph is read for them first, and a name found
 * there counts as an action wherever it is used.
 */
function actionNames(expressions: readonly DesmosExpression[]): ReadonlySet<string> {
    const names = new Set<string>();

    for (const expression of expressions) {
        const latex = (expression as Expression).latex;
        if (!latex?.includes('\\to')) {
            continue;
        }
        const name = /^([a-zA-Z](?:_\{[a-zA-Z0-9]+\})?)=/.exec(latex)?.[1];
        if (name) {
            names.add(convertFromLatex(name));
        }
    }

    return names;
}

/**
 * Whether `code` performs an action, which a list may not hold.
 *
 * Anywhere in the part, not only at its top level: a piecewise that chooses
 * between two actions - `{p = 0: a -> 1, a -> 0}` - is an action itself, and
 * putting one in a list is the same error as putting a bare arrow there.
 */
function isAction(code: string, actions: ReadonlySet<string>): boolean {
    return code.includes('->') || actions.has(code.trim());
}

/**
 * Where a definition's value starts - just past its `=` - or 0 when the
 * statement defines nothing and is a value throughout.
 *
 * `<=`, `>=` and `->` all carry an `=` or point like one without defining
 * anything, so the character either side of a candidate has to be looked at.
 */
function definitionEnd(code: string): number {
    for (const part of splitTopLevelParts(code, '=')) {
        const at = part.start + part.text.length;
        if (at >= code.length) {
            break;
        }
        if (!/[<>!=]/.test(code[at - 1] ?? '') && code[at + 1] !== '=') {
            return at + 1;
        }
    }

    return 0;
}

/**
 * Drop `movablePointSize` when it only repeats `pointSize`.
 *
 * That is what the compiler writes for a script that named one size, so writing
 * both back would grow a property the author never typed - and it would grow
 * again on every round trip. A graph that really does size its draggable state
 * differently keeps both.
 */
function sized<T extends { pointSize?: number | string; movablePointSize?: number | string }>(
    source: T,
): T {
    if (source.movablePointSize === undefined || source.movablePointSize !== source.pointSize) {
        return source;
    }
    const { movablePointSize: _dropped, ...rest } = source;
    return rest as T;
}

/** A table column: its header, the values under it, and how it is drawn. */
function decompileColumn(column: TableColumn): string {
    // Values are the one thing the compiler takes verbatim rather than
    // converting, so they go back exactly as they are held.
    const values = column.values?.length ? ` = [${column.values.join(', ')}]` : '';
    const header = formatExpression(convertFromLatex(column.latex ?? ''));

    return `${header}${values}${trailing(properties(sized(column), COLUMN_PROPERTIES))}`;
}

/** Every `# key: value` a plain expression carries, slider and click included. */
function expressionProperties(expression: Expression): string[] {
    const entries = properties(sized(expression), EXPRESSION_PROPERTIES);
    const { slider, clickableInfo } = expression;

    entries.push(...domainProperties(expression));

    if (slider && (slider.min !== undefined || slider.max !== undefined)) {
        // A bound Desmos leaves off is the one it assumes, so it is left off
        // here too: writing the default out would pin a slider whose ceiling
        // the author raised and whose floor they never touched.
        // Every end is latex rather than a number - a slider's range can be
        // computed from the rest of the graph - so each is read back as the
        // expression it is, exactly as the statement in front of it was.
        const bound = (latex: string) => expressionValue(latex);

        const bounds: string[] = [];
        if (slider.min !== undefined) {
            bounds.push(`min: ${bound(slider.min)}`);
        }
        if (slider.max !== undefined) {
            bounds.push(`max: ${bound(slider.max)}`);
        }
        if (slider.step !== undefined) {
            bounds.push(`step: ${bound(slider.step)}`);
        }
        // A bound Desmos does not mark hard is one the slider may be dragged
        // past, and `sliderBounds` hardens both ends unless told not to - so a
        // soft bound is the one that has to be written down.
        if (slider.hardMin !== true) {
            bounds.push('hardMin: false');
        }
        if (slider.hardMax !== true) {
            bounds.push('hardMax: false');
        }
        entries.push(`sliderBounds: {${bounds.join(', ')}}`);
    }
    if (slider?.isPlaying !== undefined) {
        entries.push(`playing: ${slider.isPlaying}`);
    }
    if (slider?.loopMode !== undefined) {
        entries.push(`loopMode: ${slider.loopMode}`);
    }
    if (slider?.playDirection !== undefined) {
        entries.push(`playDirection: ${slider.playDirection}`);
    }
    if (slider?.animationPeriod !== undefined) {
        entries.push(`animationPeriod: ${slider.animationPeriod}`);
    }

    if (clickableInfo) {
        if (clickableInfo.latex) {
            const action = formatExpression(convertFromLatex(clickableInfo.latex));
            entries.push(`onClick: ${value(action, 'code')}`);
        }
        // Desmos writes a switched-off clickable by leaving `enabled` off
        // rather than storing `false`, so anything short of `true` is off.
        const enabled = clickableInfo.enabled === true;
        // An action implies a click that runs, so the flag is only written when
        // it says something the action does not: a click switched off, or a
        // point made clickable with nothing of its own to run.
        if (!enabled || !clickableInfo.latex) {
            entries.push(`clickable: ${enabled}`);
        }
    }

    return entries;
}

/**
 * The `domain`, `parametricDomain` and `polarDomain` a curve is drawn over.
 *
 * Desmos keeps the first two as copies of one another, so one `domain` sets
 * both and only a graph whose copies disagree writes the second out. They do
 * disagree in the wild: Desmos writes an unset lower bound as `0` under
 * `domain` and as the empty string under `parametricDomain`, and which of the
 * two a given curve carries depends on how old it is.
 */
function domainProperties(expression: Expression): string[] {
    const { domain, parametricDomain, polarDomain } = expression;
    const entries: string[] = [];

    if (domain) {
        entries.push(`domain: ${domainValue(domain)}`);
    }
    if (parametricDomain && (!domain || !sameDomain(domain, parametricDomain))) {
        entries.push(`parametricDomain: ${domainValue(parametricDomain)}`);
    }
    if (polarDomain) {
        entries.push(`polarDomain: ${domainValue(polarDomain)}`);
    }

    return entries;
}

function sameDomain(a: DomainBounds, b: DomainBounds): boolean {
    return a.min === b.min && a.max === b.max;
}

/** `{min: 0, max: 2pi}`, with each end read back as the expression it is. */
function domainValue(bounds: DomainBounds): string {
    const end = (latex: string | number) => expressionValue(String(latex));
    return `{min: ${end(bounds.min)}, max: ${end(bounds.max)}}`;
}

/** The `image "…"` statement, and the placement and sizing behind it. */
function decompileImage(image: GraphImage): string[] {
    const entries: string[] = [];

    const write = (key: string, latex: string | undefined) => {
        if (latex !== undefined) {
            entries.push(`${key}: ${expressionValue(latex)}`);
        }
    };

    if (image.name !== undefined) {
        entries.push(`name: ${value(image.name)}`);
    }
    write('center', image.center);
    write('width', image.width);
    write('height', image.height);
    write('angle', image.angle);
    write('opacity', image.opacity);

    for (const key of ['foreground', 'hidden', 'secret', 'dragMode'] as const) {
        const flag = image[key];
        if (isValue(flag)) {
            entries.push(`${key}: ${value(flag)}`);
        }
    }

    return [`image ${quote(image.image_url ?? '')}${trailing(entries)}`];
}

/**
 * The `ticker …` statement, or nothing when the graph has no ticker.
 *
 * Written near the top, under the config block: a ticker belongs to the graph
 * rather than to any expression, and where it stands says nothing about when it
 * runs.
 */
function decompileTicker(ticker: TickerState | undefined): string[] {
    if (!ticker?.handlerLatex) {
        return [];
    }

    const entries: string[] = [];
    if (ticker.minStepLatex !== undefined) {
        entries.push(`minStep: ${value(convertFromLatex(ticker.minStepLatex), 'coerced')}`);
    }
    // Desmos says "not playing" and "not open" by leaving the key off rather
    // than by storing false, so only the true ones are worth writing.
    if (ticker.playing === true) {
        entries.push('playing: true');
    }
    if (ticker.open === true) {
        entries.push('open: true');
    }

    const handler = formatExpression(convertFromLatex(ticker.handlerLatex));

    return [`ticker ${handler}${trailing(entries)}`];
}

/** The `config { … }` block for a graph's settings, or nothing when it has none. */
function decompileConfig(
    settings: CalculatorOptions | undefined,
    graph: GraphSettings | undefined,
    hasTicker: boolean,
    indent: string,
): string[] {
    if (!settings && !graph) {
        return [];
    }

    // Manifest order first, so the block reads the way the language documents
    // it; anything else the graph carries follows in the order it is held.
    const record = { ...settings, ...flattenGraph(graph) } as Record<string, unknown>;

    // The inverse of the compiler switching actions on for a ticker: written
    // back, it would grow a config block the author never wrote, and the
    // `ticker` statement standing next to it puts the setting there again.
    if (hasTicker && record.actions === true) {
        delete record.actions;
    }

    // Likewise for the options Axis switches off on its own: a script that says
    // nothing compiles to them, so writing them back would put four lines the
    // author never wrote at the top of every decompiled graph.
    for (const [key, value] of Object.entries(AXIS_DEFAULT_CONFIG)) {
        if (record[key] === value) {
            delete record[key];
        }
    }

    const named = AXIS_CONFIG_PROPERTY_NAMES.filter(name => record[name] !== undefined);
    const rest = Object.keys(record).filter(key => !named.includes(key));

    const entries = [...named, ...rest]
        .filter(key => isValue(record[key]))
        .map(key => [`${key}: ${value(record[key] as string | number | boolean)}`]);

    return entries.length ? block('config {', entries, indent) : [];
}

/**
 * A graph's state settings as the flat config keys that set them: the viewport
 * rectangle becomes `xmin`/`xmax`/`ymin`/`ymax`, and `squareAxes` is already
 * flat.
 *
 * The nesting only exists because Desmos' state nests it. Axis says the four
 * edges as four keys, so this is where the two shapes meet.
 */
function flattenGraph(graph: GraphSettings | undefined): Record<string, unknown> {
    if (!graph) {
        return {};
    }

    const { viewport, ...rest } = graph;
    return { ...rest, ...viewport };
}

/**
 * The `key: value` entries for the `keys` that `source` actually sets.
 *
 * `onlyTrue` is for the flags a folder always carries: Desmos writes
 * `collapsed: false` where the script simply said nothing.
 */
function properties<T>(source: T, keys: readonly (keyof T & string)[], onlyTrue = false): string[] {
    const entries: string[] = [];

    for (const key of keys) {
        const property = source[key];
        if (!isValue(property) || (onlyTrue && property !== true)) {
            continue;
        }
        // The always-string properties are the ones Desmos holds as latex - a
        // width, an opacity, a colour - and any of them may be an expression
        // rather than a number, so each is read back as one. The rest are text
        // Desmos stores as it was given: a colour name, an enum, a label.
        const written = AXIS_ALWAYS_STRING_PROPERTIES.has(key)
            ? expressionValue(String(property))
            : value(property, 'text');
        entries.push(`${key}: ${written}`);
    }

    return entries;
}

/**
 * A property Desmos holds as latex, as the Axis expression that compiles to it.
 *
 * Spaced the way the formatter spaces a statement, since that is what it is:
 * `center: (1, 2)` reads as an author would write it, and `(1,2)` does not.
 */
function expressionValue(latex: string): string {
    return value(formatExpression(convertFromLatex(latex)), 'coerced');
}

function isValue(property: unknown): property is string | number | boolean {
    return (
        typeof property === 'string' ||
        typeof property === 'number' ||
        typeof property === 'boolean'
    );
}

/**
 * What a value is read as, which is what decides whether it needs quoting.
 *
 * `text` is an ordinary property, `code` an expression the compiler compiles in
 * turn - an `onClick` action, which reads better with its spaces showing - and
 * `coerced` a property the compiler puts through the same reading whatever it
 * is given: the numeric properties Desmos wants as strings, and a slider's
 * bounds.
 */
type ValueKind = 'text' | 'code' | 'coerced';

/**
 * Write a value the way the compiler reads it back.
 *
 * Quotes are what makes a value a string, so anything that would otherwise be
 * read as a number, a boolean, or two entries takes them, as does any text with
 * a space in it. A bare word, a hex colour or an enum is left as written, which
 * is how the examples read.
 *
 * A bracket the value leaves open takes them too, and has to: metadata inside a
 * block ends at the `}` that closes the block around it, so a label of `}`
 * written bare would close the folder it sits in and hand the rest of it to
 * whatever came next. Quoted, it is text like any other.
 */
function value(setting: string | number | boolean, kind: ValueKind = 'text'): string {
    if (typeof setting !== 'string') {
        return String(setting);
    }

    const text = setting.replace(/\s*\n\s*/g, ' ');
    const ambiguous =
        text.trim() !== text ||
        text === '' ||
        /["']/.test(text) ||
        bracketDelta(text) !== 0 ||
        splitTopLevel(text, ',').length > 1 ||
        (kind === 'text' &&
            (/\s/.test(text) || text === 'true' || text === 'false' || isNumeric(text)));

    return ambiguous ? quote(text) : text;
}

function isNumeric(text: string): boolean {
    return text.trim() !== '' && !Number.isNaN(Number(text));
}

/** A double-quoted string, with the quotes Axis cannot escape turned aside. */
function quote(text: string): string {
    return `"${escapeString(text)}"`;
}

/**
 * Indent every line of `text`, which may be several.
 *
 * A statement long enough to be wrapped arrives here as one entry holding the
 * newlines the formatter put in it, so indenting the string rather than each of
 * its lines would push the first line in and leave the rest - and the closing
 * bracket - standing at the margin. Blank lines are left empty rather than
 * padded out with trailing spaces.
 */
function indentLines(text: string, indent: string): string {
    return text
        .split('\n')
        .map(line => (line ? `${indent}${line}` : line))
        .join('\n');
}

/** ` # a: 1, b: 2`, or nothing at all when there is no metadata to write. */
function trailing(entries: string[]): string {
    return entries.length ? ` # ${entries.join(', ')}` : '';
}

/**
 * A block and the entries inside it, one indented statement each.
 *
 * One entry to a line, with nothing between them: a block's entries are
 * separated by their newlines, the same way top-level statements are, so the
 * commas a script may still be written with are not written back out.
 */
function block(
    header: string,
    entries: string[][],
    indent: string,
    metadata: string[] = [],
): string[] {
    const lines = [`${header}${trailing(metadata)}`];

    for (const entry of entries) {
        lines.push(...entry.map(line => indentLines(line, indent)));
    }

    return [...lines, '}'];
}

/**
 * Space an expression the way the formatter would, so decompiled source reads
 * like written source.
 *
 * Only the code is passed through it: the formatter normalises the spacing
 * around `:` and `,` as well, which inside a quoted label would rewrite the
 * text rather than the layout.
 */
function formatExpression(code: string): string {
    if (!code.trim()) {
        return '';
    }

    // The formatter spaces what is written around an operator rather than what
    // it means, and LaTeX writes its commas closed up - so `(n,-2)` would come
    // back as `(n, - 2)`. Separating the arguments first leaves the minus where
    // it belongs, against the number it negates.
    const separated = code.trim().replace(/,(?=\S)/g, ', ');

    return formatAxisCode(separated, { tabSize: 4, insertSpaces: true });
}

/**
 * The statements of a script, with a blank line held around anything written as
 * a block - which is how the examples are laid out, and what makes a long list
 * of expressions readable.
 */
class Document {
    private readonly lines: string[] = [];

    /**
     * `apart` is what puts a blank line either side. It defaults to whether the
     * statement is a block, which is what the rule was written for; the ticker
     * asks for it on one line, being preamble rather than one of the statements
     * the list is made of.
     */
    add(statement: string[], apart = statement.length > 1): void {
        if (!statement.length) {
            return;
        }
        if (apart && this.lines.length && this.lines[this.lines.length - 1] !== '') {
            this.lines.push('');
        }
        this.lines.push(...statement);
        if (apart) {
            this.lines.push('');
        }
    }

    text(): string {
        const trimmed = [...this.lines];
        while (trimmed[trimmed.length - 1] === '') {
            trimmed.pop();
        }
        return trimmed.length ? `${trimmed.join('\n')}\n` : '';
    }
}
