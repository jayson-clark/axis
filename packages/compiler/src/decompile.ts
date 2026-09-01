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

import { CalculatorOptions, DesmosExpression, Expression, TableColumn } from '@axis-dsl/desmos';
import {
    AXIS_ALWAYS_STRING_PROPERTIES,
    AXIS_CONFIG_PROPERTY_NAMES,
    formatAxisCode,
    splitTopLevel,
} from '@axis-dsl/language';
import { convertFromLatex } from './unlatex';

/** A graph to decompile: what {@link compileAxis} produces, or a graph's state. */
export interface DecompileInput {
    expressions: DesmosExpression[];
    settings?: CalculatorOptions;
}

export interface DecompileOptions {
    /** One level of block indentation. Four spaces, as the formatter writes it. */
    indent?: string;
}

/** The metadata a plain expression carries, in the order it is written out. */
const EXPRESSION_PROPERTIES = [
    'color',
    'lineStyle',
    'lineWidth',
    'lineOpacity',
    'pointStyle',
    'pointSize',
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

/**
 * The slider bounds Desmos assumes, and so leaves off a graph's state.
 *
 * @see https://help.desmos.com/hc/en-us/articles/4406810279693-Sliders
 */
const DEFAULT_SLIDER_BOUNDS = { min: '-10', max: '10' };

/** The flags a folder carries, which are only written when they are set. */
const FOLDER_PROPERTIES = ['collapsed', 'hidden', 'secret'] as const;

/** Turn a compiled graph back into the `.axis` source that produces it. */
export function decompileAxis(input: DecompileInput, options: DecompileOptions = {}): string {
    const indent = options.indent ?? '    ';
    const document = new Document();

    document.add(decompileConfig(input.settings, indent));

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
                .map(member => decompileStatement(member, indent))
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

        document.add(decompileStatement(expression, indent));
    }

    return document.text();
}

/** One expression, as the lines it is written on. */
function decompileStatement(expression: DesmosExpression, indent: string): string[] {
    switch (expression.type) {
        case 'text':
            return [quote(noteText(expression.text ?? ''))];

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
            const code = formatExpression(convertFromLatex(expression.latex ?? ''));
            return code ? [`${code}${trailing(expressionProperties(expression))}`] : [];
        }
    }
}

/** A table column: its header, the values under it, and how it is drawn. */
function decompileColumn(column: TableColumn): string {
    // Values are the one thing the compiler takes verbatim rather than
    // converting, so they go back exactly as they are held.
    const values = column.values?.length ? ` = [${column.values.join(', ')}]` : '';
    const header = formatExpression(convertFromLatex(column.latex ?? ''));

    return `${header}${values}${trailing(properties(column, COLUMN_PROPERTIES))}`;
}

/** Every `# key: value` a plain expression carries, slider and click included. */
function expressionProperties(expression: Expression): string[] {
    const entries = properties(expression, EXPRESSION_PROPERTIES);
    const { slider, clickableInfo } = expression;

    if (slider && (slider.min !== undefined || slider.max !== undefined)) {
        // Desmos leaves a bound off the state when it matches its own default,
        // and `sliderBounds` needs both ends, so the default goes back in - an
        // omitted bound is the default, not no bound.
        const bounds = [
            `min: ${value(slider.min ?? DEFAULT_SLIDER_BOUNDS.min, 'coerced')}`,
            `max: ${value(slider.max ?? DEFAULT_SLIDER_BOUNDS.max, 'coerced')}`,
        ];
        if (slider.step !== undefined) {
            bounds.push(`step: ${value(slider.step, 'coerced')}`);
        }
        entries.push(`sliderBounds: {${bounds.join(', ')}}`);
    }
    if (slider?.isPlaying !== undefined) {
        entries.push(`playing: ${slider.isPlaying}`);
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

/** The `config { … }` block for a graph's settings, or nothing when it has none. */
function decompileConfig(settings: CalculatorOptions | undefined, indent: string): string[] {
    if (!settings) {
        return [];
    }

    // Manifest order first, so the block reads the way the language documents
    // it; anything else the graph carries follows in the order it is held.
    const record = settings as Record<string, unknown>;
    const named = AXIS_CONFIG_PROPERTY_NAMES.filter(name => record[name] !== undefined);
    const rest = Object.keys(record).filter(key => !named.includes(key));

    const entries = [...named, ...rest]
        .filter(key => isValue(record[key]))
        .map(key => [`${key}: ${value(record[key] as string | number | boolean)}`]);

    return entries.length ? block('config {', entries, indent) : [];
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
        entries.push(
            `${key}: ${value(property, AXIS_ALWAYS_STRING_PROPERTIES.has(key) ? 'coerced' : 'text')}`,
        );
    }

    return entries;
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
    return `"${text.replace(/"/g, "'")}"`;
}

/** A note is a single quoted line, so its own line breaks close up to spaces. */
function noteText(text: string): string {
    return text.replace(/\s*\n\s*/g, ' ');
}

/** ` # a: 1, b: 2`, or nothing at all when there is no metadata to write. */
function trailing(entries: string[]): string {
    return entries.length ? ` # ${entries.join(', ')}` : '';
}

/**
 * A block and the entries inside it, one indented statement each.
 *
 * Entries inside a bracket are comma separated however they are laid out, and
 * only the last one may go without - so the comma lands on the line that ends
 * each entry, which for a nested block is its closing brace.
 */
function block(
    header: string,
    entries: string[][],
    indent: string,
    metadata: string[] = [],
): string[] {
    const lines = [`${header}${trailing(metadata)}`];

    entries.forEach((entry, position) => {
        const body = entry.map(line => `${indent}${line}`);
        if (position < entries.length - 1) {
            body[body.length - 1] += ',';
        }
        lines.push(...body);
    });

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

    add(statement: string[]): void {
        if (!statement.length) {
            return;
        }
        if (statement.length > 1 && this.lines.length && this.lines[this.lines.length - 1] !== '') {
            this.lines.push('');
        }
        this.lines.push(...statement);
        if (statement.length > 1) {
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
