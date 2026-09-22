// ═════════════════════════════════════════════════════════════════════════════
// Names, in both spellings
// ═════════════════════════════════════════════════════════════════════════════
//
// An Axis identifier is written the way its author wants it read - `amp`,
// `theta2`, `x_1` - and Desmos has its own way of writing every one of them,
// because in latex each letter is a variable of its own: `amp` is a·m·p. The
// emitter goes one way (spec §2.3) and the parser comes back the other, and
// both are here so they cannot drift apart: the parser decides what a
// subscripted name is called by asking whether the emitter would write it back
// the same.

import {
    AXIS_FUNCTION_NAMES,
    AXIS_LATEX_FOR_CONSTANT,
    AXIS_OPERATOR_NAMES,
    getFunctionLatex,
} from '@axis-dsl/syntax';

/** Every built-in function, which a name becomes the command of rather than a variable. */
export const FUNCTION_NAMES: ReadonlySet<string> = new Set(AXIS_FUNCTION_NAMES);

/**
 * The words Desmos writes as `\operatorname{…}` without calling them.
 *
 * `dt` is one of them and is not in the manifest's list: it is the time since
 * the ticker last ran, and Desmos only knows it spelled `\operatorname{dt}`.
 * Written `dt` it is d·t, which a ticker handler accepts without complaint and
 * never advances by (issue #11) - found by asking a calculator, since nothing
 * else about it says so.
 */
export const OPERATOR_NAMES: ReadonlySet<string> = new Set([...AXIS_OPERATOR_NAMES, 'dt']);

/** `\sin` → `sin`, for the functions that are latex commands of their own. */
export const FUNCTION_FOR_COMMAND: ReadonlyMap<string, string> = new Map(
    AXIS_FUNCTION_NAMES.map(name => [getFunctionLatex(name), name] as const).filter(([latex]) =>
        /^\\[a-zA-Z]+$/.test(latex),
    ),
);

/** `\pi` → `pi`, and every other constant with a command. */
export const CONSTANT_FOR_COMMAND: ReadonlyMap<string, string> = new Map(
    [...AXIS_LATEX_FOR_CONSTANT].map(([name, latex]) => [latex, name] as const),
);

/** An identifier as spec §2.2 lexes it: a name, and an explicit subscript. */
const IDENTIFIER = /^([A-Za-z][A-Za-z0-9]*)(?:_([A-Za-z0-9]+))?$/;

/**
 * The latex for an Axis name.
 *
 * - `x` → `x`, `x_1` → `x_{1}`, `amp` → `a_{mp}`
 * - `theta` → `\theta`, `theta2` → `\theta_{2}` - a constant that opens a
 *   longer name stays a command and carries the rest as its subscript, as v1
 *   did, so a graph v1 wrote reads back with the names it had
 * - `sin` → `\sin`, `mean` → `\operatorname{mean}`, `dt` → `\operatorname{dt}`
 *
 * Desmos has one subscript, so a name that is long *and* has an explicit
 * subscript - `amp_2` - runs the two together: `a_{mp2}`, the same latex as
 * `amp2`. The spec gives no other spelling for it and Desmos has none.
 */
export function identifierLatex(name: string): string {
    if (OPERATOR_NAMES.has(name)) {
        return `\\operatorname{${name}}`;
    }
    if (FUNCTION_NAMES.has(name)) {
        return getFunctionLatex(name);
    }
    const constant = AXIS_LATEX_FOR_CONSTANT.get(name);
    if (constant) {
        return constant;
    }

    const match = IDENTIFIER.exec(name);
    if (!match) {
        // Not a name the lexer could have read. Written as it is, so what
        // Desmos says about it is at least about the right characters.
        return name;
    }
    const [, head, subscript = ''] = match;

    // Longest first, which the manifest's map already is: `epsilon2` is ε₂,
    // not e carrying `psilon2`.
    for (const [prefix, latex] of AXIS_LATEX_FOR_CONSTANT) {
        if (head.startsWith(prefix) && (head.length > prefix.length || subscript)) {
            return `${latex}_{${head.slice(prefix.length)}${subscript}}`;
        }
    }

    const tail = head.slice(1) + subscript;
    return tail ? `${head[0]}_{${tail}}` : head;
}

/**
 * The Axis name for a subscripted name read out of latex: `a_{mp}` → `amp`,
 * `\theta_{2}` → `theta2`, `x_{1}` → `x_1`.
 *
 * Written closed up wherever that spells the same latex back, since that is
 * how anybody would write `amp`; kept apart where closing up would change what
 * it names - `m_{ean}` is not `mean`, which is a function, and `p_{i2}` is not
 * `pi2`, which is π₂. A digit-only subscript on a single letter keeps its
 * underscore too, because `x_1` is how that is written everywhere.
 */
export function nameFromLatex(head: string, subscript: string, latex: string): string {
    const apart = `${head}_${subscript}`;
    if (head.length === 1 && /^[0-9]+$/.test(subscript)) {
        return apart;
    }

    const joined = head + subscript;
    return identifierLatex(joined) === latex ? joined : apart;
}
