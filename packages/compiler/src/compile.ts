// ═════════════════════════════════════════════════════════════════════════════
// The Axis compiler
// ═════════════════════════════════════════════════════════════════════════════
//
// One statement per line becomes one Desmos expression. On top of that:
//
//   - `// …` lines are comments, and `# key: value` trailing a statement is its
//     metadata (color, lineStyle, sliderBounds, onClick, …)
//   - `folder "Name" { … }`, `table { … }` and `config { … }` are blocks
//   - `"Text"` on its own is a note
//   - `import "other.axis"` drops another script in, flattened into a folder
//   - a block written inline reads the same as one spread over lines, because
//     @axis-dsl/language flattens it first

import {
    CalculatorOptions,
    ClickableInfo,
    DesmosExpression,
    Expression,
    Folder,
    Note,
    SliderBounds,
    SliderState,
    Table,
    TableColumn,
} from '@axis-dsl/desmos';
import {
    AXIS_ALWAYS_STRING_PROPERTIES,
    expandBlockEntries,
    IMPORT_KEYWORD,
    importTitle,
    joinContinuedLines,
    parseImportStatement,
    splitTopLevel,
    splitTrailingMetadata,
} from '@axis-dsl/language';
import { ResolveImport } from './imports';
import { convertToLatex } from './latex';

export interface CompilationResult {
    expressions: DesmosExpression[];
    /**
     * The `config { … }` block, if the script or anything it imports has one.
     * Imported settings are merged first, so the entry script always wins.
     */
    settings?: CalculatorOptions;
    /**
     * Every file pulled in by `import`, transitively, as the resolver named it.
     * A host watching a script for changes has to watch these too.
     */
    imports: string[];
}

export interface CompileOptions {
    /**
     * Where the script itself lives. Handed back to {@link resolveImport} as the
     * file a specifier was written in, so relative imports have something to be
     * relative to.
     */
    path?: string;
    /**
     * How `import "…"` finds its source. A script with imports and no resolver
     * fails to compile rather than quietly dropping them.
     */
    resolveImport?: ResolveImport;
}

/** A value as it is written after a `key:`, before any property claims it. */
type MetadataValue = string | number | boolean | SliderBounds;

/**
 * Values parsed out of a `# key: value` run, keyed by property name.
 *
 * Deliberately not `any`: every read below is narrowed by {@link asString} and
 * friends, so a property that reaches Desmos in the wrong shape is a type error
 * here rather than a setting it silently ignores.
 */
type Metadata = Record<string, MetadataValue | undefined>;

const asString = (value: MetadataValue | undefined): string | undefined =>
    typeof value === 'string' ? value : undefined;

const asNumberOrString = (value: MetadataValue | undefined): number | string | undefined =>
    typeof value === 'number' || typeof value === 'string' ? value : undefined;

const asBoolean = (value: MetadataValue | undefined): boolean | undefined =>
    typeof value === 'boolean' ? value : undefined;

const asSliderBounds = (value: MetadataValue | undefined): SliderBounds | undefined =>
    typeof value === 'object' ? value : undefined;

/**
 * What one file contributes, and where its expressions land.
 *
 * A file compiles the same way whether it is the script itself or something the
 * script imports; these three fields are the whole of the difference.
 */
interface FileScope {
    /** The file's own path, so the imports written in it resolve against it. */
    path: string;
    /** The folder everything in the file belongs to, if any. */
    folderId?: string;
    /**
     * True for an imported file, whose own `folder` blocks are dropped and their
     * contents hoisted: Desmos has one level of folders, and the import has
     * already claimed it.
     */
    flatten: boolean;
}

