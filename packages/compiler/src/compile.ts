// ═════════════════════════════════════════════════════════════════════════════
// The Axis compiler
// ═════════════════════════════════════════════════════════════════════════════
//
// One statement per line becomes one Desmos expression. On top of that:
//
//   - `// …` lines are comments, and `# key: value` trailing a statement is its
//     metadata (color, lineStyle, sliderBounds, onClick, …)
//   - `folder "Name" { … }`, `table { … }` and `config { … }` are blocks
//   - `ticker a -> a + 1` is the graph's ticker, which sits beside the list
//   - `"Text"` on its own is a note
//   - `import "other.axis"` drops another script in, flattened into a folder
//   - `macro NAME(a, b) …` is substituted into every statement that uses it,
//     before any of the above sees a line
//   - a block written inline reads the same as one spread over lines, because
//     @axis-dsl/language flattens it first

import {
    CalculatorOptions,
    ClickableInfo,
    DesmosExpression,
    DomainBounds,
    Expression,
    Folder,
    GraphImage,
    GraphSettings,
    GraphStateFlags,
    Note,
    SliderBounds,
    SliderState,
    Table,
    TableColumn,
    TickerState,
} from '@axis-dsl/desmos';
import {
    AXIS_ALWAYS_STRING_PROPERTIES,
    AXIS_DEFAULT_CONFIG,
    AXIS_DEFAULT_STATE,
    AXIS_GRAPH_PROPERTY_NAMES,
    AXIS_STATE_PROPERTY_NAMES,
    AXIS_VIEWPORT_PROPERTY_NAMES,
    defineMacro,
    expandBlockEntries,
    expandMacros,
    findMacroDefinitions,
    foldMetadataBlocks,
    IMAGE_KEYWORD,
    IMPORT_KEYWORD,
    importTitle,
    isImageUrl,
    joinContinuedLines,
    MacroDefinition,
    parseImageStatement,
    parseImportStatement,
    parseMacroDefinition,
    parseTickerStatement,
    splitTopLevel,
    splitTrailingMetadata,
    unescapeString,
} from '@axis-dsl/language';
import { ResolveImage } from './images';
import { findImports, ResolveImport } from './imports';
import { convertToLatex } from './latex';

export interface CompilationResult {
    expressions: DesmosExpression[];
    /**
     * The `config { … }` block, if the script or anything it imports has one.
     * Imported settings are merged first, so the entry script always wins.
     *
     * Calculator options only — what {@link updateSettings} understands. The
     * viewport keys a config block may also hold come back as {@link graph}.
     */
    settings?: CalculatorOptions;
    /**
     * The config keys Desmos keeps in the graph state instead of the calculator
     * options: `xmin`/`xmax`/`ymin`/`ymax` and `squareAxes`.
     *
     * Separate from {@link settings} because they are applied differently —
     * through `setState` or `setMathBounds`, never `updateSettings`, which
     * ignores them without complaint. A host that renders a compilation has to
     * apply both halves.
     */
    graph?: GraphSettings;
    /**
     * The config keys Desmos reads off the top of a graph state rather than out
     * of its `graph` object — currently just
     * `includeFunctionParametersInRandomSeed`.
     *
     * A third bucket beside {@link settings} and {@link graph} because Desmos
     * has a third place to put a setting, and this one is the fussiest: the key
     * is read as `setState` applies it and is ignored, without complaint,
     * anywhere else. A host applies this alongside the other two.
     */
    state?: GraphStateFlags;
    /**
     * The `ticker` statement, if the script or anything it imports has one.
     *
     * Neither a settings key nor an expression: Desmos keeps the ticker under
     * `expressions.ticker`, beside the list rather than in it, so a host applies
     * it as the third part of the same `setState`.
     */
    ticker?: TickerState;
    /**
     * Every file pulled in by `import`, transitively, as the resolver named it.
     * A host watching a script for changes has to watch these too.
     */
    imports: string[];
    /**
     * Every image file inlined into the graph, as the resolver named it. A
     * picture is part of the script as much as an import is, so a host watching
     * one watches these alongside them.
     */
    images: string[];
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
    /**
     * How `image "./beach.png"` finds its picture, which the compiler inlines
     * as a `data:` URI. Only paths ask: an image that names a URL Desmos can
     * load needs no resolver, so a script full of them compiles without one.
     */
    resolveImage?: ResolveImage;
}

