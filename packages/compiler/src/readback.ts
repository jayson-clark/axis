// ═════════════════════════════════════════════════════════════════════════════
// Reading a graph's properties back as Axis
// ═════════════════════════════════════════════════════════════════════════════
//
// Lowering turns `@ color: RED, slider: 0..10` into the keys Desmos keeps -
// `color: "#c74440"`, `slider: { min: "0", max: "10", hardMin: true, … }`.
// This is the other direction, one property at a time: which keys of a graph
// item a property is read from, and the tree node that says what they hold.
//
// It is a table rather than a function because the write-back needs more than
// the answer. It has to know *which* properties changed between two readings
// of the same item, so it can rewrite those and leave every other property the
// author wrote exactly as they wrote it - and it has to merge a change into the
// node that is already there rather than replace it, so that moving a slider's
// minimum does not also take away the maximum Desmos never bothered to return.
// So each field says how to read itself and how to write itself over what the
// statement already had, and the same fields build a fresh statement's
// metadata when there is nothing there yet.
//
// Every node made here has an empty span at offset 0. They were not read from
// any source, and the printer only consults a span to find a comment or a
// bracket the author spread over lines - an empty one finds neither.

import type { DesmosExpression } from '@axis-dsl/desmos';
import { importTitle } from '@axis-dsl/language';
import {
    AXIS_MANIFEST,
    AXIS_PALETTE,
    type ColorLiteral,
    type Expression,
    type FolderStatement,
    type Identifier,
    type ImageStatement,
    type Metadata,
    type NoteStatement,
    type NumberLiteral,
    type Property,
    type PropertyValue,
    type Range,
    sameTree,
    type Span,
    type Statement,
    type StringLiteral,
    type TableColumn,
    type TableStatement,
    type ExpressionStatement,
} from '@axis-dsl/syntax';
import { parseLatex } from './latex/index';

/** A graph item, or a table column, as a bag of keys. */
export type Item = Record<string, unknown>;

/** Where a set of properties is written, as far as reading them back goes. */
export type ReadbackPlacement =
    'expression' | 'column' | 'image' | 'folder' | 'import' | 'note' | 'ticker';

/**
 * What to do to one property: give it this value (`null` is a bare flag), or
 * take it off the clause.
 */
export type PropertyWrite =
    { name: string; value: PropertyValue | null } | { name: string; remove: true };

// ─────────────────────────────────────────────────────────────────────────────
// Nodes
// ─────────────────────────────────────────────────────────────────────────────

const nowhere = (): Span => ({ start: 0, end: 0 });

export function identifier(name: string): Identifier {
    return { kind: 'Identifier', name, span: nowhere() };
}

export function stringNode(value: string): StringLiteral {
    return { kind: 'String', value, span: nowhere() };
}

/** A JSON number as a literal, negated with a sign rather than inside the digits. */
export function numberNode(value: number): Expression {
    const literal: NumberLiteral = {
        kind: 'Number',
        value: String(Math.abs(value)),
        span: nowhere(),
    };
    return value < 0
        ? { kind: 'Unary', operator: '-', operand: literal, span: nowhere() }
        : literal;
}

const PALETTE_NAME = new Map(AXIS_PALETTE.map(color => [color.hex, color.name]));

/**
 * A hex colour as the script would say it: the palette's name where it is one
 * of Desmos' own colours - which is every colour a graph hands out by itself -
 * and the literal otherwise.
 */
export function colorNode(hex: string): Identifier | ColorLiteral {
    const name = PALETTE_NAME.get(hex.toLowerCase());
    return name ? identifier(name) : { kind: 'Color', value: hex.toLowerCase(), span: nowhere() };
}

/**
 * Latex as a tree, spans emptied. Throws `LatexParseError` for latex the tree
 * has no reading of, which a caller turns into a reason.
 */
export function latexNode(latex: string): Expression {
    return withoutSpans(parseLatex(latex));
}