/** Compile a `.axis` script into Desmos expressions and calculator settings. */
export function compileAxis(script: string, options: CompileOptions = {}): CompilationResult {
    const expressions: DesmosExpression[] = [];
    const imports: string[] = [];
    // Held apart rather than merged as they are found, so the entry script's
    // settings win over an imported file's wherever its config block is written.
    const importedConfigs: Record<string, unknown>[] = [];
    const rootConfigs: Record<string, unknown>[] = [];

    let expressionCount = 0;
    const nextId = (prefix: string) => `${prefix}_${++expressionCount}`;

    // The files being compiled, outermost first, so a cycle can be spotted -
    // the entry script included, since a file can import itself.
    const chain: string[] = options.path === undefined ? [] : [options.path];

    /**
     * Compile one file's statements into `expressions`.
     *
     * A statement can span lines while a `(` or `[` is open, so the continuation
     * lines are folded back in; a block written inline is then spread back out,
     * leaving exactly one statement per line either way.
     */
    function emitFile(source: string, scope: FileScope): void {
        const lines = expandBlockEntries(joinContinuedLines(source));

        let currentFolderId = scope.folderId;
        let currentTable: { id: string; columns: TableColumn[] } | undefined;
        let currentConfig: Record<string, unknown> | undefined;
        let currentPiecewise:
            { variableName: string; items: string[]; metadata: Metadata } | undefined;
        /** Set while inside a folder an import flattened away. */
        let droppedFolder = false;

        for (const rawLine of lines) {
            let line = rawLine.replace(/\t/g, '    ').trim();

            if (!line || line.startsWith('//')) {
                continue;
            }

            let metadata: Metadata = {};
            const split = splitTrailingMetadata(line);
            if (split.metadata !== undefined) {
                line = split.code;
                metadata = parseMetadata(split.metadata);
            }

            // Folders
            const folderMatch = /^folder\s+"([^"]+)"\s*\{/.exec(line);
            if (folderMatch) {
                // An imported file's folders are not folders of their own; what
                // was in them joins the folder the import landed in.
                if (scope.flatten) {
                    droppedFolder = true;
                    continue;
                }
                currentFolderId = nextId('folder');
                expressions.push({
                    type: 'folder',
                    id: currentFolderId,
                    title: folderMatch[1],
                    collapsed: metadata.collapsed === true,
                    hidden: metadata.hidden === true,
                    secret: metadata.secret === true,
                } satisfies Folder);
                continue;
            }

            // Whichever block is open, closed
            if (line === '}') {
                if (currentPiecewise) {
                    const items = convertToLatex(currentPiecewise.items.join(', '));
                    const name = currentPiecewise.variableName;
                    const latex = name
                        ? `${convertToLatex(name)}=\\left\\{${items}\\right\\}`
                        : `\\left\\{${items}\\right\\}`;
                    expressions.push(
                        buildExpression(
                            nextId('expr'),
                            latex,
                            currentFolderId,
                            currentPiecewise.metadata,
                        ),
                    );
                    currentPiecewise = undefined;
                } else if (currentConfig) {
                    (scope.flatten ? importedConfigs : rootConfigs).push(currentConfig);
                    currentConfig = undefined;
                } else if (currentTable) {
                    expressions.push({
                        type: 'table',
                        id: currentTable.id,
                        columns: currentTable.columns,
                        folderId: currentFolderId,
                    } satisfies Table);
                    currentTable = undefined;
                } else if (droppedFolder) {
                    droppedFolder = false;
                } else {
                    // Back to wherever the file itself sits: nothing for a
                    // script, the import's folder for an imported one.
                    currentFolderId = scope.folderId;
                }
                continue;
            }

            if (/^config\b/.test(line)) {
                currentConfig = {};
                continue;
            }

            if (/^table\b/.test(line)) {
                currentTable = { id: nextId('table'), columns: [] };
                continue;
            }

            if (currentConfig) {
                applyConfigEntries(currentConfig, line);
                continue;
            }

            if (currentPiecewise) {
                const item = line.replace(/,$/, '').trim();
                if (item) {
                    currentPiecewise.items.push(item);
                }
                continue;
            }

            if (currentTable) {
                const column = buildColumn(line, metadata);
                if (column) {
                    currentTable.columns.push({ id: nextId('col'), ...column });
                }
                continue;
            }

            // Imports
            if (IMPORT_KEYWORD.test(line)) {
                emitImport(line, metadata, currentFolderId, scope);
                continue;
            }

            // Notes
            if (line.startsWith('"') && line.endsWith('"')) {
                expressions.push({
                    type: 'text',
                    id: nextId('note'),
                    text: line.slice(1, -1),
                    folderId: currentFolderId,
                } satisfies Note);
                continue;
            }

            // A multi-line piecewise or list: `a = {` or a bare `{`, whose body is
            // collected until the closing `}`.
            const piecewiseStart = /^([^=]+)=\s*\{$/.exec(line);
            if (piecewiseStart || line === '{') {
                currentPiecewise = {
                    variableName: piecewiseStart ? piecewiseStart[1].trim() : '',
                    items: [],
                    metadata,
                };
                continue;
            }

            // Everything else - including piecewises, lists and constraints wherever
            // they appear in the line (`p(x) = 3{x<0: -x}`, `y = x^2 {x > 0}`) -
            // converts as one expression, since convertToLatex turns braces into
            // \left\{ \right\} itself.
            expressions.push(
                buildExpression(nextId('expr'), convertToLatex(line), currentFolderId, metadata),
            );
        }
    }

    /**
     * Drop an imported file in, flattened into a folder of its own.
     *
     * An import that is already inside a folder joins that folder instead of
     * opening another, since Desmos cannot nest them - so importing a file into
     * a folder, and importing a file that itself imports another, both come out
     * as one flat folder.
     */
    function emitImport(
        line: string,
        metadata: Metadata,
        folderId: string | undefined,
        scope: FileScope,
    ): void {
        const statement = parseImportStatement(line);
        if (!statement) {
            throw new Error(
                `\`${line}\` is not a valid import - write it as \`import "./file.axis"\`.`,
            );
        }

        const resolved = options.resolveImport?.(statement.specifier, scope.path);
        if (!resolved) {
            throw new Error(
                `Cannot resolve import "${statement.specifier}"${scope.path ? ` from ${scope.path}` : ''}.`,
            );
        }

        if (chain.includes(resolved.path)) {
            throw new Error(
                `Import cycle: ${[...chain.slice(chain.indexOf(resolved.path)), resolved.path].join(' -> ')}`,
            );
        }

        if (!imports.includes(resolved.path)) {
            imports.push(resolved.path);
        }

        let target = folderId;
        if (target === undefined) {
            target = nextId('folder');
            expressions.push({
                type: 'folder',
                id: target,
                title: statement.title ?? importTitle(resolved.path),
                // An import is a folder the reader did not write, holding a
                // file they are not reading. It starts shut unless the import
                // says `collapsed: false`.
                collapsed: metadata.collapsed !== false,
                hidden: metadata.hidden === true,
                secret: metadata.secret === true,
            } satisfies Folder);
        }

        chain.push(resolved.path);
        emitFile(resolved.source, { path: resolved.path, folderId: target, flatten: true });
        chain.pop();
    }

    emitFile(script, { path: options.path ?? '', flatten: false });

    const layers = [...importedConfigs, ...rootConfigs];
    const settings = layers.length
        ? (Object.assign({}, ...layers) as CalculatorOptions)
        : undefined;

    return { expressions, settings, imports };
}