/** A value as it is written after a `key:`, before any property claims it. */
type MetadataValue = string | number | boolean | SliderBounds | BraceGroup;

/**
 * Values parsed out of a `# key: value` run, keyed by property name.
 *
 * Deliberately not `any`: every read below is narrowed by {@link asString} and
 * friends, so a property that reaches Desmos in the wrong shape is a type error
 * here rather than a setting it silently ignores.
 */
type Metadata = Record<string, MetadataValue | undefined>;

/** A `{key: value, …}` property value, before it is read as what it sets. */
type BraceGroup = Record<string, string | number | boolean>;

const asString = (value: MetadataValue | undefined): string | undefined =>
    typeof value === 'string' ? value : undefined;

const asNumberOrString = (value: MetadataValue | undefined): number | string | undefined =>
    typeof value === 'number' || typeof value === 'string' ? value : undefined;

const asBoolean = (value: MetadataValue | undefined): boolean | undefined =>
    typeof value === 'boolean' ? value : undefined;

const asSliderBounds = (value: MetadataValue | undefined): SliderBounds | undefined =>
    typeof value === 'object' ? value : undefined;

/**
 * Drop the keys a property was not written for, leaving the rest as they are.
 *
 * A property Desmos was not told about is a property it decides for itself, and
 * the way to not tell it is to leave the key off - `{ dragMode: undefined }` is
 * not the same thing. Desmos reads the key as present and stops treating the
 * expression as draggable at all, so a point that dragged in the graph it was
 * read from arrives frozen. The properties are built as one object apiece for
 * readability, so the thinning happens here on the way out.
 */
function defined<T extends object>(source: T): T {
    for (const key of Object.keys(source) as (keyof T)[]) {
        if (source[key] === undefined) {
            delete source[key];
        }
    }

    return source;
}

/**
 * Settle a file's layout into one statement per line.
 *
 * The order matters and is the language's, not this file's: a `#{ … }` block is
 * collapsed onto the statement it annotates, then a statement split across a
 * bracket is folded back together, then a block written inline is spread back
 * out.
 */
