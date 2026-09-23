// ═════════════════════════════════════════════════════════════════════════════
// Lowering - checked trees into one Desmos graph state
// ═════════════════════════════════════════════════════════════════════════════
//
// The last pass. Every file of the program has been parsed and checked, and
// what is left is to say it the way Desmos wants it said: one `GraphState`,
// applied with `setState`, and the calculator options, applied with
// `updateSettings` after it. A host does exactly those two things and nothing
// else (spec §9), so anything the graph needs has to be in one or the other -
// the viewport, the ticker, the flags Desmos reads off the top of a state.
//
// Most of what follows is about the *shape* Desmos wants, because Desmos never
// complains about the wrong one. A property in the form `setExpression` takes
// rather than the form `setState` takes is not an error, it is silence; a key
// present as `undefined` is not the same as a key left off; a bound written
// out as `false` is not how Desmos writes one. The harness found every one of
// those, and the comments below say which is which.
//
// Lowering reads the tree the checker has already been over, so it assumes
// nothing is wrong and takes care that nothing it is handed can make it
// throw: a value the checker rejected is left off, and a statement it cannot
// write at all is left out, so a file with a mistake in it still graphs
// everything else (spec §8).

import type {
    CalculatorOptions,
    ClickableInfo,
    DesmosExpression,
    DomainBounds,
    Expression as DesmosExpressionItem,
    Folder,
    GraphImage,
    GraphSettings,
    GraphState,
    GraphStateFlags,
    Note,
    SliderState,
    Table,
    TableColumn as DesmosTableColumn,
    TickerState,
} from '@axis-dsl/desmos';
import {
    AXIS_DEFAULT_CONFIG,
    AXIS_DEFAULT_STATE,
    AXIS_GRAPH_PROPERTY_NAMES,
    AXIS_MANIFEST,
    AXIS_PALETTE_HEX,
    AXIS_STATE_PROPERTY_NAMES,
    AXIS_VIEWPORT_PROPERTY_NAMES,
    type Diagnostic,
    enumValue,
    type Expression,
    findProperty,
    type FolderStatement,
    imageMediaType,
    type ImageStatement,
    importTitle,
    type ImportStatement,
    isImageUrl,
    type Metadata,
    type Property,
    type PropertyPlacement,
    type Range,
    type Span,
    type Statement,
    type TableStatement,
} from '@axis-dsl/syntax';
import type { ResolveImage } from './images';
import { emitLatex } from './latex/index';
import { expandMacros } from './macros';
import { located, type Program, type SourceFile } from './program';
import { resolveProperties } from './styles';
import type { Symbols } from './symbols';
import { someNode } from './walk';

/**
 * Where an expression was written: the file, the characters, and the lines
 * they cover.
 *
 * The compiler's own record of what produced what, which is what lets a change
 * made to the graph be written back to the one statement responsible for it
 * rather than by regenerating the file - so the comments, the blank lines and
 * the layout around that statement survive the edit.
 */
export interface StatementOrigin {
    /** The file it was written in, as {@link CompileOptions.path} named it. */
    path: string;
    /** Zero-based index of the statement's first line. */
    line: number;
    /** Zero-based index of its last line, inclusive. */
    endLine: number;
    /** The statement's exact characters, metadata included: `[start, end)`. */
    span: Span;
    /**
     * Whether this statement can be rewritten from the graph.
     *
     * False where the graph does not hold what the statement says: a macro was
     * expanded into it, so writing the graph's version back would replace the
     * macro with what it stood for. {@link reason} says so.
     */
    writable: boolean;
    /** Why it is not writable, for a host that wants to say so. */
    reason?: string;
}

export interface Lowered {
    state: GraphState;
    options: CalculatorOptions;
    sourceMap: Map<string, StatementOrigin>;
    configOrigin?: StatementOrigin;
    /** Every image file inlined, as the resolver named it. */
    images: string[];
    diagnostics: Diagnostic[];
}

/**
 * The framing a graph gets when its file does not ask for one. Without a
 * viewport in the state each host would fall back on whatever its calculator
 * happened to be showing, so the same file would open differently in the
 * preview, the playground and the harness.
 */
const DEFAULT_VIEWPORT = { xmin: -10, ymin: -10, xmax: 10, ymax: 10 };