/**
 * Read `key: value` config entries out of `text` into `config`.
 *
 * Entries arrive one per line, but a line is still split on commas so that a
 * hand-written `a: 1, b: 2` parses the same as the expanded form.
 */
function applyConfigEntries(config: Record<string, unknown>, text: string): void {
    for (const part of splitTopLevel(text, ',')) {
        const colon = part.indexOf(':');
        if (colon === -1) {
            continue;
        }

        const key = part.slice(0, colon).trim();
        const value = part.slice(colon + 1).trim();
        if (key && value) {
            config[key] = parseValue(value);
        }
    }
}

/**
 * Parse a table column: `x = [1, 2, 3]`, a bare `x`, or a piecewise `{x = 2: 1}`.
 * Returns undefined for a line that is neither.
 */
function buildColumn(line: string, metadata: Metadata): Omit<TableColumn, 'id'> | undefined {
    const piecewise = /^\{([^}]+)\}$/.exec(line);
    const assignment = /([^=]+)(?:=\s*\[(.*)\])?/.exec(line);

    let column: { latex: string; values: string[] };
    if (piecewise) {
        column = { latex: `\\left\\{${convertToLatex(piecewise[1])}\\right\\}`, values: [] };
    } else if (assignment) {
        column = {
            latex: convertToLatex(assignment[1].trim()),
            values: assignment[2] ? assignment[2].split(',').map(value => value.trim()) : [],
        };
    } else {
        return undefined;
    }

    return {
        ...column,
        color: asString(metadata.color),
        hidden: asBoolean(metadata.hidden),
        lineStyle: asString(metadata.lineStyle),
        pointStyle: asString(metadata.pointStyle),
        lineWidth: asNumberOrString(metadata.lineWidth),
        lineOpacity: asNumberOrString(metadata.lineOpacity),
        pointSize: asNumberOrString(metadata.pointSize),
        pointOpacity: asNumberOrString(metadata.pointOpacity),
        lines: asBoolean(metadata.lines),
        points: asBoolean(metadata.points),
        dragMode: asString(metadata.dragMode),
    };
}