function flatten(source: string): string[] {
    return expandBlockEntries(joinContinuedLines(foldMetadataBlocks(source)));
}

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
    const images: string[] = [];
    // Held apart rather than merged as they are found, so the entry script's
    // settings win over an imported file's wherever its config block is written.
    const importedConfigs: Record<string, unknown>[] = [];
    const rootConfigs: Record<string, unknown>[] = [];
    // A graph has one ticker, so the same bargain: an imported script may bring
    // one, and the entry script's replaces it rather than merging with it.
    let importedTicker: TickerState | undefined;
    let rootTicker: TickerState | undefined;

    let expressionCount = 0;
    const nextId = (prefix: string) => `${prefix}_${++expressionCount}`;

    // The files being compiled, outermost first, so a cycle can be spotted -
    // the entry script included, since a file can import itself.
    const chain: string[] = options.path === undefined ? [] : [options.path];

    // Every macro reachable from the entry script, gathered before a statement
    // is looked at. Macros are a preprocessor, not a scope: hoisting them means
    // a `macro` line reads the same wherever it is written, and a file that
    // exists to define them can be imported at the bottom of a script and still
    // be in scope at the top.
    const macros = new Map<string, MacroDefinition>();

    /** Collect one file's macros, and those of everything it imports. */
    function collectMacros(source: string, path: string, visited: Set<string>): void {
        for (const definition of findMacroDefinitions(source)) {
            defineMacro(macros, definition);
        }

        for (const specifier of findImports(source)) {
            const resolved = options.resolveImport?.(specifier, path);

            // An import that does not resolve, or that closes a cycle, is not
            // this pass's business: `emitImport` reaches it in a moment and
            // reports it against the statement that wrote it.
            if (resolved && !visited.has(resolved.path)) {
                visited.add(resolved.path);
                collectMacros(resolved.source, resolved.path, visited);
            }
        }
    }

    /**
     * Compile one file's statements into `expressions`.
     *
     * A statement can span lines while a `(` or `[` is open, so the continuation
     * lines are folded back in; a block written inline is then spread back out,
     * leaving exactly one statement per line either way.
     */
    function emitFile(source: string, scope: FileScope): void {
        const lines = flatten(substituteMacros(flatten(source)));

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
            const folderMatch = /^folder\s+"((?:[^"\\]|\\[^])*)"\s*\{/.exec(line);
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
                    title: unescapeString(folderMatch[1]),
                    // Desmos says "not collapsed" by leaving the key off rather
                    // than by storing `false`, so a folder the script says
                    // nothing about carries nothing.
                    ...(metadata.collapsed === true && { collapsed: true }),
                    ...(metadata.hidden === true && { hidden: true }),
                    ...(metadata.secret === true && { secret: true }),
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
                            // The closing line is where metadata lands when a
                            // piecewise is written - or formatted - over several
                            // lines, the `}` being the end of the statement it
                            // annotates. The opening line takes it too, so both
                            // are read, and the later one wins.
                            { ...currentPiecewise.metadata, ...metadata },
                        ),
                    );
                    currentPiecewise = undefined;
                } else if (currentConfig) {
                    (scope.flatten ? importedConfigs : rootConfigs).push(currentConfig);
                    currentConfig = undefined;
                } else if (currentTable) {
                    expressions.push(
                        defined({
                            type: 'table',
                            id: currentTable.id,
                            columns: currentTable.columns,
                            folderId: currentFolderId,
                        } satisfies Table),
                    );
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

            // The ticker, which belongs to the graph rather than to the list
            const ticker = parseTickerStatement(line);
            if (ticker) {
                const built = buildTicker(ticker.handler, metadata);
                if (built) {
                    if (scope.flatten) {
                        importedTicker = built;
                    } else {
                        rootTicker = built;
                    }
                }
                continue;
            }

            // Imports
            if (IMPORT_KEYWORD.test(line)) {
                emitImport(line, metadata, currentFolderId, scope);
                continue;
            }

            // Images, whose one unquotable part - the URL - is the statement,
            // and everything else the metadata behind it
            if (IMAGE_KEYWORD.test(line)) {
                const statement = parseImageStatement(line);
                if (!statement) {
                    throw new Error(
                        `\`${line}\` is not a valid image - write it as \`image "./beach.png"\`.`,
                    );
                }

                expressions.push(
                    buildImage(
                        nextId('image'),
                        resolveImageUrl(statement.url, scope.path),
                        currentFolderId,
                        metadata,
                    ),
                );
                continue;
            }

            // Notes
            if (line.startsWith('"') && line.endsWith('"')) {
                expressions.push(
                    defined({
                        type: 'text',
                        id: nextId('note'),
                        text: unescapeString(line.slice(1, -1)),
                        folderId: currentFolderId,
                    } satisfies Note),
                );
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
     * Take the macro definitions out and substitute the rest.
     *
     * The result is run through {@link flatten} a second time, because an
     * expansion is source like any other: a macro standing for a `#{ … }` block
     * or for a `folder "A" { … }` has to be read as one, and those are layout
     * the passes settle rather than anything the statement loop below knows
     * about. Flattening is idempotent, so the lines that held no macro at all
     * come out of the second pass exactly as they went in.
     */
    function substituteMacros(lines: string[]): string {
        const statements: string[] = [];

        for (const line of lines) {
            const trimmed = line.trim();

            // A comment is text, and `parseMacroDefinition` would read a
            // commented-out definition as a live one.
            if (trimmed.startsWith('//')) {
                statements.push(line);
                continue;
            }

            // A definition was collected before any of this and emits nothing
            // itself. Reading it again is what reports one that is malformed.
            if (parseMacroDefinition(trimmed)) {
                continue;
            }

            statements.push(expandMacros(line, macros));
        }

        return statements.join('\n');
    }

    /**
     * The URL an image reaches Desmos as.
     *
     * A picture named by path is read at compile time and inlined, because a
     * graph carries its images as URLs and a path is not one anybody else's
     * browser can fetch. Anything already a URL - `https:`, `data:` - is left
     * exactly as it was written.
     */
    function resolveImageUrl(url: string, from: string): string {
        if (isImageUrl(url)) {
            return url;
        }

        const resolved = options.resolveImage?.(url, from);
        if (!resolved) {
            throw new Error(`Cannot resolve image "${url}"${from ? ` from ${from}` : ''}.`);
        }

        if (!images.includes(resolved.path)) {
            images.push(resolved.path);
        }

        return resolved.dataUri;
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
                ...(metadata.collapsed !== false && { collapsed: true }),
                ...(metadata.hidden === true && { hidden: true }),
                ...(metadata.secret === true && { secret: true }),
            } satisfies Folder);
        }

        chain.push(resolved.path);
        emitFile(resolved.source, { path: resolved.path, folderId: target, flatten: true });
        chain.pop();
    }

    const entry = options.path ?? '';
    collectMacros(script, entry, new Set([entry]));
    emitFile(script, { path: entry, flatten: false });
    unwrapActionRuns(expressions);

    const ticker = rootTicker ?? importedTicker;
    const layers = [...importedConfigs, ...rootConfigs];
    const { settings, graph, state } = splitConfig(
        Object.assign({}, ...layers),
        ticker !== undefined,
    );

    return { expressions, settings, graph, state, ticker, imports, images };
}

