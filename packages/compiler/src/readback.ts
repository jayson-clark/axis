// ═════════════════════════════════════════════════════════════════════════════
// Merging a graph's reading of a statement onto the one the author wrote
// ═════════════════════════════════════════════════════════════════════════════
//
// The decompiler says what a graph item is as Axis: `decompileExpression`
// turns `color: "#c74440"`, `slider: { min: "0", hardMin: true, … }` and the
// rest into the statement that builds them, defaults left out. That is the
// one mapping from state to properties, and the write-back reads through it
// rather than keeping a second.
//
// What the write-back needs on top is the *difference*. It decompiles an item
// as the graph held it before and as it holds it now, and only a property
// whose two readings disagree is written - merged onto the property the
// author already had rather than replacing it, so that moving a slider's
// minimum does not also take away the maximum Desmos never bothered to
// return, and a coordinate that moved does not take the author's brackets
// around the one that did not. Everything else stays the node it was.
//
// Every node made here has an empty span at offset 0, or an empty span at
// the place it stands. They were not read from any source, and the printer
// only consults a span to find a comment or a bracket the author spread over
// lines - an empty one finds neither.

import { importTitle } from '@axis-dsl/language';
import {
    type Expression,
    findProperty,
    type Identifier,
    type Metadata,
    type Property,
    type PropertyPlacement,
    type PropertyValue,
    type Range,
    sameTree,
    type Span,
    type StringLiteral,
} from '@axis-dsl/syntax';

/**
 * What to do to one property: give it this value (`null` is a bare flag), or
 * take it off the clause.
 */
export type PropertyWrite =
    { name: string; value: PropertyValue | null } | { name: string; remove: true };

const nowhere = (): Span => ({ start: 0, end: 0 });

export function identifier(name: string): Identifier {
    return { kind: 'Identifier', name, span: nowhere() };
}

export function stringNode(value: string): StringLiteral {
    return { kind: 'String', value, span: nowhere() };
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
// Properties
// ─────────────────────────────────────────────────────────────────────────────

const lastNamed = (properties: readonly Property[], name: string) =>
    [...properties].reverse().find(property => property.key.name === name);

const sameProperty = (a: Property, b: Property) =>
    a.colon === b.colon && sameTree(a.value, b.value);

/**
 * The properties that differ between two decompiled readings of one item, as
 * writes to make over the clause the author wrote, `own`.
 *
 * A property the item lost is taken off the clause - or, where the clause
 * never had it and so it came from a style, overridden with `false` if it is
 * a flag, since there is no taking a style's property away from one
 * statement. A config block has no styles, so there a property it does not
 * hold is already the default the graph went back to.
 */
export function propertyWrites(
    placement: PropertyPlacement,
    before: readonly Property[],
    after: readonly Property[],
    own: readonly Property[],
): PropertyWrite[] {
    const names = [...new Set([...after, ...before].map(property => property.key.name))];
    const writes: PropertyWrite[] = [];

    for (const name of names) {
        const was = lastNamed(before, name);
        const now = lastNamed(after, name);
        if (was && now && sameProperty(was, now)) continue;
        const mine = lastNamed(
            own.filter(property => property.key.name !== 'use'),
            name,
        );

        if (!now) {
            if (mine) {
                writes.push({ name, remove: true });
            } else if (
                placement !== 'config' &&
                findProperty(name, placement)?.valueType === 'boolean'
            ) {
                writes.push({ name, value: identifier('false') });
            }
            continue;
        }

        writes.push({ name, value: mergeValue(mine, was, now) });
    }

    return writes;
}

/** The value a changed property takes, with what did not change kept as written. */
function mergeValue(
    mine: Property | undefined,
    was: Property | undefined,
    now: Property,
): PropertyValue | null {
    // A flag switched on: bare, unless the author spelt theirs `: true`.
    if (now.value === null) return mine?.colon ? identifier('true') : null;

    const value = now.value;
    const written = mine?.value ?? null;
    const before = was?.value ?? null;

    if (value.kind === 'Range') {
        return mergeRange(
            written?.kind === 'Range' ? written : null,
            before?.kind === 'Range' ? before : null,
            value,
        );
    }
    if (written && written.kind !== 'Range' && before && before.kind !== 'Range') {
        return mergeExpression(written, before, value);
    }
    return value;
}

/**
 * A range, end by end. Desmos leaves an end off the state when it matches its
 * own default, so the range a slider comes back with is rarely the range the
 * script wrote; an end the graph did not move stays exactly as the author had
 * it, and so does how soft the ends are.
 */
function mergeRange(written: Range | null, before: Range | null, after: Range): Range {
    if (!written || !before) return after;
    const merged: Range = { ...written };
    for (const key of ['min', 'max', 'step'] as const) {
        const [mine, was, now] = [written[key], before[key], after[key]];
        if (was && now ? sameTree(was, now) : was === now) continue;
        merged[key] = now ? mergeExpression(mine, was, now) : null;
    }
    if (before.soft !== after.soft) merged.soft = after.soft;
    return merged;
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

/**
 * A column's cells as the script can write them: the empty cells Desmos keeps
 * on the end of a column dropped, since a list has no way to say one.
 */
export function cellValues(values: readonly string[]): string[] {
    let end = values.length;
    while (end > 0 && values[end - 1].trim() === '') end--;
    return values.slice(0, end);
}

/** An import's `as "…"` for a folder title: none where it is the one the path gives. */
export function importAliasFor(title: string | undefined, path: string): StringLiteral | null {
    return title === undefined || title === importTitle(path) ? null : stringNode(title);
}
