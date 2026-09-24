// ═════════════════════════════════════════════════════════════════════════════
// Expression trees to Desmos latex
// ═════════════════════════════════════════════════════════════════════════════
//
// v1 wrote latex by rewriting the source text in passes, and every pass had to
// guess at structure the text did not show - which is how `2^10` came to mean
// 2¹·0 and `4^2/2` came to be 4. Here the structure is the input. Each node is
// written from its children, and brackets go in exactly where the tree says a
// child binds more loosely than the place it sits, so precedence is right by
// construction rather than by pattern.
//
// Two things make latex more than a matter of precedence, and most of this
// file is about them:
//
//   - **Some operands are self-delimiting.** An exponent is braced, and so is
//     either side of a `\frac`, so neither ever needs brackets for grouping -
//     `x^{a+b}`, `\frac{a+b}{2}`. A fraction is then very nearly an atom to
//     whatever is outside it: `-\frac{a}{b}` and `a\frac{b}{c}` need nothing.
//   - **Juxtaposition is read by Desmos, not by us.** A product written with
//     nothing between its factors has to be written so that Desmos reads two
//     factors and not one token: `2` and `3` side by side are 23, `2` beside
//     `\frac{1}{2}` is the mixed number 2½, and anything beside a `\left[` is
//     an index into it. Those get a `\cdot`; everything else is closed up,
//     because that is how Desmos writes a product itself.

import type { Binding, Call, Expression, PiecewiseBranch } from '@axis-dsl/syntax';
import { getFunctionLatex } from '@axis-dsl/syntax';
import { FUNCTION_NAMES, identifierLatex } from './names';

export { identifierLatex } from './names';

/**
 * How tightly each form binds, loosest first, as spec §5.1 lists them.
 *
 * `fraction` is the one level the spec does not have. A `\frac` is division,
 * but its operands are braced, so to its surroundings it is an atom - except
 * as the base of a power or the target of a postfix, where Desmos would accept
 * it bare and draw something nobody could read (`\frac{1}{2}^{2}`). It sits
 * above `prefix`, so `-\frac{a}{b}` and `a\frac{b}{c}` stay bare, and below
 * `postfix`, so `\left(\frac{a}{b}\right)^{2}` keeps its brackets.
 */
const LEVEL = {
    binding: 1,
    sequence: 2,
    action: 3,
    comparison: 4,
    additive: 5,
    product: 6,
    prefix: 7,
    fraction: 7.5,
    power: 8,
    postfix: 9,
    atom: 10,
} as const;

/** How tightly the latex written for `node` binds. */
function levelOf(node: Expression): number {
    switch (node.kind) {
        case 'With':
        case 'For':
            return LEVEL.binding;
        case 'Sequence':
            return LEVEL.sequence;
        // Only ever an element of a list or an index, where anything at the
        // level of an action may stand bare.
        case 'Action':
        case 'ListRange':
            return LEVEL.action;
        case 'Comparison':
            return LEVEL.comparison;
        case 'Binary':
            switch (node.operator) {
                case '+':
                case '-':
                    return LEVEL.additive;
                case '*':
                case 'implicit':
                    return LEVEL.product;
                case '/':
                    return LEVEL.fraction;
                case '^':
                    return LEVEL.power;
            }
            break;
        // A sum, a product and a derivative take the whole product after them,
        // as a sign does - `\sum_{n=1}^{3}n\cdot2` is 12 - so they bind like
        // one. `opensRight` keeps them from taking a factor that was not
        // theirs.
        case 'Unary':
        case 'Derivative':
            return LEVEL.prefix;
        case 'BigOperator':
            // An integral is closed by its `dt`, and is an atom to what follows
            // it - but not as the base of a power, where `dt^{2}` squares the
            // differential.
            return node.operator === 'int' ? LEVEL.fraction : LEVEL.prefix;
        case 'Prime':
        case 'Call':
        case 'Index':
        case 'Member':
        case 'Factorial':
            return LEVEL.postfix;
    }
    return LEVEL.atom;
}

/**
 * Whether the latex for `node` ends in something that takes every factor
 * written after it: a `\sum`, a `\prod`, a `\frac{d}{dx}` - or an integral,
 * whose `dt` would run into a name after it. As the left of a product it has
 * to be bracketed, or the product's right side joins its body.
 */
function opensRight(node: Expression): boolean {
    switch (node.kind) {
        case 'BigOperator':
        case 'Derivative':
            return true;
        case 'Unary':
            return opensRight(node.operand);
        case 'Binary':
            return node.operator !== '^' && node.operator !== '/' && opensRight(node.right);
        default:
            return false;
    }
}