/**
 * `R = \left(A,B\right)` → `R = A,B`, for a run of actions named rather than
 * written out.
 *
 * Desmos reads a bare comma-separated run of actions as a multi-action and the
 * same run in brackets as a *point*, which runs the last coordinate and drops
 * the rest without saying so. {@link convertToLatex} takes the brackets off a
 * run that acts visibly - one holding a `->` - but a run of names cannot be
 * read that way from the line it is written on: what makes `RandBeach` an
 * action is its own definition, somewhere else in the script.
 *
 * So it happens here instead, once the whole list is known, and the brackets
 * an author (or the decompiler) put round the run to keep it one statement
 * come off exactly as they do for the written-out form.
 */
function unwrapActionRuns(expressions: DesmosExpression[]): void {
    const actions = new Set<string>();

    for (const expression of expressions) {
        const latex = (expression as Expression).latex;
        const name = latex?.includes('\\to')
            ? /^([a-zA-Z](?:_\{[a-zA-Z0-9]+\})?)=/.exec(latex)?.[1]
            : undefined;
        if (name) {
            actions.add(name);
        }
    }

    for (const expression of expressions) {
        const candidate = expression as Expression;
        const run = /^((?:[a-zA-Z](?:_\{[a-zA-Z0-9]+\})?)?=?)\\left\((.*)\\right\)$/.exec(
            candidate.latex ?? '',
        );
        if (!run) {
            continue;
        }

        const parts = splitTopLevel(run[2], ',');
        if (parts.length > 1 && parts.every(part => actions.has(part.trim()))) {
            candidate.latex = `${run[1]}${run[2]}`;
        }
    }
}

/**
 * Divide a merged `config { … }` into the half `updateSettings` takes and the
 * half that has to go into the graph state.
 *
 * The viewport is the reason this exists. `xmin` and its three siblings read
 * like any other config key, but Desmos holds them in the state rather than in
 * the calculator's options, so handing them to `updateSettings` with the rest
 * would apply everything except the framing — and say nothing about it.
 */
