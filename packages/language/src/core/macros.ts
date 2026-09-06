// ═════════════════════════════════════════════════════════════════════════════
// Macros - editor-agnostic
// ═════════════════════════════════════════════════════════════════════════════
//
//     macro TAU 6.283185
//     macro LERP(a, b, t) a + (b - a) * t
//
//     y = LERP(0, TAU, x)
//
// Desmos has nothing of the kind: a macro is expanded away before a single
// character reaches the compiler, so the graph that comes out is the graph
// somebody wrote by hand. That makes this a preprocessor in the C sense - it
// substitutes text, it does not evaluate anything - and it inherits C's two
// rules that matter: a function-like macro is only expanded where a `(`
// actually follows it, and a macro never expands inside its own expansion, so
// a pair that name each other terminates instead of running away.
//
// It parts company with C in three places, all of them because Axis is an
// expression language rather than a statement one:
//
//   - Definitions are hoisted. A macro is in scope for the whole compilation,
//     including the lines above it and the files that import it, so where the
//     `macro` line sits is a matter of taste rather than of meaning.
//   - Arguments and expansions are parenthesised where that changes nothing but
//     precedence. `macro DOUBLE(x) 2 * x` used as `DOUBLE(1 + 2) ^ 2` is 36,
//     not 25, which is the arithmetic anyone reading it expects. Anything whose
//     meaning brackets *would* change - a run of actions, a point, a whole
//     `y = …` statement - is spliced in as it was written.
//   - Strings and comments are text. A note that mentions a macro's name keeps
//     it, since substituting into `"Set TAU to taste"` would be nonsense.

import { expandBlockEntries, foldMetadataBlocks } from './blocks';
import { joinContinuedLines } from './brackets';
import { splitTopLevel } from './metadata';
import { endOfStringOrLine, matchingBracket } from './scan';

/** `macro`, opening a definition rather than naming a variable. */
export const MACRO_KEYWORD = /^macro\b(?!\s*=)/;

/** One `macro NAME(…) body` definition, as written. */
export interface MacroDefinition {
    name: string;
    /**
     * The parameter names, or undefined when the macro takes no list at all.
     *
     * `macro E()` and `macro E` are different macros: the first is expanded
     * only where it is called as `E()`, the second wherever its name appears.
     */
    parameters?: string[];
    /** Everything after the name and its parameter list, trimmed. */
    body: string;
}

/** Macros in scope, by name. */
export type MacroTable = ReadonlyMap<string, MacroDefinition>;

/** A macro that cannot be read or cannot be expanded, with what was wrong. */
export class MacroError extends Error {}

const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const isIdentifierStart = (char: string | undefined): boolean =>
    char !== undefined && /[a-zA-Z_]/.test(char);

const isIdentifierChar = (char: string | undefined): boolean =>
    char !== undefined && /[a-zA-Z0-9_]/.test(char);

/**
 * True when `char` carries the name before it on into this one, so what follows
 * is the tail of a longer name rather than a name of its own.
 *
 * A digit does not: `3DOUBLE(x)` is a number times a macro, the same reading
 * Axis gives `3cos(x)`, since no name starts with a digit.
 */
const continuesName = (char: string | undefined): boolean =>
    char !== undefined && /[a-zA-Z_]/.test(char);

/**
 * Read a `macro …` definition, or undefined when the line is not one.
 *
 * `macro = 3` is a variable somebody named, and `macroscopic` is another; both
 * are left to compile as the expressions they are.
 *
 * @throws {MacroError} when the line opens a definition it does not finish -
 *         a missing name, an unclosed parameter list, an empty body.
 */