function withoutSpans<T>(node: T): T {
    if (Array.isArray(node)) return node.map(withoutSpans) as T;
    if (node === null || typeof node !== 'object') return node;
    return Object.fromEntries(
        Object.entries(node).map(([key, value]) => [
            key,
            key === 'span' ? nowhere() : withoutSpans(value),
        ]),
    ) as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// Merging a changed expression into the one the author wrote
// ─────────────────────────────────────────────────────────────────────────────

type Node = { kind: string; span: Span } & Record<string, unknown>;

const isNode = (value: unknown): value is Node =>
    typeof value === 'object' && value !== null && typeof (value as Node).kind === 'string';

function unwrap(node: Node): Node {
    return node.kind === 'Paren' ? unwrap(node.expression as Node) : node;
}

/** `inner`, back inside every bracket `outer` was written in. */
function rewrap(outer: Node, inner: Node): Node {
    return outer.kind === 'Paren'
        ? { ...outer, expression: rewrap(outer.expression as Node, inner) }
        : inner;
}

/**
 * `after`, with every part of it that did not change since `before` taken
 * from `source` instead.
 *
 * `before` and `after` are what the graph held, read from its latex; `source`
 * is what the author wrote, which reads as `before`. Where a part of the tree
 * is the same in both readings the author's is kept - their brackets, their
 * `*` rather than juxtaposition, their `0.50` - so dragging a point rewrites
 * its coordinates and nothing else about how the statement was put.
 */
export function mergeExpression(
    source: Expression | null | undefined,
    before: Expression | null | undefined,
    after: Expression,
): Expression {
    if (!source || !before) return after;
    return merge(
        source as unknown as Node,
        before as unknown as Node,
        after as unknown as Node,
    ) as unknown as Expression;
}

function merge(source: Node, before: Node, after: Node): Node {
    if (sameTree(before, after)) return source;

    const s = unwrap(source);
    const b = unwrap(before);
    const a = unwrap(after);
    if (s.kind !== b.kind || b.kind !== a.kind) return after;

    const merged: Node = { ...s };
    for (const key of Object.keys(a)) {
        if (key === 'span' || key === 'kind') continue;
        const [sv, bv, av] = [s[key], b[key], a[key]];

        if (isNode(av)) {
            if (!isNode(bv) || !isNode(sv)) return after;
            merged[key] = merge(sv, bv, av);
        } else if (Array.isArray(av)) {
            if (!Array.isArray(bv) || !Array.isArray(sv)) return after;
            if (av.length !== bv.length || sv.length !== bv.length) return after;
            const items: unknown[] = [];
            for (let index = 0; index < av.length; index++) {
                const [si, bi, ai] = [sv[index], bv[index], av[index]];
                if (isNode(ai)) {
                    if (!isNode(bi) || !isNode(si)) return after;
                    items.push(merge(si, bi, ai));
                } else if (ai !== bi) {
                    return after;
                } else {
                    items.push(si);
                }
            }
            merged[key] = items;
        } else if (av === null || bv === null) {
            if (av !== bv || sv !== null) return after;
        } else if (av !== bv) {
            // A scalar that changed - an operator, a name, a number's digits -
            // is this node changing, not something under it.
            return after;
        }
        // A scalar the graph did not change keeps the author's spelling.
    }

    return rewrap(source, merged);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fields
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One property, as the keys of an item it is read from.
 *
 * `read` is what is compared between two readings; `write` is the value the
 * property takes given the item now, the item as it was, and the property the
 * statement already has (its own, not a style's) - or `undefined` for a
 * property the clause should lose.
 */
interface Field {
    name: string;
    /** The item's top-level keys this property accounts for. */
    keys: readonly string[];
    read(item: Item): unknown;
    write(after: Item, before: Item, own: Property | undefined): PropertyValue | null | undefined;
    /**
     * Whether the value is only what another property already implies - a
     * movable point's size following `pointSize`, say - so that a statement
     * that never wrote this property does not start to.
     */
    implied?(after: Item): boolean;
}

const own = (property: Property | undefined): Expression | undefined =>
    property?.value && property.value.kind !== 'Range' ? property.value : undefined;

/** A latex string off an item, or undefined for one that is absent or empty. */
const latexOf = (value: unknown): string | undefined =>
    typeof value === 'string' && value !== '' ? value : undefined;

const tryLatex = (latex: string | undefined): Expression | undefined =>
    latex === undefined ? undefined : latexNode(latex);

const nested =
    (outer: string, inner: string) =>
    (item: Item): unknown =>
        (item[outer] as Item | undefined)?.[inner];

function latexField(name: string, key = name): Field {
    return {
        name,
        keys: [key],
        read: item => latexOf(item[key]),
        write(after, before, property) {
            const now = latexOf(after[key]);
            if (now === undefined) return undefined;
            return mergeExpression(own(property), tryLatex(latexOf(before[key])), latexNode(now));
        },
    };
}

/**
 * A flag. Written bare where it is new and true, which is how the formatter
 * and every example write one; a flag the author spelt `: true` keeps it.
 */
function booleanField(
    name: string,
    get: (item: Item) => unknown = item => item[name],
    keys = [name],
): Field {
    return {
        name,
        keys,
        read: item => (typeof get(item) === 'boolean' ? get(item) : undefined),
        write(after, _before, property) {
            const now = get(after);
            if (now === true) return property?.colon ? identifier('true') : null;
            if (now === false) return identifier('false');
            // Gone from the graph. A flag the statement set is taken off it;
            // one it had from a style is overridden, since there is no taking
            // a style's property away from one statement.
            return property ? undefined : identifier('false');
        },
    };
}

function enumField(
    name: string,
    get: (item: Item) => unknown = item => item[name],
    keys = [name],
): Field {
    return {
        name,
        keys,
        read: get,
        write: after => {
            const now = get(after);
            return typeof now === 'string' ? identifier(now) : undefined;
        },
    };
}

function stringField(name: string): Field {
    return {
        name,
        keys: [name],
        read: item => item[name],
        write: after => (typeof after[name] === 'string' ? stringNode(after[name]) : undefined),
    };
}

function numberField(name: string, get: (item: Item) => unknown, keys: readonly string[]): Field {
    return {
        name,
        keys,
        read: get,
        write: after => {
            const now = get(after);
            return typeof now === 'number' ? numberNode(now) : undefined;
        },
    };
}

const colorField: Field = {
    name: 'color',
    keys: ['color', 'colorLatex'],
    read: item => [item.color, latexOf(item.colorLatex)],
    write(after, before, property) {
        const latex = latexOf(after.colorLatex);
        if (latex !== undefined) {
            return mergeExpression(
                own(property),
                tryLatex(latexOf(before.colorLatex)),
                latexNode(latex),
            );
        }
        return typeof after.color === 'string' ? colorNode(after.color) : undefined;
    },
};

const SLIDER_BOUNDS = ['min', 'max', 'step', 'hardMin', 'hardMax'] as const;

/**
 * `slider: lo..hi step s soft …`, merged end by end.
 *
 * Desmos leaves an end off the state when it matches its own default, so the
 * range a slider comes back with is rarely the range the script wrote. Only
 * the ends that moved are rewritten; an end the calculator merely did not
 * return stays exactly as the author had it.
 */
const sliderField: Field = {
    name: 'slider',
    keys: ['slider'],
    read: item => {
        const slider = item.slider as Item | undefined;
        return slider ? SLIDER_BOUNDS.map(key => slider[key] ?? null) : undefined;
    },
    write(after, before, property) {
        const now = after.slider as Item | undefined;
        if (!now || SLIDER_BOUNDS.every(key => now[key] === undefined)) return undefined;
        const was = (before.slider as Item | undefined) ?? {};
        const range = property?.value?.kind === 'Range' ? property.value : undefined;
        const merged = rangeOver(range, was, now);

        // Hardness is two flags on the graph and one word in the script.
        if (!range || was.hardMin !== now.hardMin || was.hardMax !== now.hardMax) {
            const hardMin = now.hardMin === true;
            const hardMax = now.hardMax === true;
            merged.soft = hardMin && hardMax ? 'none' : hardMin ? 'max' : hardMax ? 'min' : 'both';
        }
        return merged;
    },
};

/** `range`'s ends and step, each replaced where the graph moved it. */
function rangeOver(
    range: Range | undefined,
    was: Item,
    now: Item,
    keys: readonly ('min' | 'max' | 'step')[] = ['min', 'max', 'step'],
): Range {
    const merged: Range = range
        ? { ...range }
        : { kind: 'Range', min: null, max: null, step: null, soft: 'none', span: nowhere() };
    for (const key of keys) {
        const before = latexOf(was[key]);
        const after = latexOf(now[key]);
        if (!range || before !== after) {
            merged[key] =
                after === undefined
                    ? null
                    : mergeExpression(range?.[key], tryLatex(before), latexNode(after));
        }
    }
    return merged;
}

/** `domain: lo..hi` - two ends, stored as the empty string where one is missing. */
function domainField(name: string): Field {
    return {
        name,
        keys: [name],
        read: item => {
            const bounds = item[name] as Item | undefined;
            return bounds ? [latexOf(bounds.min) ?? null, latexOf(bounds.max) ?? null] : undefined;
        },
        write(after, before, property) {
            const now = after[name] as Item | undefined;
            if (!now) return undefined;
            const range = property?.value?.kind === 'Range' ? property.value : undefined;
            return rangeOver(range, (before[name] as Item | undefined) ?? {}, now, ['min', 'max']);
        },
    };
}

const onClickField: Field = {
    name: 'onClick',
    keys: ['clickableInfo'],
    read: item => latexOf((item.clickableInfo as Item | undefined)?.latex),
    write(after, before, property) {
        const now = latexOf((after.clickableInfo as Item | undefined)?.latex);
        if (now === undefined) return undefined;
        const was = latexOf((before.clickableInfo as Item | undefined)?.latex);
        return mergeExpression(own(property), tryLatex(was), latexNode(now));
    },
};

/**
 * Whether the clickable is switched on. Desmos says "off" by leaving `enabled`
 * off a `clickableInfo` it still keeps, and "not clickable at all" by keeping
 * none.
 */
const clickableField = booleanField(
    'clickable',
    item => {
        const info = item.clickableInfo as Item | undefined;
        return info ? info.enabled === true : undefined;
    },
    ['clickableInfo'],
);

/** The slider's own keys that are not its bounds, each a property of its own. */
const sliderKey = (key: string) => nested('slider', key);

const EXPRESSION_FIELDS: readonly Field[] = [
    colorField,
    enumField('lineStyle'),
    latexField('lineWidth'),
    latexField('lineOpacity'),
    enumField('pointStyle'),
    latexField('pointSize'),
    {
        ...latexField('movablePointSize'),
        implied: after => after.movablePointSize === after.pointSize,
    },
    latexField('pointOpacity'),
    latexField('fillOpacity'),
    booleanField('points'),
    booleanField('lines'),
    booleanField('fill'),
    booleanField('hidden'),
    booleanField('secret'),
    sliderField,
    booleanField('playing', sliderKey('isPlaying'), []),
    enumField('loopMode', sliderKey('loopMode'), []),
    numberField('playDirection', sliderKey('playDirection'), []),
    numberField('animationPeriod', sliderKey('animationPeriod'), []),
    enumField('dragMode'),
    stringField('label'),
    booleanField('showLabel'),
    latexField('labelSize'),
    enumField('labelOrientation'),
    booleanField('suppressTextOutline'),
    booleanField('pointOutline'),
    stringField('description'),
    domainField('domain'),
    {
        ...domainField('parametricDomain'),
        implied: after => JSON.stringify(after.parametricDomain) === JSON.stringify(after.domain),
    },
    domainField('polarDomain'),
    onClickField,
    clickableField,
];

const COLUMN_FIELDS: readonly Field[] = [
    colorField,
    enumField('lineStyle'),
    latexField('lineWidth'),
    latexField('lineOpacity'),
    enumField('pointStyle'),
    latexField('pointSize'),
    {
        ...latexField('movablePointSize'),
        implied: after => after.movablePointSize === after.pointSize,
    },
    latexField('pointOpacity'),
    booleanField('hidden'),
    booleanField('points'),
    booleanField('lines'),
    enumField('dragMode'),
];

/**
 * An image is dragged or it is not: Desmos keeps `draggable`, and lowering
 * makes any `dragMode` but `NONE` one. A drag mode the script already gave
 * that still means the same is left alone.
 */
const imageDragField: Field = {
    name: 'dragMode',
    keys: ['draggable'],
    read: item => item.draggable === true,
    write: (after, _before, property) => {
        const mode =
            property?.value?.kind === 'Identifier' ? property.value.name.toUpperCase() : undefined;
        if (after.draggable === true) {
            return mode !== undefined && mode !== 'NONE' ? property!.value : identifier('XY');
        }
        return property ? identifier('NONE') : undefined;
    },
};

const IMAGE_FIELDS: readonly Field[] = [
    stringField('name'),
    latexField('center'),
    latexField('width'),
    latexField('height'),
    latexField('angle'),
    latexField('opacity'),
    booleanField('foreground'),
    booleanField('hidden'),
    booleanField('secret'),
    imageDragField,
    onClickField,
    clickableField,
];

const FOLDER_FIELDS: readonly Field[] = [
    booleanField('collapsed'),
    booleanField('hidden'),
    booleanField('secret'),
];

/**
 * An import's folder starts collapsed unless the import says otherwise, so
 * for one the missing flag is the one that has to be written.
 */
const IMPORT_FIELDS: readonly Field[] = [
    {
        name: 'collapsed',
        keys: ['collapsed'],
        read: item => item.collapsed === true,
        write: (after, _before, property) =>
            after.collapsed === true ? (property ? undefined : null) : identifier('false'),
    },
    booleanField('hidden'),
    booleanField('secret'),
];

const NOTE_FIELDS: readonly Field[] = [booleanField('secret')];

/** The ticker's own properties, read off the ticker the state keeps beside the list. */
const TICKER_FIELDS: readonly Field[] = [
    latexField('minStep', 'minStepLatex'),
    booleanField('playing'),
    booleanField('open'),
];

const FIELDS: Record<ReadbackPlacement, readonly Field[]> = {
    expression: EXPRESSION_FIELDS,
    column: COLUMN_FIELDS,
    image: IMAGE_FIELDS,
    folder: FOLDER_FIELDS,
    import: IMPORT_FIELDS,
    note: NOTE_FIELDS,
    ticker: TICKER_FIELDS,
};

/**
 * The keys of an item that are not properties at all: what it is, where it
 * is, and the body a statement says before any `@`. The write-back handles
 * each of these itself.
 */
const STRUCTURAL: Record<ReadbackPlacement, readonly string[]> = {
    expression: ['type', 'id', 'folderId', 'latex'],
    column: ['id', 'latex', 'values'],
    image: ['type', 'id', 'folderId', 'image_url'],
    folder: ['type', 'id', 'title'],
    import: ['type', 'id', 'title'],
    note: ['type', 'id', 'folderId', 'text'],
    ticker: ['handlerLatex'],
};

const stable = (value: unknown) => JSON.stringify(value) ?? 'undefined';

/**
 * The properties that changed between two readings of one item, as writes to
 * make over the statement's own `properties`.
 *
 * `unknown` names the keys that changed and that no Axis property is read
 * from - what a write-back has to say it left in the graph.
 */
export function propertyWrites(
    placement: ReadbackPlacement,
    before: Item,
    after: Item,
    properties: readonly Property[],
): { writes: PropertyWrite[]; unknown: string[] } {
    const fields = FIELDS[placement];
    const ownProperty = (name: string) =>
        [...properties].reverse().find(property => property.key.name === name);

    const writes: PropertyWrite[] = [];
    for (const field of fields) {
        if (stable(field.read(before)) === stable(field.read(after))) continue;
        const property = ownProperty(field.name);
        if (!property && field.implied?.(after)) continue;
        const value = field.write(after, before, property);
        if (value === undefined) {
            if (property) writes.push({ name: field.name, remove: true });
        } else {
            writes.push({ name: field.name, value });
        }
    }

    const accounted = new Set([...STRUCTURAL[placement], ...fields.flatMap(field => field.keys)]);
    const unknown = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
        key => !accounted.has(key) && stable(before[key]) !== stable(after[key]),
    );

    return { writes, unknown };
}

/**
 * A clause with `writes` made to it, in the author's order: a property it had
 * is rewritten where it stands, one it did not goes on the end, and a clause
 * left with nothing in it goes altogether.
 *
 * `end` is where the statement ends, for a clause that has to be made. The
 * spans given to rewritten and new properties are empty but in the right
 * place, which is all the printer reads them for: to keep the comments and
 * blank lines of a `@{ … }` block where they were among its entries.
 */
export function applyPropertyWrites(
    metadata: Metadata | null,
    writes: readonly PropertyWrite[],
    end: number,
    source?: string,
): Metadata | null {
    if (writes.length === 0) return metadata;

    const tail = metadata ? (metadata.block ? metadata.span.end - 1 : metadata.span.end) : end;
    const entries = applyWrites(
        metadata?.entries ?? [],
        writes,
        tail,
        metadata?.block ? source : undefined,
    );

    if (entries.length === 0) return null;
    return {
        kind: 'Metadata',
        block: metadata?.block ?? false,
        entries,
        span: metadata?.span ?? { start: end, end },
    };
}

/**
 * A list of properties - a clause's, a `config` block's - with `writes` made
 * to it. `tail` is where a property that is new to it is said to stand.
 *
 * `source`, given for a block laid out one entry to a line, is what keeps two
 * new entries from being printed as a run on one line: the printer joins
 * entries with no newline between them in the source, and two that both stand
 * at `tail` have none. So a new entry is said to end at the last line break
 * before `tail`, which puts one between it and the next.
 */
export function applyWrites(
    properties: readonly Property[],
    writes: readonly PropertyWrite[],
    tail: number,
    source?: string,
): Property[] {
    const entries = [...properties];
    const lineBreak = source === undefined ? tail : Math.max(0, source.lastIndexOf('\n', tail - 1));

    for (const write of writes) {
        let index = -1;
        for (let at = entries.length - 1; at >= 0; at--) {
            if (entries[at].key.name === write.name) {
                index = at;
                break;
            }
        }

        if ('remove' in write) {
            if (index >= 0) entries.splice(index, 1);
            continue;
        }

        const where = index >= 0 ? entries[index].span.start : tail;
        const property: Property = {
            kind: 'Property',
            key: { ...identifier(write.name), span: { start: where, end: where } },
            colon: write.value !== null,
            value: write.value,
            span: { start: where, end: index >= 0 ? where : lineBreak },
        };
        if (index >= 0) {
            entries[index] = property;
        } else {
            entries.push(property);
        }
    }

    return entries;
}

/** A fresh clause for an item nobody wrote yet: every property it holds. */
export function metadataFor(placement: ReadbackPlacement, item: Item): Metadata | null {
    const empty = { type: item.type, id: item.id };
    return applyPropertyWrites(null, propertyWrites(placement, empty, item, []).writes, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Whole statements, for an item the script does not have yet
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The statement a graph item would be written as, with nothing from any
 * source to keep - or why it cannot be one.
 *
 * `members` are the statements of a folder's contents, already made.
 */
export function statementFor(
    item: DesmosExpression,
    members: Statement[] = [],
): Statement | { reason: string } {
    const record = item as unknown as Item;
    try {
        switch (item.type) {
            case 'expression': {
                const latex = latexOf(record.latex);
                if (latex === undefined) return { reason: 'an empty expression has no statement' };
                return {
                    kind: 'ExpressionStatement',
                    expression: latexNode(latex),
                    metadata: metadataFor('expression', record),
                    span: nowhere(),
                } satisfies ExpressionStatement;
            }
            case 'text':
                return {
                    kind: 'NoteStatement',
                    text: stringNode(item.text ?? ''),
                    metadata: metadataFor('note', record),
                    span: nowhere(),
                } satisfies NoteStatement;
            case 'folder':
                return {
                    kind: 'FolderStatement',
                    title: item.title === undefined ? null : stringNode(item.title),
                    metadata: metadataFor('folder', record),
                    body: members,
                    span: nowhere(),
                } satisfies FolderStatement;
            case 'image': {
                // A picture added in the calculator arrives as its own bytes,
                // and a script has no statement meaning "these bytes" - only
                // ones that name a file or a URL. Writing it out would put the
                // whole picture, base64'd, into somebody's source.
                const url = item.image_url ?? '';
                if (/^data:/i.test(url)) {
                    return {
                        reason: 'add this picture to the project and draw it with `image`, to give it a name',
                    };
                }
                return {
                    kind: 'ImageStatement',
                    source: stringNode(url),
                    metadata: metadataFor('image', record),
                    span: nowhere(),
                } satisfies ImageStatement;
            }
            case 'table':
                return {
                    kind: 'TableStatement',
                    metadata: null,
                    columns: item.columns.map(column => columnFor(column as unknown as Item)),
                    span: nowhere(),
                } satisfies TableStatement;
        }
    } catch (error) {
        return { reason: `Desmos holds latex Axis cannot read: ${(error as Error).message}` };
    }
    return { reason: 'this kind of expression has no statement' };
}

/** A table column as the script would write it: `x = [1, 2]`, or a computed `x ^ 2`. */
export function columnFor(column: Item): TableColumn {
    return {
        kind: 'TableColumn',
        header: latexNode(latexOf(column.latex) ?? ''),
        values: Array.isArray(column.values)
            ? cellValues(column.values as string[]).map(latexNode)
            : null,
        metadata: metadataFor('column', column),
        span: nowhere(),
    };
}

/**
 * A column's cells as the script can write them: the empty cells Desmos keeps
 * on the end of a column dropped, since a list has no way to say one.
 */
export function cellValues(values: readonly string[]): string[] {
    let end = values.length;
    while (end > 0 && values[end - 1].trim() === '') end--;
    return values.slice(0, end);
}

/** The folder title an import is given when it names none of its own. */
export function importAliasFor(title: string | undefined, path: string): StringLiteral | null {
    return title === undefined || title === importTitle(path) ? null : stringNode(title);
}

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG_TYPES = new Map(
    AXIS_MANIFEST.configProperties.map(property => [property.name, property.valueType] as const),
);

/**
 * A config value as the script writes it, or undefined for one it cannot:
 * anything but the manifest's own type for that key.
 */
export function configNode(
    name: string,
    value: unknown,
    property?: Property,
): PropertyValue | null | undefined {
    switch (CONFIG_TYPES.get(name)) {
        case 'boolean':
            if (typeof value !== 'boolean') return undefined;
            return value && property && !property.colon ? null : identifier(String(value));
        case 'number':
            return typeof value === 'number' && Number.isFinite(value)
                ? numberNode(value)
                : undefined;
        case 'string':
            return typeof value === 'string' ? stringNode(value) : undefined;
        case 'enum':
            return typeof value === 'string' || typeof value === 'boolean'
                ? identifier(String(value))
                : undefined;
        case 'color':
            return typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value)
                ? colorNode(value)
                : undefined;
    }
    return undefined;
}