/**
 * Build an expression from a line's latex plus its `# key: value` metadata.
 *
 * Every expression form (plain, list, piecewise) styles itself the same way, so
 * the mapping from metadata to Desmos properties lives here.
 */
function buildExpression(
    id: string,
    latex: string,
    folderId: string | undefined,
    metadata: Metadata,
): Expression {
    const expression: Expression = {
        type: 'expression',
        id,
        latex,
        folderId,
        color: asString(metadata.color),
        lineStyle: asString(metadata.lineStyle),
        lineWidth: asNumberOrString(metadata.lineWidth),
        lineOpacity: asNumberOrString(metadata.lineOpacity),
        pointStyle: asString(metadata.pointStyle),
        pointSize: asNumberOrString(metadata.pointSize),
        pointOpacity: asNumberOrString(metadata.pointOpacity),
        fillOpacity: asNumberOrString(metadata.fillOpacity),
        points: asBoolean(metadata.points),
        lines: asBoolean(metadata.lines),
        fill: asBoolean(metadata.fill),
        hidden: asBoolean(metadata.hidden),
        secret: asBoolean(metadata.secret),
        slider: buildSlider(metadata),
        dragMode: asString(metadata.dragMode),
        label: asString(metadata.label),
        showLabel: asBoolean(metadata.showLabel),
        labelSize: asString(metadata.labelSize),
        labelOrientation: asString(metadata.labelOrientation),
        description: asString(metadata.description),
    };

    const clickable = buildClickableInfo(metadata);
    if (clickable) {
        expression.clickableInfo = clickable;
    }

    return expression;
}

/**
 * Turn `# sliderBounds: {…}` and `# playing` into the slider the graph state
 * carries.
 *
 * Desmos' `setExpression` would take `sliderBounds` and `playing` as written,
 * but nothing here applies expressions that way: folder membership only travels
 * through `setState`, and `setState` reads the serialized form instead — bounds
 * as latex strings under `slider`, with `hardMin`/`hardMax` for a bound the
 * slider will not go past, and `isPlaying` for the animation.
 */
function buildSlider(metadata: Metadata): SliderState | undefined {
    const bounds = asSliderBounds(metadata.sliderBounds);
    const playing = asBoolean(metadata.playing);

    if (!bounds && playing === undefined) {
        return undefined;
    }

    return {
        ...(bounds && {
            min: String(bounds.min),
            max: String(bounds.max),
            hardMin: true,
            hardMax: true,
            ...(bounds.step !== undefined && { step: String(bounds.step) }),
        }),
        ...(playing !== undefined && { isPlaying: playing }),
    };
}