function splitConfig(
    config: Record<string, unknown>,
    hasTicker: boolean,
): {
    settings?: CalculatorOptions;
    graph?: GraphSettings;
    state?: GraphStateFlags;
} {
    // Axis's own defaults sit under whatever the script wrote, so a config
    // block that names one of them still has the last word. Each bucket has
    // its own defaults, since a default goes wherever its key does.
    const settings: Record<string, unknown> = { ...AXIS_DEFAULT_CONFIG };
    const state: GraphStateFlags = { ...AXIS_DEFAULT_STATE };

    // `actions` defaults to `auto`, which means "on if the graph uses actions" -
    // and Desmos decides that by looking at the expression list alone. A ticker
    // is nothing but an action, but it is not in the list, so a graph whose only
    // action is its ticker is left with actions switched off and simply never
    // ticks. Turning them on here is the difference between a ticker that runs
    // and one that silently does not; a script that writes `actions` itself,
    // including `actions: false`, still has the last word.
    if (hasTicker && config.actions === undefined) {
        settings.actions = true;
    }

    const viewport: Record<string, number> = {};
    const graph: GraphSettings = {};

    for (const [key, value] of Object.entries(config)) {
        if ((AXIS_STATE_PROPERTY_NAMES as readonly string[]).includes(key)) {
            // Written before the graph keys because the state flags sit beside
            // `graph` rather than inside it: routed there they would be applied
            // and silently do nothing.
            (state as Record<string, unknown>)[key] = value;
        } else if ((AXIS_VIEWPORT_PROPERTY_NAMES as readonly string[]).includes(key)) {
            // A viewport edge is a number even when the config block spelled it
            // as a string, since the state will not take `"0"` for one.
            const bound = typeof value === 'number' ? value : Number(value);
            if (Number.isFinite(bound)) {
                viewport[key] = bound;
            }
        } else if ((AXIS_GRAPH_PROPERTY_NAMES as readonly string[]).includes(key)) {
            (graph as Record<string, unknown>)[key] = value;
        } else {
            settings[key] = value;
        }
    }

    if (Object.keys(viewport).length > 0) {
        graph.viewport = viewport;
    }

    return {
        settings: Object.keys(settings).length > 0 ? (settings as CalculatorOptions) : undefined,
        graph: Object.keys(graph).length > 0 ? graph : undefined,
        state: Object.keys(state).length > 0 ? state : undefined,
    };
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

    return defined({
        ...column,
        color: asString(metadata.color),
        hidden: asBoolean(metadata.hidden),
        lineStyle: asString(metadata.lineStyle),
        pointStyle: asString(metadata.pointStyle),
        lineWidth: asLatex(metadata.lineWidth),
        lineOpacity: asLatex(metadata.lineOpacity),
        pointSize: asLatex(metadata.pointSize),
        movablePointSize: asLatex(metadata.movablePointSize ?? metadata.pointSize),
        pointOpacity: asLatex(metadata.pointOpacity),
        lines: asBoolean(metadata.lines),
        points: asBoolean(metadata.points),
        dragMode: asString(metadata.dragMode),
    });
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
    const expression: Expression = defined({
        type: 'expression',
        id,
        // A row with nothing in it is the blank Desmos lets a graph keep for
        // spacing, and it carries no `latex` at all rather than an empty one.
        latex: latex || undefined,
        folderId,
        color: asString(metadata.color),
        colorLatex: asLatex(metadata.colorLatex),
        lineStyle: asString(metadata.lineStyle),
        lineWidth: asLatex(metadata.lineWidth),
        lineOpacity: asLatex(metadata.lineOpacity),
        pointStyle: asString(metadata.pointStyle),
        pointSize: asLatex(metadata.pointSize),
        // Desmos sizes a movable point from its own property and ignores
        // `pointSize` entirely, so a script that set only that would watch its
        // point resize the moment the point turned out to be draggable.
        // `pointSize` means the size; `movablePointSize` overrides it for the
        // draggable case, for a script that really does want the two to differ.
        movablePointSize: asLatex(metadata.movablePointSize ?? metadata.pointSize),
        pointOpacity: asLatex(metadata.pointOpacity),
        fillOpacity: asLatex(metadata.fillOpacity),
        points: asBoolean(metadata.points),
        lines: asBoolean(metadata.lines),
        fill: asBoolean(metadata.fill),
        hidden: asBoolean(metadata.hidden),
        secret: asBoolean(metadata.secret),
        slider: buildSlider(metadata),
        dragMode: asString(metadata.dragMode),
        label: asString(metadata.label),
        showLabel: asBoolean(metadata.showLabel),
        labelSize: asLatex(metadata.labelSize),
        labelOrientation: asString(metadata.labelOrientation),
        suppressTextOutline: asBoolean(metadata.suppressTextOutline),
        pointOutline: asBoolean(metadata.pointOutline),
        description: asString(metadata.description),
        ...buildDomains(metadata),
    });

    const clickable = buildClickableInfo(metadata);
    if (clickable) {
        expression.clickableInfo = clickable;
    }

    return expression;
}

/**
 * Build an image from its URL plus its `# key: value` metadata.
 *
 * Everything but the URL and the caption is latex, because every one of them
 * may be an expression rather than a number: an image can be centred on a point
 * the graph computes and sized by a slider. So they go through the same
 * conversion an expression does, and `width: 10 * 4.05` reaches Desmos as the
 * product it is rather than as a string it will not read.
 */