/** The left side of a product: `at(node, LEVEL.product)`, or bracketed if it opens right. */
function factor(node: Expression): string {
    return opensRight(node) ? `\\left(${emit(node)}\\right)` : at(node, LEVEL.product);
}

/**
 * The Desmos latex for an expression.
 *
 * Total over every well-formed tree. The two nodes with no latex at all - a
 * string, and the placeholder the parser leaves where it could not read an
 * expression - throw, since reaching the emitter with either is a bug in
 * whatever called it: the checker reports both long before.
 */
export function emitLatex(expression: Expression): string {
    return emit(expression);
}

function emit(node: Expression): string {
    switch (node.kind) {
        case 'Number':
            return numberLatex(node.value);
        case 'Identifier':
            return identifierLatex(node.name);
        case 'String':
            throw new Error(`A string has no latex: "${node.value}"`);
        case 'Color':
            return colorLatex(node.value);
        case 'Paren':
            // The author's brackets, which hold anything at all.
            return `\\left(${emit(node.expression)}\\right)`;
        case 'Tuple':
            return `\\left(${elements(node.elements)}\\right)`;
        case 'List':
            return `\\left[${listElements(node.elements)}\\right]`;
        case 'ListRange':
            return `${at(node.from, LEVEL.additive)}...${at(node.to, LEVEL.additive)}`;
        case 'Piecewise':
            return `\\left\\{${[
                ...node.branches.map(branch),
                ...(node.otherwise ? [at(node.otherwise, LEVEL.action)] : []),
            ].join(',')}\\right\\}`;
        case 'Abs':
            return `\\left|${at(node.expression, LEVEL.action)}\\right|`;
        case 'Unary':
            // `--x` and `-+x` are both what they look like to Desmos.
            return node.operator + at(node.operand, LEVEL.prefix);
        case 'Binary':
            return binary(node.operator, node.left, node.right);
        case 'Comparison':
            return node.operands
                .map((operand, index) => {
                    const written = isActionDefinition(node, index)
                        ? emit(operand)
                        : at(operand, LEVEL.additive);
                    return index === 0
                        ? written
                        : join(COMPARISON[node.operators[index - 1]], written);
                })
                .reduce(join);
        case 'Call':
            return call(node);
        case 'Prime':
            return `${identifierLatex(node.callee.name)}${"'".repeat(node.order)}\\left(${elements(node.arguments)}\\right)`;
        case 'BigOperator': {
            const variable = identifierLatex(node.variable.name);
            // A sum names its variable in its lower bound; an integral names it
            // in its differential instead.
            const lower = node.operator === 'int' ? '' : `${variable}=`;
            const bounds = `_{${lower}${braced(node.from)}}^{${braced(node.to)}}`;
            // The body is a product at most: `\sum_{n=1}^{3}n+1` is 7, the sum
            // then 1, and `\int_{0}^{1}t+1dt` is not read at all.
            const body = at(node.body, LEVEL.product);
            return node.operator === 'int'
                ? join(join(`\\int${bounds}`, body), `d${variable}`)
                : join(`\\${node.operator}${bounds}`, body);
        }
        case 'Derivative':
            return `\\frac{d}{d${identifierLatex(node.variable.name)}}${at(node.body, LEVEL.product)}`;
        case 'Index':
            return `${at(node.target, LEVEL.postfix)}\\left[${at(node.index, LEVEL.action)}\\right]`;
        case 'Member':
            return node.arguments
                ? `${member(node.target)}.${memberLatex(node.name.name)}\\left(${elements(node.arguments)}\\right)`
                : `${member(node.target)}.${memberLatex(node.name.name)}`;
        case 'Factorial':
            return `${at(node.operand, LEVEL.postfix)}!`;
        case 'Action':
            return join(
                join(at(node.target, LEVEL.comparison), '\\to'),
                at(node.value, LEVEL.comparison),
            );
        case 'Sequence':
            // Bare: a run of actions in brackets is a point to Desmos, which
            // runs its last coordinate and drops the rest without a word.
            return node.elements.map(element => at(element, LEVEL.action)).join(',');
        case 'With':
            return scoped(node.body, '\\operatorname{with}', node.bindings);
        case 'For':
            return scoped(node.body, '\\operatorname{for}', node.bindings);
        case 'ErrorExpression':
            throw new Error('An expression the parser could not read has no latex');
    }
}