/**
 * Turn `# onClick: a -> a + 1` into Desmos' clickableInfo.
 *
 * `clickable: false` keeps the action on the expression but switches it off,
 * matching the checkbox in the Desmos UI. `clickable: true` on its own marks a
 * point clickable with no action, which is how a point is made to respond to
 * clicks handled elsewhere.
 */
function buildClickableInfo(metadata: Metadata): ClickableInfo | undefined {
    const action = asString(metadata.onClick);
    const enabled = asBoolean(metadata.clickable);

    if (action === undefined && enabled === undefined) {
        return undefined;
    }

    return {
        enabled: enabled ?? true,
        latex: action ? convertToLatex(action) : '',
    };
}

/** Parse the `key: value` run trailing a statement. */
function parseMetadata(text: string): Metadata {
    const metadata: Metadata = {};

    for (const part of splitTopLevel(text, ',')) {
        // Values can hold colons of their own (a piecewise action, say), so only
        // the first colon separates key from value.
        const colon = part.indexOf(':');
        const key = (colon === -1 ? part : part.slice(0, colon)).trim();
        const value = colon === -1 ? '' : part.slice(colon + 1).trim();

        if (!key) {
            continue;
        }

        if (!value) {
            // A bare flag: `# hidden`, `# secret`.
            if (key === 'hidden' || key === 'secret') {
                metadata[key] = true;
            }
            continue;
        }

        // `true`/`false` win over the always-string list, so a boolean written
        // for a numeric property still reads as a boolean.
        if (value === 'true') metadata[key] = true;
        else if (value === 'false') metadata[key] = false;
        else if (key === 'sliderBounds') metadata[key] = parseSliderBounds(value);
        else if (AXIS_ALWAYS_STRING_PROPERTIES.has(key)) metadata[key] = unquote(value);
        else metadata[key] = parseValue(value);
    }

    return metadata;
}

/**
 * `# sliderBounds: {min: 0, max: 10, step: 0.1}` into the object Desmos wants.
 *
 * Written as a brace group so it reads like the rest of the language, but it is
 * a property value rather than a piecewise: Desmos takes `min`, `max` and an
 * optional `step`, and ignores the setting outright if it arrives as a string.
 */
function parseSliderBounds(value: string): SliderBounds | undefined {
    const body = /^\{(.*)\}$/.exec(value.trim())?.[1];
    if (body === undefined) {
        return undefined;
    }

    const bounds: Record<string, string | number> = {};
    for (const part of splitTopLevel(body, ',')) {
        const colon = part.indexOf(':');
        if (colon === -1) {
            continue;
        }
        const key = part.slice(0, colon).trim();
        const entry = part.slice(colon + 1).trim();
        if (key && entry) {
            bounds[key] = numberOrString(unquote(entry));
        }
    }

    // Desmos needs both ends; a half-written bound is left off entirely.
    return bounds.min !== undefined && bounds.max !== undefined
        ? {
              min: bounds.min,
              max: bounds.max,
              ...(bounds.step !== undefined && { step: bounds.step }),
          }
        : undefined;
}

/**
 * `true`/`false` and numbers become themselves; everything else is a string.
 *
 * Quotes are how a value says it is a string and nothing else, so a quoted
 * `"2"` stays the two-character label rather than the number 2 - which
 * `asString` would then drop on the floor.
 */
function parseValue(value: string): string | number | boolean {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (/^"[^]*"$|^'[^]*'$/.test(value)) return unquote(value);
    return numberOrString(value);
}

/** A numeric string becomes a number; anything else is left as written. */
function numberOrString(value: string): number | string {
    const asNumber = Number(value);
    return value.trim() !== '' && !Number.isNaN(asNumber) ? asNumber : value;
}

function unquote(value: string): string {
    return value.replace(/^["']|["']$/g, '');
}