function buildImage(
    id: string,
    url: string,
    folderId: string | undefined,
    metadata: Metadata,
): GraphImage {
    const image: GraphImage = defined({
        type: 'image',
        id,
        folderId,
        image_url: url,
        name: asString(metadata.name),
        width: asLatex(metadata.width),
        height: asLatex(metadata.height),
        center: asLatex(metadata.center),
        angle: asLatex(metadata.angle),
        opacity: asLatex(metadata.opacity),
        foreground: asBoolean(metadata.foreground),
        hidden: asBoolean(metadata.hidden),
        secret: asBoolean(metadata.secret),
        dragMode: asString(metadata.dragMode),
    });

    const clickable = buildClickableInfo(metadata);
    if (clickable) {
        image.clickableInfo = clickable;
    }

    return image;
}

/** A property Desmos holds as latex, converted as an expression would be. */
function asLatex(value: MetadataValue | undefined): string | undefined {
    const text = asNumberOrString(value);
    return text === undefined ? undefined : convertToLatex(String(text));
}

/**
 * Turn `ticker a -> a + 1 # minStep: 50, playing: true` into the ticker the
 * graph state carries.
 *
 * `minStep` reaches Desmos as latex rather than as a number, because that is
 * what the state holds and because it need not be a literal: a ticker may pace
 * itself off a variable the graph defines.
 *
 * `playing` and `open` are written only when they are true, which is how Desmos
 * writes them itself - it says "not playing" by leaving the key off rather than
 * by storing `false`. A ticker with nothing to run is no ticker at all.
 */
function buildTicker(handler: string, metadata: Metadata): TickerState | undefined {
    if (!handler) {
        return undefined;
    }

    const minStep = asNumberOrString(metadata.minStep);

    return {
        handlerLatex: convertToLatex(handler),
        ...(minStep !== undefined && { minStepLatex: convertToLatex(String(minStep)) }),
        ...(metadata.playing === true && { playing: true }),
        ...(metadata.open === true && { open: true }),
    };
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
    const loopMode = asString(metadata.loopMode);
    const playDirection = asNumberOrString(metadata.playDirection);
    const animationPeriod = asNumberOrString(metadata.animationPeriod);

    const animation = {
        ...(playing !== undefined && { isPlaying: playing }),
        ...(loopMode !== undefined && { loopMode: loopMode as SliderState['loopMode'] }),
        ...(playDirection !== undefined && {
            playDirection: Number(playDirection) as SliderState['playDirection'],
        }),
        ...(animationPeriod !== undefined && { animationPeriod: Number(animationPeriod) }),
    };

    if (!bounds && !Object.keys(animation).length) {
        return undefined;
    }

    return {
        ...(bounds && {
            // A bound Desmos does not carry is its own default, which is not
            // the same as no bound - so an end the script leaves out is left
            // out here too, rather than pinned to a number nobody chose.
            //
            // Each end is latex, and need not be a literal: a slider's range
            // can be computed from the rest of the graph, so the ends are
            // converted exactly as an expression is.
            ...(bounds.min !== undefined && { min: convertToLatex(String(bounds.min)) }),
            ...(bounds.max !== undefined && { max: convertToLatex(String(bounds.max)) }),
            // A bound is a limit unless the script says otherwise: `min`/`max`
            // written out read as the range the slider has, not as where it
            // happens to start. Desmos says a soft bound by leaving the flag
            // off entirely, so `false` is written as nothing at all.
            ...(bounds.hardMin !== false && { hardMin: true }),
            ...(bounds.hardMax !== false && { hardMax: true }),
            ...(bounds.step !== undefined && { step: convertToLatex(String(bounds.step)) }),
        }),
        ...animation,
    };
}

/**
 * `# domain: {min: 0, max: 2pi}` into the bounds a parametric curve is drawn
 * over.
 *
 * Desmos keeps the same bounds twice - under `domain`, which it reads, and
 * under `parametricDomain`, the older key it still writes beside it - so one
 * property in the script sets both. A graph whose two copies disagree (Desmos
 * writes the default as an empty string in one and as `0` in the other) says so
 * by setting the second explicitly.
 */