/** `node`, bracketed if it binds more loosely than `level`. */
function at(node: Expression, level: number): string {
    const written = emit(node);
    return levelOf(node) >= level ? written : `\\left(${written}\\right)`;
}

/**
 * What goes inside a pair of braces - an exponent, either side of a fraction,
 * a root. The braces are the grouping, so the author's own brackets around
 * the whole of it are dropped: they were how Axis said which characters the
 * script takes (`x^(n + 1)`, `(a + b) / 2`), and left in they would be drawn.
 */
function braced(node: Expression): string {
    let inner = node;
    while (inner.kind === 'Paren') {
        inner = inner.expression;
    }
    return at(inner, LEVEL.action);
}

/**
 * Whether operand `index` of `node` is the value of a named action - `R = a ->
 * 1, b -> 2`, `R = a -> 1` (spec §5.6) - which is written bare. In brackets a
 * run of actions is a point to Desmos, and it runs the last coordinate and
 * drops the rest. A value with bindings, `g = a - b with a = 2`, is written
 * bare too, as Desmos writes it - and has to be, when what it binds for is a
 * run: `R = (a -> 1, b -> m with m = 3)` is a point, and Desmos says so.
 */
function isActionDefinition(node: Expression & { kind: 'Comparison' }, index: number): boolean {
    const operand = node.operands[index];
    return (
        node.operators.length === 1 &&
        node.operators[0] === '=' &&
        index === 1 &&
        (operand.kind === 'Sequence' || operand.kind === 'Action' || operand.kind === 'With')
    );
}

const COMPARISON = {
    '=': '=',
    '<': '<',
    '<=': '\\le',
    '>': '>',
    '>=': '\\ge',
    '~': '\\sim',
} as const;

function binary(
    operator: '+' | '-' | '*' | '/' | '^' | 'implicit',
    left: Expression,
    right: Expression,
): string {
    switch (operator) {
        // Left-associative, so a right operand at the same level is bracketed:
        // `a-(b-c)`. A negation on the right is not - `1--2` is 3 to Desmos.
        case '+':
        case '-':
            return join(at(left, LEVEL.additive) + operator, at(right, LEVEL.product));
        case '*':
            return join(join(factor(left), '\\cdot'), at(right, LEVEL.prefix));
        case 'implicit':
            return juxtapose(
                factor(left),
                // A negation has to be bracketed here, where `*` did not: with
                // nothing in front of it, `2-x` is a subtraction.
                at(right, LEVEL.fraction),
            );
        case '/':
            // The braces are the grouping, so the operands are never bracketed
            // for precedence: `\frac{a+b}{c}`, not `\frac{\left(a+b\right)}{c}`.
            return `\\frac{${braced(left)}}{${braced(right)}}`;
        case '^':
            // Right-associative, so the base is bracketed at its own level and
            // the exponent never is: `2^{3^{2}}`, `\left(2^{3}\right)^{2}`. The
            // exponent is always braced - `x^10` is x¹·0, and that is the bug
            // this file exists to fix.
            return `${at(left, LEVEL.postfix)}^{${braced(right)}}`;
    }
}

/**
 * Two factors side by side, with only as much between them as Desmos needs to
 * read them as two.
 */
function juxtapose(left: string, right: string): string {
    const merges =
        // Digits run together - `2` then `3` is 23 - and so do a number and a
        // decimal point.
        /^[0-9.]/.test(right) ||
        // Brackets after anything index it: `a\left[1,2\right]` is `a[1, 2]`.
        right.startsWith('\\left[') ||
        // A whole number before a fraction is a mixed number: `2\frac{1}{2}`
        // is 2½, not 1. Desmos reads it that way only after an integer, but a
        // `\cdot` after any digit costs nothing and is plainly a product.
        (/[0-9.]$/.test(left) && right.startsWith('\\frac'));

    return merges ? join(join(left, '\\cdot'), right) : join(left, right);
}

/**
 * `left` then `right`, with a space between them where a command would
 * otherwise swallow the letter after it: `\pi x`, not the command `\pix`.
 */
function join(left: string, right: string): string {
    return /\\[a-zA-Z]+$/.test(left) && /^[a-zA-Z]/.test(right) ? `${left} ${right}` : left + right;
}

/** Comma-separated values - a point, a call's arguments. */
function elements(nodes: readonly Expression[]): string {
    return nodes.map(node => at(node, LEVEL.action)).join(',');
}

