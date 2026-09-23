// ═════════════════════════════════════════════════════════════════════════════
// Macros - an expression with a name, substituted as a tree
// ═════════════════════════════════════════════════════════════════════════════
//
// v1 expanded a macro by pasting its text into the line that used it, and then
// had to guess at the brackets the paste needed: `macro D(n) 2n` used as `D(1)`
// is 2·1 only if something remembers to write `2(1)` rather than `21`. Here a
// use is replaced by the macro's body *in the tree*, with each argument's tree
// put where its parameter was. Nothing is re-read, so there is nothing to
// bracket: `double(1 + 2) ^ 2` is a power whose base is a product whose right
// operand is a sum, and the emitter writes whatever brackets that shape needs,
// exactly as it would for the same tree written out by hand (spec §6).
//
// Expansion is the last thing to happen to a tree before it is lowered, and
// the checker has already said everything there is to say about a use - an
// arity that does not match, a macro that uses itself. A use the checker
// rejected is left standing rather than expanded, so the expander never has a
// reason to fail and the graph gets whatever the rest of the file makes.

import type { Expression } from '@axis-dsl/syntax';
import type { MacroDefinition } from './symbols';
import { mapChildren } from './walk';

export interface Expansion {
    expression: Expression;
    /**
     * Whether any macro was used. A statement that used one is not writable
     * back from the graph: the graph holds the expansion, and writing that over
     * the call would replace the macro with what it stood for.
     */
    expanded: boolean;
}

/** `expression` with every macro use in it replaced by what it stands for. */
export function expandMacros(
    expression: Expression,
    macros: ReadonlyMap<string, MacroDefinition>,
): Expansion {
    if (macros.size === 0) {
        return { expression, expanded: false };
    }

    let expanded = false;

    const expand = (node: Expression, active: readonly string[]): Expression => {
        if (node.kind === 'Identifier') {
            const macro = macros.get(node.name);
            if (macro && macro.parameters === null && !active.includes(macro.name)) {
                expanded = true;
                return instantiate(macro, [], active);
            }
            return node;
        }

        if (node.kind === 'Call') {
            const macro = macros.get(node.callee.name);
            if (
                macro &&
                macro.parameters?.length === node.arguments.length &&
                !active.includes(macro.name)
            ) {
                expanded = true;
                // The arguments are expanded where they were written, before
                // they go in: a macro inside an argument is the caller's, and
                // once substituted it could not be told from the body's own.
                const args = node.arguments.map(arg => expand(arg, active));
                return instantiate(macro, args, active);
            }
        }

        return mapChildren(node, child => expand(child, active));
    };

    /**
     * The body with the arguments in, and then any macro the body itself uses
     * expanded too. `active` is the chain being expanded, which stops a
     * recursive macro going round for ever - the checker has reported it, and
     * the innermost use is simply left as a name.
     */
    const instantiate = (
        macro: MacroDefinition,
        args: readonly Expression[],
        active: readonly string[],
    ): Expression => {
        const bound = new Map((macro.parameters ?? []).map((name, index) => [name, args[index]]));
        return expand(substitute(macro.body, bound), [...active, macro.name]);
    };

    return { expression: expand(expression, []), expanded };
}

/**
 * `node` with each parameter replaced by its argument.
 *
 * A parameter in call position - `macro APPLY(f) = f(2)` - is renamed rather
 * than replaced, when the argument is a name: only a name can be called.
 */
function substitute(node: Expression, bound: ReadonlyMap<string, Expression>): Expression {
    if (bound.size === 0) {
        return node;
    }
    if (node.kind === 'Identifier') {
        return bound.get(node.name) ?? node;
    }
    if (node.kind === 'Call') {
        const argument = bound.get(node.callee.name);
        const call = mapChildren(node, child => substitute(child, bound)) as typeof node;
        return argument?.kind === 'Identifier' ? { ...call, callee: argument } : call;
    }
    return mapChildren(node, child => substitute(child, bound));
}