export function parseMacroDefinition(code: string): MacroDefinition | undefined {
    const trimmed = code.trim();
    if (!MACRO_KEYWORD.test(trimmed)) {
        return undefined;
    }

    const rest = trimmed.slice('macro'.length).trim();
    const name = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(rest)?.[0];
    if (!name) {
        return undefined;
    }

    let after = rest.slice(name.length);

    // The `(` has to touch the name, exactly as it does in C: with a space in
    // between, `macro ORIGIN (0, 0)` is a macro whose body is a point rather
    // than one taking two parameters called `0`.
    let parameters: string[] | undefined;
    if (after.startsWith('(')) {
        const close = matchingBracket(after, 0);
        if (close === -1) {
            throw new MacroError(`\`macro ${name}(\` is missing its closing \`)\`.`);
        }

        const inside = after.slice(1, close).trim();
        parameters = inside === '' ? [] : splitTopLevel(inside, ',').map(part => part.trim());
        after = after.slice(close + 1);

        for (const parameter of parameters) {
            if (!IDENTIFIER.test(parameter)) {
                throw new MacroError(
                    `\`${parameter || ','}\` is not a parameter name - write \`macro ${name}(a, b) …\`.`,
                );
            }
        }

        if (new Set(parameters).size !== parameters.length) {
            throw new MacroError(`\`macro ${name}\` names the same parameter twice.`);
        }
    }

    const body = after.trim();
    if (!body) {
        throw new MacroError(`\`macro ${name}\` has no body - give it something to expand to.`);
    }

    return { name, ...(parameters !== undefined && { parameters }), body };
}

/**
 * Every macro `source` defines, in the order it defines them.
 *
 * The source is flattened first, so a definition split across a bracket - or
 * written inline inside a block, where it does not belong but may still be
 * found - is read the same way the compiler would read it.
 *
 * A definition that does not parse is skipped rather than thrown over: this is
 * what is being edited half the time it is called, and the caller that cares -
 * the compiler, reaching the statement itself, and the diagnostics - reads it
 * with {@link parseMacroDefinition} and hears about it there.
 */
export function findMacroDefinitions(source: string): MacroDefinition[] {
    const definitions: MacroDefinition[] = [];

    for (const line of expandBlockEntries(joinContinuedLines(foldMetadataBlocks(source)))) {
        const trimmed = line.replace(/\t/g, '    ').trim();
        if (!trimmed || trimmed.startsWith('//')) {
            continue;
        }

        try {
            const definition = parseMacroDefinition(trimmed);
            if (definition) {
                definitions.push(definition);
            }
        } catch (error) {
            if (!(error instanceof MacroError)) {
                throw error;
            }
        }
    }

    return definitions;
}

/**
 * Add `definition` to `macros`, refusing a redefinition that disagrees.
 *
 * Defining the same macro twice the same way is harmless - two files importing
 * a third both bring its definitions along - but two definitions that differ
 * mean one of them is silently losing, and which one would come down to the
 * order the import graph happened to be walked in.
 *
 * @throws {MacroError} on a conflicting redefinition.
 */
export function defineMacro(macros: Map<string, MacroDefinition>, definition: MacroDefinition) {
    const existing = macros.get(definition.name);

    if (existing && !sameDefinition(existing, definition)) {
        throw new MacroError(
            `\`${definition.name}\` is defined twice, as \`${signature(existing)}\` and as \`${signature(definition)}\`.`,
        );
    }

    macros.set(definition.name, definition);
}

function sameDefinition(a: MacroDefinition, b: MacroDefinition): boolean {
    return (
        a.body === b.body &&
        (a.parameters ?? []).join(',') === (b.parameters ?? []).join(',') &&
        (a.parameters === undefined) === (b.parameters === undefined)
    );
}

function signature(definition: MacroDefinition): string {
    const parameters = definition.parameters ? `(${definition.parameters.join(', ')})` : '';
    return `macro ${definition.name}${parameters} ${definition.body}`;
}

/**
 * Substitute every macro in `line`, as many times over as the expansions
 * themselves call for.
 *
 * @throws {MacroError} when a macro is called with the wrong number of
 *         arguments, which is the one mistake substitution can actually see.
 */
export function expandMacros(line: string, macros: MacroTable): string {
    return macros.size === 0 ? line : substitute(line, macros, new Set());
}

/**
 * One pass over `text`, expanding every macro that is not already being
 * expanded.
 *
 * `blocked` holds the macros whose bodies this text came out of. That is what
 * ends the recursion: a macro is not expanded inside its own expansion, so
 * `macro A B` and `macro B A` substitute once each and stop, rather than
 * trading places forever.
 */