/**
 * A list's elements. A comprehension is a list holding a lone `for`, and it
 * is written bare - its bindings run to the closing bracket, which is where
 * the list ends anyway. Anywhere else a `with` or `for` is bracketed, since its
 * bindings would take the commas after it.
 */
function listElements(nodes: readonly Expression[]): string {
    const [only] = nodes;
    if (nodes.length === 1 && (only.kind === 'For' || only.kind === 'With')) {
        return emit(only);
    }
    return elements(nodes);
}

function branch({ condition, value }: PiecewiseBranch): string {
    const written = at(condition, LEVEL.comparison);
    return value ? `${written}:${at(value, LEVEL.action)}` : written;
}

/**
 * `body\operatorname{with}a=1,b=2`. A binding's value is bracketed below the
 * level of a sum, since the `=` and the commas around it are the binding's.
 */
function scoped(body: Expression, keyword: string, bindings: readonly Binding[]): string {
    const written = bindings
        .map(({ name, value }) => `${identifierLatex(name.name)}=${at(value, LEVEL.additive)}`)
        .join(',');
    // A chain of them reads left to right, as Desmos reads it - `a with b = 1
    // for n = L` is the `with`, then the `for` over it - so a `with` or a
    // `for` as the body needs no brackets.
    const inner =
        body.kind === 'With' || body.kind === 'For' ? emit(body) : at(body, LEVEL.sequence);
    return join(join(inner, keyword), written);
}

/**
 * A call: `\sin\left(x\right)`, `\operatorname{mean}\left(L\right)`, or a
 * user's `w_{ave}\left(x\right)`. The roots have shapes of their own.
 */
function call({ callee, arguments: args }: Call): string {
    const name = callee.name;

    if (name === 'sqrt' && args.length === 1) {
        return `\\sqrt{${braced(args[0])}}`;
    }
    if (name === 'log' && args.length === 2) {
        const [argument, base] = args;
        return `\\log_{${braced(base)}}\\left(${at(argument, LEVEL.action)}\\right)`;
    }
    if (name === 'nthroot' && args.length === 2) {
        const [radicand, index] = args;
        return `\\sqrt[${braced(index)}]{${braced(radicand)}}`;
    }

    return `${identifierLatex(name)}\\left(${elements(args)}\\right)`;
}

/**
 * A member's target. `2.x` would read as the number 2. and then an `x`, so a
 * number is bracketed even though it is an atom.
 */
function member(target: Expression): string {
    return target.kind === 'Number' ? `\\left(${emit(target)}\\right)` : at(target, LEVEL.postfix);
}

/**
 * `P.x`, `L.\operatorname{count}`, `L.\max`: a function used as a member is
 * written as its command, which is how Desmos writes it.
 */
function memberLatex(name: string): string {
    return FUNCTION_NAMES.has(name) ? getFunctionLatex(name) : identifierLatex(name);
}

/**
 * A number, as Desmos reads one.
 *
 * Written as it was, except in scientific notation: Desmos has no `e` in a
 * number, so `1e-3` would be 1·e−3. It is written out in full instead, which
 * the tree's string makes exact.
 */
function numberLatex(value: string): string {
    const scientific = /^(\d*)(?:\.(\d*))?[eE]([+-]?\d+)$/.exec(value);
    if (!scientific) {
        return value;
    }

    const [, whole = '', fraction = '', exponent] = scientific;
    const digits = whole + fraction;
    const point = whole.length + Number(exponent);

    const padded =
        point <= 0
            ? `0.${'0'.repeat(-point)}${digits}`
            : point >= digits.length
              ? digits + '0'.repeat(point - digits.length)
              : `${digits.slice(0, point)}.${digits.slice(point)}`;

    return (
        padded
            // Leading zeros, keeping the one before a point…
            .replace(/^0+(?=\d)/, '')
            // …and trailing ones after it, with the point if nothing is left.
            .replace(/(\.\d*?)0+$/, '$1')
            .replace(/\.$/, '') || '0'
    );
}

/**
 * `#c74440` → `\operatorname{rgb}\left(199,68,64\right)`.
 *
 * Desmos has no colour literal; a colour in an expression - a list of colours,
 * a piecewise choosing one - is a call to `rgb`.
 */
function colorLatex(value: string): string {
    const hex = value.slice(1);
    const full = hex.length === 3 ? [...hex].map(digit => digit + digit).join('') : hex;
    const channels = [0, 2, 4].map(offset => parseInt(full.slice(offset, offset + 2), 16));
    return `\\operatorname{rgb}\\left(${channels.join(',')}\\right)`;
}