/** The config properties, by name, for reading an entry as the type it is. */
const CONFIG_PROPERTIES = new Map(
    AXIS_MANIFEST.configProperties.map(property => [property.name, property] as const),
);

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

/** Lower a checked program into the graph and the settings it describes. */
export function lowerProgram(
    program: Program,
    symbols: Symbols,
    resolveImage?: ResolveImage,
): Lowered {
    const list: DesmosExpression[] = [];
    const sourceMap = new Map<string, StatementOrigin>();
    const diagnostics: Diagnostic[] = [];
    const images: string[] = [];
    let configOrigin: StatementOrigin | undefined;

    // Held apart rather than merged as they are found, so the entry file's
    // settings win over an imported file's wherever its config block is written.
    const importedConfigs: Map<string, unknown>[] = [];
    const entryConfigs: Map<string, unknown>[] = [];
    // A graph has one ticker, so the same bargain: an imported file may bring
    // one, and the entry file's replaces it rather than merging with it.
    let importedTicker: TickerState | undefined;
    let entryTicker: TickerState | undefined;

    // Ids are handed out in the order expressions reach the list, so the same
    // file always lowers to the same ids - which is what lets a graph read
    // back off the calculator be matched to the statements that made it.
    let count = 0;
    const nextId = (prefix: string) => `${prefix}_${++count}`;

    let file: SourceFile = program.entry;

    /**
     * Whether a macro has been expanded into the statement being lowered. Set
     * by {@link latex} as it goes, and read when the statement's origin is
     * recorded.
     */
    let touched = false;

    const origin = (span: Span, writable = !touched): StatementOrigin => ({
        path: file.path,
        line: file.lines.positionAt(span.start).line,
        endLine: file.lines.positionAt(Math.max(span.start, span.end - 1)).line,
        span: { start: span.start, end: span.end },
        writable,
        ...(!writable && { reason: 'a macro expands into this statement' }),
    });

    const record = (prefix: string, span: Span): string => {
        const id = nextId(prefix);
        sourceMap.set(id, origin(span));
        return id;
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Values
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * An expression as latex, macros expanded - or nothing, for one the emitter
     * cannot write: a string where a value belongs, or the placeholder the
     * parser left for what it could not read. Both were reported already.
     *
     * `own` says whether the expression is the statement's own text rather
     * than a style's, since only its own text makes it unwritable.
     */
    const latex = (node: Expression, own = true): string | undefined => {
        const { expression, expanded } = expandMacros(node, symbols.macros);
        if (someNode(expression, n => n.kind === 'String' || n.kind === 'ErrorExpression')) {
            return undefined;
        }
        if (expanded && own) {
            touched = true;
        }
        try {
            return emitLatex(expression);
        } catch {
            return undefined;
        }
    };

    /**
     * The effective properties of a clause - its styles applied, its own
     * entries on top - with typed readers over them. Each reader returns
     * undefined for a property that is absent or whose value is not the kind
     * it should be: the checker has said so, and the graph goes without it.
     */
    const properties = (
        entries: readonly Property[],
        placement: PropertyPlacement,
        defaults: readonly Property[] = [],
    ) => {
        const resolved = new Map([
            ...resolveProperties(defaults, symbols.styles),
            ...resolveProperties(entries, symbols.styles),
        ]);
        const own = new Set([...entries, ...defaults]);

        const value = (name: string): Expression | Range | null | undefined =>
            resolved.get(name)?.value;

        const expression = (name: string): Expression | undefined => {
            const node = value(name);
            return node && node.kind !== 'Range' ? node : undefined;
        };

        const reader = {
            has: (name: string) => resolved.has(name),

            boolean(name: string): boolean | undefined {
                const property = resolved.get(name);
                if (!property) return undefined;
                // Bare, it is a flag and means true.
                if (property.value === null) return property.colon ? undefined : true;
                const node = property.value;
                if (node.kind === 'Identifier' && (node.name === 'true' || node.name === 'false')) {
                    return node.name === 'true';
                }
                return undefined;
            },

            latex(name: string): string | undefined {
                const node = expression(name);
                return node && latex(node, own.has(resolved.get(name)!));
            },

            string(name: string): string | undefined {
                const node = value(name);
                return node?.kind === 'String' ? node.value : undefined;
            },

            number(name: string): number | undefined {
                return numberValue(expression(name));
            },

            enum(name: string): string | undefined {
                const node = value(name);
                const definition = findProperty(name, placement);
                return node?.kind === 'Identifier' && definition
                    ? enumValue(definition, node.name)
                    : undefined;
            },

            range(name: string): { range: Range; own: boolean } | undefined {
                const node = value(name);
                return node?.kind === 'Range'
                    ? { range: node, own: own.has(resolved.get(name)!) }
                    : undefined;
            },

            /**
             * A colour, as whichever of the two keys Desmos keeps one under
             * (spec §4.3): a hex literal or a palette name is `color`, and
             * anything else is an expression Desmos works out, `colorLatex`.
             */
            color(name: string): { color?: string; colorLatex?: string } {
                const node = expression(name);
                if (!node) return {};
                const hex = hexColor(node);
                if (hex) return { color: hex };
                if (['Number', 'String', 'Sequence', 'Action', 'Comparison'].includes(node.kind)) {
                    return {};
                }
                // `red` is a palette name in the wrong case, which the checker
                // reports - and as an expression it is r·e·d, three sliders
                // nobody asked for. Left off like any other rejected value,
                // unless the file defines the name, when it is a variable.
                if (node.kind === 'Identifier' && isMiscasePalette(node.name, symbols)) {
                    return {};
                }
                const written = latex(node, own.has(resolved.get(name)!));
                return written === undefined ? {} : { colorLatex: written };
            },
        };
        return reader;
    };

    type Reader = ReturnType<typeof properties>;

    // ─────────────────────────────────────────────────────────────────────────
    // Statements
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Lower one file's statements into the list.
     *
     * `folderId` is the folder they land in, if any. `flatten` is true for an
     * imported file, whose own folders are dropped and their contents hoisted:
     * Desmos has one level of folders, and the import has already claimed it.
     */
    const lowerFile = (current: SourceFile, folderId: string | undefined, flatten: boolean) => {
        const previous = file;
        file = current;
        lowerStatements(current.tree.file.statements, folderId, flatten, false);
        file = previous;
    };

    /**
     * `nested` is true inside a folder, where a `config` or a `ticker` is an
     * error: those are left out, so a misplaced one never overrides the one
     * written where it belongs.
     */
    const lowerStatements = (
        statements: readonly Statement[],
        folderId: string | undefined,
        flatten: boolean,
        nested: boolean,
    ): void => {
        for (const statement of statements) {
            touched = false;
            switch (statement.kind) {
                case 'ExpressionStatement':
                    lowerExpression(
                        statement.expression,
                        statement.metadata,
                        statement.span,
                        folderId,
                    );
                    break;
                case 'NoteStatement':
                    lowerNote(statement.text.value, statement.metadata, statement.span, folderId);
                    break;
                case 'FolderStatement':
                    lowerFolder(statement, folderId, flatten);
                    break;
                case 'TableStatement':
                    lowerTable(statement, folderId);
                    break;
                case 'ImageStatement':
                    lowerImage(statement, folderId);
                    break;
                case 'ImportStatement':
                    lowerImport(statement, folderId);
                    break;
                case 'ConfigStatement':
                    if (!nested) {
                        lowerConfig(statement.entries, statement.span);
                    }
                    break;
                case 'TickerStatement':
                    if (!nested) {
                        lowerTicker(statement.handler, statement.metadata);
                    }
                    break;
                // A style and a macro are resolved away before anything here
                // reads a statement, and a statement the parser could not read
                // has nothing to lower.
                case 'StyleStatement':
                case 'MacroStatement':
                case 'ErrorStatement':
                    break;
            }
        }
    };

    const lowerExpression = (
        expression: Expression,
        metadata: Metadata | null,
        span: Span,
        folderId: string | undefined,
    ): void => {
        const written = latex(expression);
        if (written === undefined) {
            return;
        }
        const read = properties(metadata?.entries ?? [], 'expression');
        // Built before the id is recorded: reading a property may expand a
        // macro, and the origin has to know.
        const built = buildExpression(written, folderId, read);
        const id = record('expr', span);
        list.push(defined({ type: 'expression', id, ...built }) as DesmosExpressionItem);
    };

    const lowerNote = (
        text: string,
        metadata: Metadata | null,
        span: Span,
        folderId: string | undefined,
    ): void => {
        const read = properties(metadata?.entries ?? [], 'note');
        list.push(
            defined({
                type: 'text',
                id: record('note', span),
                text,
                folderId,
                ...(read.boolean('secret') === true && { secret: true }),
            } satisfies Note),
        );
    };

    const lowerFolder = (
        statement: FolderStatement,
        folderId: string | undefined,
        flatten: boolean,
    ): void => {
        // An imported file's folders are not folders of their own, and a
        // folder inside a folder (an error) cannot be one either: what was in
        // them joins the folder they are in.
        if (flatten || folderId !== undefined) {
            lowerStatements(statement.body, folderId, flatten, true);
            return;
        }

        const read = properties(statement.metadata?.entries ?? [], 'folder');
        const id = record('folder', statement.span);
        list.push({
            type: 'folder',
            id,
            // An untitled folder is one Desmos stores with no title at all,
            // rather than an empty one (#10).
            ...(statement.title && { title: statement.title.value }),
            // Desmos says "not collapsed" by leaving the key off rather than
            // by storing `false`, so a folder the file says nothing about
            // carries nothing.
            ...(read.boolean('collapsed') === true && { collapsed: true }),
            ...(read.boolean('hidden') === true && { hidden: true }),
            ...(read.boolean('secret') === true && { secret: true }),
        } satisfies Folder);

        lowerStatements(statement.body, id, false, true);
    };

    /**
     * Drop an imported file in, flattened into a folder of its own.
     *
     * An import that is already inside a folder joins that folder instead of
     * opening another, since Desmos cannot nest them - so importing a file into
     * a folder, and importing a file that itself imports another, both come out
     * as one flat folder.
     */
    const lowerImport = (statement: ImportStatement, folderId: string | undefined): void => {
        const resolution = program.imports.get(statement);
        if (resolution?.kind !== 'file') {
            return;
        }

        let target = folderId;
        if (target === undefined) {
            const read = properties(statement.metadata?.entries ?? [], 'import');
            target = record('folder', statement.span);
            list.push({
                type: 'folder',
                id: target,
                title: statement.alias?.value ?? importTitle(resolution.file.path),
                // An import is a folder the reader did not write, holding a
                // file they are not reading. It starts shut unless the import
                // says `collapsed: false`.
                ...(read.boolean('collapsed') !== false && { collapsed: true }),
                ...(read.boolean('hidden') === true && { hidden: true }),
                ...(read.boolean('secret') === true && { secret: true }),
            } satisfies Folder);
        }

        lowerFile(resolution.file, target, true);
    };

    const lowerTable = (statement: TableStatement, folderId: string | undefined): void => {
        // The table's own metadata is a default for every column, which a
        // column's own metadata overrides property by property.
        const defaults = statement.metadata?.entries ?? [];
        const columns: DesmosTableColumn[] = [];

        for (const column of statement.columns) {
            const header = latex(column.header);
            if (header === undefined) {
                continue;
            }
            const values: string[] = [];
            for (const value of column.values ?? []) {
                values.push(latex(value) ?? '');
            }
            const read = properties(column.metadata?.entries ?? [], 'column', defaults);
            const pointSize = read.latex('pointSize');

            columns.push(
                defined({
                    id: nextId('col'),
                    latex: header,
                    values,
                    ...read.color('color'),
                    hidden: read.boolean('hidden'),
                    lineStyle: read.enum('lineStyle'),
                    pointStyle: read.enum('pointStyle'),
                    lineWidth: read.latex('lineWidth'),
                    lineOpacity: read.latex('lineOpacity'),
                    pointSize,
                    movablePointSize: read.latex('movablePointSize') ?? pointSize,
                    pointOpacity: read.latex('pointOpacity'),
                    lines: read.boolean('lines'),
                    points: read.boolean('points'),
                    dragMode: read.enum('dragMode'),
                }),
            );
        }

        list.push(
            defined({
                type: 'table',
                id: record('table', statement.span),
                columns,
                folderId,
            } satisfies Table),
        );
    };

    const lowerImage = (statement: ImageStatement, folderId: string | undefined): void => {
        const url = resolveImageUrl(statement);
        if (url === undefined) {
            return;
        }

        const read = properties(statement.metadata?.entries ?? [], 'image');
        const image = defined({
            folderId,
            image_url: url,
            // Everything but the URL and the caption is latex, because every
            // one of them may be an expression rather than a number: an image
            // can be centred on a point the graph computes and sized by a
            // slider.
            name: read.string('name'),
            width: read.latex('width'),
            height: read.latex('height'),
            center: read.latex('center'),
            angle: read.latex('angle'),
            opacity: read.latex('opacity'),
            foreground: read.boolean('foreground'),
            hidden: read.boolean('hidden'),
            secret: read.boolean('secret'),
            // An image is dragged or it is not: Desmos keeps `draggable` for
            // one, and ignores `dragMode` on it without a word. So any mode but
            // `NONE` makes a draggable image, and the mode itself is only ever
            // what a point would do - an image has no axis to be held to.
            draggable: imageDraggable(read.enum('dragMode')),
            clickableInfo: buildClickableInfo(read),
        } satisfies Omit<GraphImage, 'type' | 'id'>);
        list.push({ type: 'image', id: record('image', statement.span), ...image });
    };

    /**
     * The URL an image reaches Desmos as.
     *
     * A picture named by path is read at compile time and inlined, because a
     * graph carries its images as URLs and a path is not one anybody else's
     * browser can fetch. Anything already a URL - `https:`, `data:` - is left
     * exactly as it was written.
     */
    const resolveImageUrl = (statement: ImageStatement): string | undefined => {
        const url = statement.source.value;
        if (isImageUrl(url)) {
            return url;
        }

        let resolved: ReturnType<ResolveImage>;
        try {
            resolved = resolveImage?.(url, file.path);
        } catch {
            resolved = undefined;
        }

        if (!resolved) {
            const from = file.path ? ` from ${file.path}` : '';
            diagnostics.push(
                located(
                    imageMediaType(url) === undefined
                        ? {
                              code: 'invalid-image',
                              severity: 'error',
                              message: `"${url}" is not an image file - Axis reads png, jpg, gif, webp, svg, bmp, ico, apng and avif.`,
                              span: statement.source.span,
                          }
                        : {
                              code: 'unresolved-image',
                              severity: 'error',
                              message: resolveImage
                                  ? `Cannot resolve image "${url}"${from}.`
                                  : `Cannot resolve image "${url}"${from}: nothing was given to read images with.`,
                              span: statement.source.span,
                          },
                    file,
                ),
            );
            return undefined;
        }

        if (!images.includes(resolved.path)) {
            images.push(resolved.path);
        }
        return resolved.dataUri;
    };

    const lowerConfig = (entries: readonly Property[], span: Span): void => {
        const config = new Map<string, unknown>();

        for (const entry of entries) {
            const definition = CONFIG_PROPERTIES.get(entry.key.name);
            const value = definition && configValue(entry, definition.valueType);
            if (definition && value !== undefined) {
                config.set(definition.name, value);
            }
        }

        if (file.entry) {
            entryConfigs.push(config);
            // Only the entry's block is recorded: an imported one is
            // overridden by it, so writing a setting into it would be writing
            // where it does not take effect.
            configOrigin ??= origin(span, true);
        } else {
            importedConfigs.push(config);
        }
    };

    /**
     * Turn `ticker a -> a + 1 @ minStep: 50, playing` into the ticker the graph
     * state carries.
     *
     * `minStep` reaches Desmos as latex rather than as a number, because that
     * is what the state holds and because it need not be a literal: a ticker
     * may pace itself off a variable the graph defines. The handler is written
     * with `dt` as `\operatorname{dt}`, the one spelling Desmos knows it by.
     *
     * `playing` and `open` are written only when they are true, which is how
     * Desmos writes them itself - it says "not playing" by leaving the key off
     * rather than by storing `false`.
     */
    const lowerTicker = (handler: Expression, metadata: Metadata | null): void => {
        const handlerLatex = latex(handler);
        if (handlerLatex === undefined) {
            return;
        }
        const read = properties(metadata?.entries ?? [], 'ticker');
        const minStep = read.latex('minStep');
        const ticker: TickerState = {
            handlerLatex,
            ...(minStep !== undefined && { minStepLatex: minStep }),
            ...(read.boolean('playing') === true && { playing: true }),
            ...(read.boolean('open') === true && { open: true }),
        };

        if (file.entry) {
            // Two are an error; the first is the one that stands.
            entryTicker ??= ticker;
        } else {
            importedTicker = ticker;
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Properties
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * An expression's properties, in the form `setState` reads them - which is
     * not the form `setExpression` takes, and the difference is silent.
     */
    const buildExpression = (
        written: string,
        folderId: string | undefined,
        read: Reader,
    ): Omit<DesmosExpressionItem, 'type' | 'id'> => {
        const pointSize = read.latex('pointSize');
        const expression: Omit<DesmosExpressionItem, 'type' | 'id'> = defined({
            latex: written,
            folderId,
            ...read.color('color'),
            lineStyle: read.enum('lineStyle'),
            lineWidth: read.latex('lineWidth'),
            lineOpacity: read.latex('lineOpacity'),
            pointStyle: read.enum('pointStyle'),
            pointSize,
            // Desmos sizes a movable point from its own property and ignores
            // `pointSize` entirely, so a file that set only that would watch
            // its point resize the moment the point turned out to be draggable.
            // `pointSize` means the size; `movablePointSize` overrides it for
            // the draggable case, for a file that really does want the two
            // to differ.
            movablePointSize: read.latex('movablePointSize') ?? pointSize,
            pointOpacity: read.latex('pointOpacity'),
            fillOpacity: read.latex('fillOpacity'),
            points: read.boolean('points'),
            lines: read.boolean('lines'),
            fill: read.boolean('fill'),
            hidden: read.boolean('hidden'),
            secret: read.boolean('secret'),
            slider: buildSlider(read),
            dragMode: read.enum('dragMode'),
            label: read.string('label'),
            showLabel: read.boolean('showLabel'),
            labelSize: read.latex('labelSize'),
            labelOrientation: read.enum('labelOrientation'),
            suppressTextOutline: read.boolean('suppressTextOutline'),
            pointOutline: read.boolean('pointOutline'),
            description: read.string('description'),
            ...buildDomains(read),
            clickableInfo: buildClickableInfo(read),
        });
        return expression;
    };

    /**
     * `@ slider: -5..5 step 0.5, playing` into the slider the graph state
     * carries.
     *
     * Desmos' `setExpression` would take `sliderBounds` and `playing`, but
     * nothing here applies expressions that way: folder membership only
     * travels through `setState`, and `setState` reads the serialized form
     * instead - bounds as latex strings under `slider`, with `hardMin`/`hardMax`
     * for a bound the slider will not go past, and `isPlaying` for the
     * animation.
     */
    const buildSlider = (read: Reader): SliderState | undefined => {
        const slider = read.range('slider');
        const playing = read.boolean('playing');
        const loopMode = read.enum('loopMode') as SliderState['loopMode'];
        const playDirection = read.number('playDirection');
        const animationPeriod = read.number('animationPeriod');

        const animation = {
            ...(playing !== undefined && { isPlaying: playing }),
            ...(loopMode !== undefined && { loopMode }),
            ...(playDirection !== undefined && {
                playDirection: (playDirection < 0 ? -1 : 1) as SliderState['playDirection'],
            }),
            ...(animationPeriod !== undefined && { animationPeriod }),
        };

        if (!slider && Object.keys(animation).length === 0) {
            return undefined;
        }

        if (!slider) {
            return animation;
        }

        const { range, own } = slider;
        const end = (node: Expression | null) => (node ? latex(node, own) : undefined);
        const min = end(range.min);
        const max = end(range.max);
        const step = end(range.step);

        return {
            // A bound Desmos does not carry is its own default, which is not
            // the same as no bound - so an end the file leaves out is left
            // out here too, rather than pinned to a number nobody chose. Each
            // end is latex, and need not be a literal: a slider's range can be
            // computed from the rest of the graph.
            ...(min !== undefined && { min }),
            ...(max !== undefined && { max }),
            // A bound is a limit unless the file says otherwise (spec §4.4).
            // Desmos says a soft bound by leaving the flag off entirely, so a
            // soft end is written as nothing at all rather than as `false`.
            ...((range.soft === 'none' || range.soft === 'max') && { hardMin: true }),
            ...((range.soft === 'none' || range.soft === 'min') && { hardMax: true }),
            ...(step !== undefined && { step }),
            ...animation,
        };
    };

    /**
     * `@ domain: 0..2pi` into the bounds a parametric curve is drawn over.
     *
     * Desmos keeps the same bounds twice - under `domain`, which it reads, and
     * under `parametricDomain`, the older key it still writes beside it - so one
     * property in the file sets both. A graph whose two copies disagree says
     * so by setting the second explicitly.
     */
    const buildDomains = (read: Reader): Partial<DesmosExpressionItem> => {
        const bounds = (name: string): DomainBounds | undefined => {
            const domain = read.range(name);
            if (!domain) return undefined;
            const { range, own } = domain;
            // Both ends are always written: Desmos stores the pair, and an end
            // it has no value for it stores as the empty string rather than as
            // a missing key.
            return {
                min: (range.min && latex(range.min, own)) ?? '',
                max: (range.max && latex(range.max, own)) ?? '',
            };
        };

        const domain = bounds('domain');
        const parametric = bounds('parametricDomain') ?? domain;
        const polar = bounds('polarDomain');

        return {
            ...(domain && { domain }),
            ...(parametric && { parametricDomain: parametric }),
            ...(polar && { polarDomain: polar }),
        };
    };

    /**
     * `@ onClick: a -> a + 1` into Desmos' `clickableInfo` - not `onClick`,
     * which is `setExpression`'s spelling and which `setState` ignores.
     *
     * `clickable: false` keeps the action but switches it off, matching the
     * checkbox in the Desmos UI. `clickable` on its own marks an object
     * clickable with no action, which is how one is made to respond to clicks
     * handled elsewhere.
     */
    const buildClickableInfo = (read: Reader): ClickableInfo | undefined => {
        const action = read.latex('onClick');
        const enabled = read.boolean('clickable');

        if (action === undefined && enabled === undefined) {
            return undefined;
        }

        // Desmos writes a switched-off clickable by leaving `enabled` off
        // rather than by storing `false`, which is the form a graph read back
        // off desmos.com arrives in.
        return {
            ...(enabled !== false && { enabled: true }),
            latex: action ?? '',
        };
    };

    // ─────────────────────────────────────────────────────────────────────────
    // The graph
    // ─────────────────────────────────────────────────────────────────────────

    lowerFile(program.entry, undefined, false);

    const ticker = entryTicker ?? importedTicker;
    const config = new Map([...importedConfigs, ...entryConfigs].flatMap(layer => [...layer]));
    const { options, graph, flags } = splitConfig(config, ticker !== undefined);

    const state: GraphState = {
        version: 11,
        // The top-level state flags, which are neither calculator options nor
        // part of `graph`: Desmos reads them here and only here.
        ...flags,
        // `@ pointStyle: SQUARE` means that style, on a draggable point as much
        // as a fixed one. Without this, Desmos substitutes its own style for
        // any point it decides is movable and stashes the author's away - so a
        // square point silently becomes a round one the moment its coordinates
        // turn out to be draggable.
        doNotMigrateMovablePointStyle: true,
        graph: {
            ...graph,
            // A file that names only some edges gets the defaults for the
            // rest: `xmin: 0` alone is a half-written rectangle, and Desmos
            // would ignore it.
            viewport: { ...DEFAULT_VIEWPORT, ...graph.viewport },
        },
        // The ticker rides beside the list rather than in it, and a graph
        // without one says so by carrying no ticker at all: Desmos reads a
        // ticker with no handler as no ticker, not as an empty one.
        expressions: { list, ...(ticker && { ticker }) },
    };

    return { state, options, sourceMap, configOrigin, images, diagnostics };
}

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A config entry as the value Desmos wants, by the type the manifest gives it.
 * Unlike an expression's properties, these are JSON rather than latex: the
 * calculator options are plain settings, not graph content.
 */
function configValue(property: Property, valueType: string): unknown {
    const node = property.value;
    if (node === null) {
        return property.colon ? undefined : valueType === 'boolean' ? true : undefined;
    }
    if (node.kind === 'Range') {
        return undefined;
    }

    switch (valueType) {
        case 'boolean':
            return node.kind === 'Identifier' && (node.name === 'true' || node.name === 'false')
                ? node.name === 'true'
                : undefined;
        case 'number':
            return numberValue(node);
        case 'string':
            return node.kind === 'String' ? node.value : undefined;
        case 'enum': {
            const definition = CONFIG_PROPERTIES.get(property.key.name);
            const value =
                node.kind === 'Identifier' && definition
                    ? enumValue(definition, node.name)
                    : undefined;
            // `actions` is the one enum that is really a boolean with a third
            // option, and Desmos wants the booleans as booleans.
            return value === 'true' ? true : value === 'false' ? false : value;
        }
        case 'color':
            return hexColor(node);
    }
    return undefined;
}

/**
 * Divide a merged config into the half `updateSettings` takes and the halves
 * that have to go into the graph state.
 *
 * The viewport is the reason this exists. `xmin` and its three siblings read
 * like any other config key, but Desmos holds them in the state rather than in
 * the calculator's options, so handing them to `updateSettings` with the rest
 * would apply everything except the framing - and say nothing about it.
 */
function splitConfig(
    config: ReadonlyMap<string, unknown>,
    hasTicker: boolean,
): { options: CalculatorOptions; graph: GraphSettings; flags: GraphStateFlags } {
    // Axis's own defaults sit under whatever the file wrote, so a config
    // block that names one of them still has the last word. Each bucket has
    // its own defaults, since a default goes wherever its key does.
    const options: Record<string, unknown> = { ...AXIS_DEFAULT_CONFIG };
    const flags: Record<string, unknown> = { ...AXIS_DEFAULT_STATE };
    const graph: Record<string, unknown> = {};
    const viewport: Record<string, number> = {};

    // `actions` defaults to `auto`, which means "on if the graph uses actions" -
    // and Desmos decides that by looking at the expression list alone. A ticker
    // is nothing but an action, but it is not in the list, so a graph whose
    // only action is its ticker is left with actions switched off and simply
    // never ticks. Turning them on here is the difference between a ticker
    // that runs and one that silently does not; a file that writes `actions`
    // itself, including `actions: false`, still has the last word.
    if (hasTicker && !config.has('actions')) {
        options.actions = true;
    }

    for (const [key, value] of config) {
        if ((AXIS_STATE_PROPERTY_NAMES as readonly string[]).includes(key)) {
            // The state flags sit beside `graph` rather than inside it: routed
            // there they would be applied and silently do nothing.
            flags[key] = value;
        } else if ((AXIS_VIEWPORT_PROPERTY_NAMES as readonly string[]).includes(key)) {
            viewport[key] = value as number;
        } else if ((AXIS_GRAPH_PROPERTY_NAMES as readonly string[]).includes(key)) {
            graph[key] = value;
        } else {
            options[key] = value;
        }
    }

    if (Object.keys(viewport).length > 0) {
        graph.viewport = viewport;
    }

    return {
        options: options as CalculatorOptions,
        graph: graph as GraphSettings,
        flags: flags as GraphStateFlags,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Values
// ─────────────────────────────────────────────────────────────────────────────

/** An image's `dragMode` as the flag Desmos keeps for it: dragged, or left off. */
function imageDraggable(mode: string | undefined): true | undefined {
    return mode !== undefined && mode !== 'NONE' ? true : undefined;
}

/** Whether `name` is a palette name in the wrong case that the file does not define. */
function isMiscasePalette(name: string, symbols: Symbols): boolean {
    const lower = name.toLowerCase();
    return (
        !AXIS_PALETTE_HEX.has(name) &&
        [...AXIS_PALETTE_HEX.keys()].some(colour => colour.toLowerCase() === lower) &&
        !symbols.variables.has(name)
    );
}

/** `3`, `-0.5` as the number it is, or nothing for anything else. */
function numberValue(node: Expression | undefined): number | undefined {
    if (node?.kind === 'Number') {
        const value = Number(node.value);
        return Number.isFinite(value) ? value : undefined;
    }
    if (node?.kind === 'Unary' && node.operand.kind === 'Number') {
        const value = Number(node.operand.value);
        return Number.isFinite(value) ? (node.operator === '-' ? -value : value) : undefined;
    }
    return undefined;
}

/**
 * The hex a colour literal or a palette name stands for, `#rrggbb`, or nothing
 * for any other expression. `#fff` is written out in full, which is the only
 * spelling Desmos writes back.
 */
function hexColor(node: Expression): string | undefined {
    if (node.kind === 'Color') {
        const hex = node.value.slice(1);
        return `#${hex.length === 3 ? [...hex].map(digit => digit + digit).join('') : hex}`.toLowerCase();
    }
    if (node.kind === 'Identifier') {
        return AXIS_PALETTE_HEX.get(node.name);
    }
    return undefined;
}