function substitute(text: string, macros: MacroTable, blocked: ReadonlySet<string>): string {
    let result = '';
    let index = 0;

    while (index < text.length) {
        const char = text[index];

        // A macro's name inside a note is the word, not the macro.
        if (char === '"' || char === "'") {
            const end = endOfStringOrLine(text, index);
            result += text.slice(index, end);
            index = end;
            continue;
        }

        // And a comment runs to the end of the line, taking whatever it says
        // about a macro with it.
        if (char === '/' && text[index + 1] === '/') {
            result += text.slice(index);
            break;
        }

        if (!isIdentifierStart(char) || continuesName(text[index - 1])) {
            result += char;
            index++;
            continue;
        }

        let end = index;
        while (isIdentifierChar(text[end])) {
            end++;
        }

        const name = text.slice(index, end);
        const macro = blocked.has(name) ? undefined : macros.get(name);

        if (!macro) {
            result += name;
            index = end;
            continue;
        }

        const call = macro.parameters === undefined ? undefined : readCall(text, end);

        // A function-like macro that is not called is just its name, exactly as
        // in C: `f = LERP` names a variable, and only `LERP(…)` expands.
        if (macro.parameters !== undefined && !call) {
            result += name;
            index = end;
            continue;
        }

        const expansion = expandOne(macro, call?.arguments ?? [], macros, blocked);
        index = call ? call.end : end;
        result += group(expansion, result, text.slice(index));
    }

    return result;
}

/** A macro call's arguments, and where the closing `)` leaves off. */
interface MacroCall {
    arguments: string[];
    end: number;
}

/**
 * Read the argument list starting at or after `from`, or undefined when the
 * name is not followed by one.
 */
function readCall(text: string, from: number): MacroCall | undefined {
    let index = from;
    while (/\s/.test(text[index] ?? '')) {
        index++;
    }

    if (text[index] !== '(') {
        return undefined;
    }

    const close = matchingBracket(text, index);
    if (close === -1) {
        return undefined;
    }

    const inside = text.slice(index + 1, close);

    return {
        arguments: inside.trim() === '' ? [] : splitTopLevel(inside, ',').map(part => part.trim()),
        end: close + 1,
    };
}

/** Substitute one call: its arguments into the body, the body into the line. */
function expandOne(
    macro: MacroDefinition,
    args: string[],
    macros: MacroTable,
    blocked: ReadonlySet<string>,
): string {
    const parameters = macro.parameters ?? [];

    if (parameters.length !== args.length) {
        throw new MacroError(
            `\`${macro.name}\` takes ${count(parameters.length, 'argument')}, but was given ${args.length}.`,
        );
    }

    // An argument is expanded where it was written rather than where it lands,
    // so a macro passed to a macro sees the caller's macros and not the
    // callee's parameter names.
    const values = new Map(
        parameters.map((parameter, at) => [parameter, substitute(args[at], macros, blocked)]),
    );

    return substitute(
        replaceParameters(macro.body, values),
        macros,
        new Set([...blocked, macro.name]),
    );
}

/** Replace each parameter's name in `body`, leaving strings and comments be. */
function replaceParameters(body: string, values: ReadonlyMap<string, string>): string {
    let result = '';
    let index = 0;

    while (index < body.length) {
        const char = body[index];

        if (char === '"' || char === "'") {
            const end = endOfStringOrLine(body, index);
            result += body.slice(index, end);
            index = end;
            continue;
        }

        if (char === '/' && body[index + 1] === '/') {
            result += body.slice(index);
            break;
        }

        if (!isIdentifierStart(char) || continuesName(body[index - 1])) {
            result += char;
            index++;
            continue;
        }

        let end = index;
        while (isIdentifierChar(body[end])) {
            end++;
        }

        const name = body.slice(index, end);
        const value = values.get(name);
        result += value === undefined ? name : group(value, result, body.slice(end));
        index = end;
    }

    return result;
}