function buildDomains(metadata: Metadata): Partial<Expression> {
    const domain = asDomainBounds(metadata.domain);
    const parametric = asDomainBounds(metadata.parametricDomain) ?? domain;
    const polar = asDomainBounds(metadata.polarDomain);

    return {
        ...(domain && { domain }),
        ...(parametric && { parametricDomain: parametric }),
        ...(polar && { polarDomain: polar }),
    };
}

/** `{min: 0, max: 2pi}` as the latex pair Desmos holds it as. */
function asDomainBounds(value: MetadataValue | undefined): DomainBounds | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }

    const { min, max } = value as { min?: string | number; max?: string | number };
    if (min === undefined && max === undefined) {
        return undefined;
    }

    // Both ends are always written: Desmos stores the pair, and an end it has
    // no value for it stores as the empty string rather than as a missing key.
    return { min: convertToLatex(String(min ?? '')), max: convertToLatex(String(max ?? '')) };
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

    // Desmos writes a switched-off clickable by leaving `enabled` off rather
    // than by storing `false`, which is the form a graph read back off
    // desmos.com arrives in.
    return {
        ...(enabled !== false && { enabled: true }),
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
        else if (DOMAIN_PROPERTIES.has(key)) metadata[key] = parseBraceGroup(value);
        else if (AXIS_ALWAYS_STRING_PROPERTIES.has(key)) metadata[key] = unquote(value);
        else metadata[key] = parseValue(value);
    }

    return metadata;
}

/** `# sliderBounds: {min: 0, max: 10, step: 0.1}` into the object Desmos wants. */
function parseSliderBounds(value: string): SliderBounds | undefined {
    const bounds = parseBraceGroup(value);
    if (!bounds) {
        return undefined;
    }

    // An end the script leaves out is the one Desmos assumes, which it says by
    // carrying no bound at all - so a half-written pair is honoured rather than
    // dropped, and a slider that only raises its ceiling keeps the usual floor.
    return bounds.min === undefined && bounds.max === undefined
        ? undefined
        : {
              ...(bounds.min !== undefined && { min: bounds.min as string | number }),
              ...(bounds.max !== undefined && { max: bounds.max as string | number }),
              ...(bounds.step !== undefined && { step: bounds.step as string | number }),
              ...(typeof bounds.hardMin === 'boolean' && { hardMin: bounds.hardMin }),
              ...(typeof bounds.hardMax === 'boolean' && { hardMax: bounds.hardMax }),
          };
}

/** The properties written as a `{key: value, …}` group rather than as a value. */
const DOMAIN_PROPERTIES = new Set(['domain', 'parametricDomain', 'polarDomain']);

/**
 * `{min: 0, max: 10, step: 0.1}` into the entries it holds, or nothing when the
 * value is not a group at all.
 *
 * Written as a brace group so it reads like the rest of the language, but it is
 * a property value rather than a piecewise: the keys inside are property names,
 * and Desmos ignores the setting outright if it arrives as a string.
 */
function parseBraceGroup(value: string): BraceGroup | undefined {
    const body = /^\{(.*)\}$/.exec(value.trim())?.[1];
    if (body === undefined) {
        return undefined;
    }

    const entries: BraceGroup = {};
    for (const part of splitTopLevel(body, ',')) {
        const colon = part.indexOf(':');
        if (colon === -1) {
            continue;
        }
        const key = part.slice(0, colon).trim();
        const entry = part.slice(colon + 1).trim();
        if (key && entry) {
            entries[key] =
                entry === 'true' || entry === 'false'
                    ? entry === 'true'
                    : numberOrString(unquote(entry));
        }
    }

    return entries;
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

/**
 * A quoted value as the text it holds; anything unquoted as it stands.
 *
 * An escape only means something inside quotes, which is where the quoting
 * rule put it. A bare value is whatever it says: latex reaches here with its
 * backslashes intact, and `\right]` is a delimiter rather than a carriage
 * return followed by `ight]`.
 */
function unquote(value: string): string {
    const quoted = /^"([^]*)"$|^'([^]*)'$/.exec(value);
    return quoted ? unescapeString(quoted[1] ?? quoted[2]) : value;
}