/**
 * Bracket `text` for the place it is being spliced into.
 *
 * The reason this exists is that `macro HALF(x) x / 2` used as `HALF(a + b)`
 * has to be `(a + b) / 2` rather than `a + b / 2`. The reason it is careful is
 * that the same brackets round `a -> a + 1` make an action into a thing Desmos
 * runs differently, and round `1, 2` make two numbers into a point - so
 * anything carrying an operator that brackets would *re-read* goes in as it was
 * written, and it is the author's business how it reads.
 *
 * `before` is the text the expansion follows and `after` the text it runs into.
 * Between two things nothing can bind across - a `=`, a comma, a bracket, the
 * ends of the line - the brackets would say nothing, so they are left off:
 * `y = LERP(0, 10, x)` reads better as `y = 0 + (10 - 0) * x` than wrapped in a
 * second pair that changes no arithmetic.
 */
function group(text: string, before: string, after: string): string {
    const trimmed = text.trim();

    if (!trimmed || hasStructuralOperator(trimmed)) {
        return trimmed;
    }

    if (isDelimited(before, after)) {
        return trimmed;
    }

    // One thing needs no brackets to stay one thing - unless splicing it in
    // would run two numbers together, which is how `macro TAU 6.28` used as
    // `2TAU` becomes twenty-six and a quarter.
    return isAtomic(trimmed) && !fuses(before, trimmed) && !fuses(trimmed, after)
        ? trimmed
        : `(${trimmed})`;
}

/** True when the end of `left` and the start of `right` would read as one number. */
function fuses(left: string, right: string): boolean {
    return /[0-9.]$/.test(left.trimEnd()) && /^[0-9.]/.test(right.trimStart());
}

/**
 * The characters an expansion can follow without brackets: the ones that open
 * something new - a bracket, a separator, a comparison - and `+`, which nothing
 * an expansion may hold binds looser than.
 *
 * A closing bracket is not among them. `(a + b)MACRO` multiplies, so the
 * expansion binds to what is beside it exactly as a name would.
 */
const OPENS_ON_THE_LEFT = /[=,:<>([{+#]/;

/**
 * The characters an expansion can run into without brackets. `-` and `+` join
 * it: what follows a sum is added to or taken from the whole of it either way.
 * An opening bracket is not one - `MACRO(x)` is a call, or a multiplication.
 */
const OPENS_ON_THE_RIGHT = /[=,:<>)\]}+\-#]/;

/** True when neither side of the expansion has anything that could bind to it. */
function isDelimited(before: string, after: string): boolean {
    const left = before.trimEnd().slice(-1);
    const right = after.trimStart();

    return (
        (left === '' || OPENS_ON_THE_LEFT.test(left)) &&
        (right === '' || OPENS_ON_THE_RIGHT.test(right[0]))
    );
}

/** True when brackets round `text` could add nothing: it is already one thing. */
function isAtomic(text: string): boolean {
    if (IDENTIFIER.test(text) || /^\d+(\.\d+)?$/.test(text)) {
        return true;
    }

    // A single bracket group, whether it stands alone - `(1, 2)`, `{x > 0: 1}` -
    // or is a call, `sin(x)`. Either way nothing on the outside binds looser
    // than the bracket already does.
    const open = (/^[a-zA-Z_][a-zA-Z0-9_]*/.exec(text)?.[0] ?? '').length;

    return '([{'.includes(text[open] ?? '') && matchingBracket(text, open) === text.length - 1;
}

/**
 * True when `text` carries something at its top level that brackets would
 * re-read: a definition, a comparison, an action, a comma - or a `:` or a `#`,
 * which make it a run of properties rather than an expression at all.
 */
function hasStructuralOperator(text: string): boolean {
    return splitTopLevel(text, ',').length > 1 || /(?:->|[=<>:#])/.test(stripBracketed(text));
}

/** `text` with everything inside brackets and quotes taken out. */
function stripBracketed(text: string): string {
    let result = '';
    let depth = 0;

    for (let index = 0; index < text.length; index++) {
        const char = text[index];

        if (char === '"' || char === "'") {
            index = endOfStringOrLine(text, index) - 1;
            continue;
        }

        if ('([{'.includes(char)) {
            depth++;
        } else if (')]}'.includes(char)) {
            depth--;
        } else if (depth <= 0) {
            result += char;
        }
    }

    return result;
}

function count(n: number, noun: string): string {
    return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
