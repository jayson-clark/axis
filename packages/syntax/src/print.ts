// ═════════════════════════════════════════════════════════════════════════════
// The printer
// ═════════════════════════════════════════════════════════════════════════════
//
// A syntax tree back to Axis text, laid out the one way the formatter settles
// on. Three callers want that, and they are why it lives beside the parser:
//
//   - `format`, which re-prints a whole file the author wrote and must hand
//     back every comment and blank line it was given;
//   - the decompiler, which builds trees from a graph's latex - with no
//     brackets in them at all, since latex precedence is not Axis precedence -
//     and needs text that reads back as exactly that tree;
//   - write-back, which replaces one statement with a node it made and wants
//     it to look as if the author had typed it.
//
// So the printer never trusts brackets to be there. It knows the precedence
// table of spec §5.1 and puts back exactly the parentheses a tree needs to be
// read the same way again, keeps the ones an author wrote (`Paren` nodes), and
// adds nothing else. `parseExpression(printExpression(tree))` is `tree`, give
// or take `Paren` nodes, and the tests hold it to that over random trees.
//
// Layout is a second, separate step. Printing makes a small document - text,
// and bracket groups that may be spread one element to a line - and `fit`
// decides which groups to open, the way v1's formatter did: a line that runs
// past the width is broken at the first bracket that runs past it, and only
// when that makes the longest line shorter. Only brackets can be broken,
// because a newline anywhere else ends a statement (spec §2.4).

import type * as ast from './ast';
import { lex } from './lexer';
import { parse } from './parser';
import type { Token } from './tokens';

export interface PrintOptions {
    /** One level of indentation: a string, or a number of spaces. Four spaces by default. */
    indent?: string | number;
    /**
     * Where a line is wrapped: 100 by default. `0` turns wrapping off, and
     * leaves metadata inline however long it runs.
     */
    maxLineLength?: number;
}

export interface StatementPrintOptions extends PrintOptions {
    /**
     * The block depth the statement sits at. Continuation lines are indented
     * to it and it counts against the width; the first line is returned
     * unindented, ready to replace a statement's span in place.
     */
    level?: number;
    /**
     * The text the statement was parsed from, if it was. With it the printer
     * keeps a bracket the author spread over lines spread and a block they
     * wrote on one line on one line, and writes an `ErrorStatement` back as
     * it was. Without it - a node built from scratch - layout is the
     * printer's own.
     */
    source?: string;
}

const DEFAULT_INDENT = '    ';
const DEFAULT_MAX_LINE_LENGTH = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Entry points
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An expression as canonical Axis text, on one line: precedence-correct for a
 * tree with no `Paren` nodes, and read as a statement's value is - so an
 * action run and a definition's loose `=` (spec §5.1) come out as themselves.
 */
export function printExpression(expression: ast.Expression): string {
    const printer = new Printer({ maxLineLength: 0 });
    return flat(printer.statementValue(expression, true));
}

/** A statement as canonical Axis text: metadata, blocks and all. */
export function printStatement(
    statement: ast.Statement,
    options: StatementPrintOptions = {},
): string {
    const level = options.level ?? 0;
    const printer = new Printer(options, options.source);
    const lines = printer.entry(statement, level);
    lines[0] = lines[0].slice(printer.indentOf(level).length);
    return lines.join('\n');
}

/**
 * Format a whole file.
 *
 * Every comment stays where it was relative to the code around it, and blank
 * lines between statements are kept, a run of them as one. A file that does
 * not parse is handed back exactly as it was: a formatter guessing at what a
 * broken line meant is how code gets lost, and the diagnostics already say
 * where the problem is.
 */
export function format(source: string, options: PrintOptions = {}): string {
    const tree = parse(source);
    if (tree.diagnostics.some(diagnostic => diagnostic.severity === 'error')) return source;

    const printer = new Printer(options, source, tree.tokens);
    const { lines } = printer.body(tree.file.statements, 0, source.length, 0);
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    const text = lines.join(eol);
    return text === '' || !/\n\s*$/.test(source) ? text : text + eol;
}

// ─────────────────────────────────────────────────────────────────────────────
// Comparing trees
// ─────────────────────────────────────────────────────────────────────────────

/** A copy of a tree without its `Paren` nodes: what it means, not how it was bracketed. */
export function stripParens<T>(node: T): T {
    return strip(node, false) as T;
}

/**
 * Whether two trees are the same source: equal once spans, `Paren` nodes and
 * whether metadata was written inline or as a block are set aside - the three
 * things layout may change and meaning may not.
 */
export function sameTree(a: unknown, b: unknown): boolean {
    return deepEqual(strip(a, true), strip(b, true));
}

function strip(node: unknown, layout: boolean): unknown {
    if (Array.isArray(node)) return node.map(item => strip(item, layout));
    if (node === null || typeof node !== 'object') return node;
    const record = node as Record<string, unknown>;
    if (record.kind === 'Paren') return strip(record.expression, layout);
    return Object.fromEntries(
        Object.entries(record)
            .filter(
                ([key]) =>
                    !layout || (key !== 'span' && !(key === 'block' && record.kind === 'Metadata')),
            )
            .map(([key, value]) => [key, strip(value, layout)]),
    );
}

function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(
        key =>
            Object.prototype.hasOwnProperty.call(b, key) &&
            deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Documents
// ─────────────────────────────────────────────────────────────────────────────
//
// What printing makes and layout reads: text, concatenations of it, and bracket
// groups. A group is either flat - `[1, 2, 3]` - or broken, its opener ending
// one line, each item on a line of its own with its comma, and its closer
// starting the next.

type Doc = string | Doc[] | Group;

interface Group {
    kind: 'group';
    open: string;
    items: Doc[];
    close: string;
    /** Broken whatever the width: the author spread it, or something inside it had to be. */
    broken: boolean;
}

/**
 * A bracket group. A group of several items is broken when anything inside it
 * is, since its own line could not hold that anyway; a single item is not, and
 * lets the break show through it instead - `f(g(` over a broken `g` rather than
 * a line apiece for `f(` and `g(`.
 */
function group(open: string, items: Doc[], close: string, authorBroken = false): Group {
    return {
        kind: 'group',
        open,
        items,
        close,
        broken: authorBroken || (items.length > 1 && items.some(containsBreak)),
    };
}

const isGroup = (doc: Doc): doc is Group => typeof doc === 'object' && !Array.isArray(doc);

function containsBreak(doc: Doc): boolean {
    if (typeof doc === 'string') return false;
    if (Array.isArray(doc)) return doc.some(containsBreak);
    return doc.broken || doc.items.some(containsBreak);
}

/** A document on one line, every group flat. */
function flat(doc: Doc): string {
    if (typeof doc === 'string') return doc;
    if (Array.isArray(doc)) return doc.map(flat).join('');
    const items = doc.items.map(flat).join(', ');
    return doc.open + items + doc.close;
}

function join(docs: Doc[], separator: string): Doc[] {
    return docs.flatMap((doc, index) => (index === 0 ? [doc] : [separator, doc]));
}

/**
 * The parts of a line as layout sees them: concatenations opened up, and a
 * single-item group that nothing forces open opened up too, so that what is
 * inside it is weighed as if it stood on the line itself.
 */
function lineParts(docs: Doc[]): Doc[] {
    return docs.flatMap((doc): Doc[] => {
        if (typeof doc === 'string') return doc === '' ? [] : [doc];
        if (Array.isArray(doc)) return lineParts(doc);
        if (doc.items.length === 0) return [doc.open + doc.close];
        if (doc.items.length === 1 && !doc.broken) {
            return [doc.open, ...lineParts([doc.items[0]]), doc.close];
        }
        return [doc];
    });
}

const longest = (lines: string[]) => lines.reduce((most, line) => Math.max(most, line.length), 0);

// ─────────────────────────────────────────────────────────────────────────────
// Expressions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where an expression is being printed, as far as the parser reading it back
 * would care.
 *
 * `allowRun`: whether a comma-separated action run can stand here (a
 * statement's value, a ticker, a property value), or would read as a tuple.
 *
 * `inAbs`: whether a `|` here would close an absolute value rather than open a
 * juxtaposed one.
 *
 * `last`: whether nothing follows at this level that a `with` or `for` would
 * take for another binding - a comma inside a bracket does.
 *
 * `leftEdge`: whether this is the start of a statement's value, where
 * `name = …` would be read as a definition taking everything after it (spec
 * §5.1) rather than the comparison it is.
 */
interface Context {
    allowRun: boolean;
    inAbs: boolean;
    last: boolean;
    leftEdge: boolean;
}

/** Inside a bracket: a fresh start, everything but a run allowed. */
const ELEMENT: Context = { allowRun: false, inAbs: false, last: true, leftEdge: false };
const RUN: Context = { ...ELEMENT, allowRun: true };

/**
 * How tightly a node binds, by the levels of spec §5.1: 1 is `with`/`for`, 10
 * an atom. A node printed where the level asked for is higher than its own
 * gets brackets.
 */
function levelOf(expression: ast.Expression): number {
    switch (expression.kind) {
        case 'With':
        case 'For':
            return 1;
        case 'Sequence':
            return 2;
        case 'Action':
            return 3;
        case 'Comparison':
            return 4;
        case 'Binary':
            switch (expression.operator) {
                case '+':
                case '-':
                    return 5;
                case '^':
                    return 8;
                default:
                    return 6;
            }
        case 'Unary':
        case 'Derivative':
            return 7;
        case 'Call':
        case 'Prime':
        case 'Index':
        case 'Member':
        case 'Factorial':
            return 9;
        default:
            return 10;
    }
}

/** A string literal, quoted and escaped the three ways the lexer reads back. */
function quote(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

/** The first and last tokens of some text, which is what decides how two pieces may touch. */
function edgeTokens(text: string): { first?: Token; last?: Token } {
    const tokens = lex(text).tokens.filter(
        token => token.kind !== 'whitespace' && token.kind !== 'eof',
    );
    return { first: tokens[0], last: tokens[tokens.length - 1] };
}

/**
 * Whether a token can begin the right-hand side of a juxtaposition: never a
 * sign (`a -b` subtracts), a `[` (it indexes) or a string, and a `|` only where
 * it would not close an absolute value instead.
 */
function startsFactor(token: Token | undefined, inAbs: boolean): boolean {
    if (!token) return false;
    if (token.kind === 'number' || token.kind === 'identifier') return true;
    if (token.kind !== 'punctuation') return false;
    return token.text === '(' || token.text === '{' || (token.text === '|' && !inAbs);
}

/**
 * Whether a node's last operand is a `d/dx`, which takes every factor after it:
 * `(d/dx x) * 2` loses its meaning without the brackets.
 */
function opensRight(expression: ast.Expression): boolean {
    switch (expression.kind) {
        case 'Derivative':
            return true;
        case 'Unary':
            return opensRight(expression.operand);
        case 'Binary':
            return expression.operator !== '^' && opensRight(expression.right);
        default:
            return false;
    }
}

/** `2`, `-2`: a number written straight against what it multiplies, `2x`. */
const isCoefficient = (expression: ast.Expression): boolean =>
    expression.kind === 'Number' ||
    (expression.kind === 'Unary' && expression.operand.kind === 'Number');

// ─────────────────────────────────────────────────────────────────────────────
// The printer
// ─────────────────────────────────────────────────────────────────────────────

type Entry = ast.Statement | ast.Property | ast.TableColumn;

/** A run of entries the author wrote on one line, and the comment trailing it. */
interface Item {
    entries: Entry[];
    comment?: string;
    blankBefore: boolean;
}

class Printer {
    private readonly unit: string;
    private readonly width: number;
    private readonly tokens: Token[];
    private readonly comments: Token[];

    constructor(
        options: PrintOptions,
        private readonly source?: string,
        tokens?: Token[],
    ) {
        this.unit =
            typeof options.indent === 'number'
                ? ' '.repeat(options.indent)
                : (options.indent ?? DEFAULT_INDENT);
        this.width = options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
        this.tokens = tokens ?? (source === undefined ? [] : lex(source).tokens);
        this.comments = this.tokens.filter(token => token.kind === 'comment');
    }

    indentOf(level: number): string {
        return this.unit.repeat(level);
    }

    private fits(line: string): boolean {
        return this.width <= 0 || line.length <= this.width;
    }

    // ── Expressions ──────────────────────────────────────────────────────────

    /**
     * A statement's value, where `lhs = rhs` takes everything after the `=`
     * (spec §5.1) - so a definition's right-hand side needs no brackets for
     * being loose, and anything else that happens to start with `name =` does.
     */
    statementValue(expression: ast.Expression, allowRun: boolean): Doc {
        if (
            expression.kind === 'Comparison' &&
            expression.operators.length === 1 &&
            expression.operators[0] === '='
        ) {
            const context = { ...RUN, allowRun };
            return [
                this.expression(expression.operands[0], 5, context),
                ' = ',
                this.expression(expression.operands[1], 1, context),
            ];
        }
        return this.expression(expression, 1, { ...RUN, allowRun, leftEdge: true });
    }

    /** An expression where the grammar reads at least `level`, bracketed if it binds looser. */
    private expression(expression: ast.Expression, level: number, context: Context): Doc {
        const bracket =
            levelOf(expression) < level ||
            (expression.kind === 'Sequence' && !context.allowRun) ||
            ((expression.kind === 'With' || expression.kind === 'For') && !context.last) ||
            (context.leftEdge &&
                expression.kind === 'Comparison' &&
                expression.operators[0] === '=');
        return bracket ? this.parenthesized(expression) : this.bare(expression, context);
    }

    /**
     * An expression in brackets the printer adds. A run cannot be bracketed -
     * `(a -> 1, b -> 2)` is a tuple - so one that turns up where no run can
     * stand is printed as the tuple it would be read back as.
     */
    private parenthesized(expression: ast.Expression): Doc {
        if (expression.kind === 'Sequence') {
            return group('(', this.elements(expression.elements, 3), ')');
        }
        return group('(', [this.expression(expression, 1, ELEMENT)], ')');
    }

    /** Comma-separated elements inside a bracket; a `with` in any but the last is bracketed. */
    private elements(elements: ast.Expression[], level = 1): Doc[] {
        return elements.map((element, index) =>
            this.expression(element, level, { ...ELEMENT, last: index === elements.length - 1 }),
        );
    }

    /** Whether the author spread a bracket over lines: a newline straight after its opener. */
    private authorBroke(
        opener: number,
        first: ast.Expression | ast.PiecewiseBranch | undefined,
    ): boolean {
        if (this.source === undefined || !first || opener < 0) return false;
        return this.source.slice(opener + 1, first.span.start).includes('\n');
    }

    /** Where a character is first found at or after an offset, in the source, if there is one. */
    private find(character: string, from: number): number {
        return this.source === undefined ? -1 : this.source.indexOf(character, from);
    }

    private bare(expression: ast.Expression, context: Context): Doc {
        // What a node's first operand is printed with: its own context, since
        // it stands where the node does. Every other operand does not.
        const inner: Context = { ...context, leftEdge: false, last: true };

        switch (expression.kind) {
            case 'Number':
            case 'Color':
                return expression.value;
            case 'Identifier':
                return expression.name;
            case 'String':
                return quote(expression.value);
            case 'ErrorExpression':
                return '';

            case 'Paren':
                return group(
                    '(',
                    [this.expression(expression.expression, 1, ELEMENT)],
                    ')',
                    this.authorBroke(expression.span.start, expression.expression),
                );
            case 'Tuple': {
                // One element keeps its trailing comma, which is all that makes
                // it a tuple rather than a bracket - and is why a `with` in it
                // counts as followed by something.
                const items =
                    expression.elements.length === 1
                        ? [
                              [
                                  this.expression(expression.elements[0], 1, {
                                      ...ELEMENT,
                                      last: false,
                                  }),
                                  ',',
                              ],
                          ]
                        : this.elements(expression.elements);
                return group(
                    '(',
                    items,
                    ')',
                    this.authorBroke(expression.span.start, expression.elements[0]),
                );
            }
            case 'List':
                return group(
                    '[',
                    this.elements(expression.elements),
                    ']',
                    this.authorBroke(expression.span.start, expression.elements[0]),
                );
            case 'ListRange':
                // Level 2 at either end: a `with` is bracketed rather than left
                // to wonder whether the `...` or a comma after it is its own.
                return [
                    this.expression(expression.from, 2, ELEMENT),
                    '...',
                    this.expression(expression.to, 2, ELEMENT),
                ];
            case 'Piecewise': {
                const parts = [
                    ...expression.branches.flatMap(branch =>
                        branch.value ? [branch.condition, branch.value] : [branch.condition],
                    ),
                    ...(expression.otherwise ? [expression.otherwise] : []),
                ];
                const printed = parts.map((part, index) =>
                    this.expression(part, 1, { ...ELEMENT, last: index === parts.length - 1 }),
                );
                let at = 0;
                const items: Doc[] = expression.branches.map(branch =>
                    branch.value ? [printed[at++], ': ', printed[at++]] : printed[at++],
                );
                if (expression.otherwise) items.push(printed[at]);
                return group(
                    '{',
                    items,
                    '}',
                    this.authorBroke(
                        expression.span.start,
                        expression.branches[0] ?? expression.otherwise ?? undefined,
                    ),
                );
            }
            case 'Abs':
                return [
                    '|',
                    this.expression(expression.expression, 1, { ...ELEMENT, inAbs: true }),
                    '|',
                ];

            case 'Unary':
                return [expression.operator, this.expression(expression.operand, 7, inner)];
            case 'Binary':
                return this.binary(expression, context, inner);
            case 'Comparison':
                return expression.operands.flatMap((operand, index) => [
                    index === 0 ? '' : ` ${expression.operators[index - 1]} `,
                    this.expression(operand, 5, index === 0 ? context : inner),
                ]);

            case 'Call': {
                const opener = this.find('(', expression.callee.span.end);
                return [
                    expression.callee.name,
                    group(
                        '(',
                        this.elements(expression.arguments),
                        ')',
                        this.authorBroke(opener, expression.arguments[0]),
                    ),
                ];
            }
            case 'Prime': {
                const opener = this.find('(', expression.callee.span.end);
                return [
                    expression.callee.name,
                    "'".repeat(expression.order),
                    group(
                        '(',
                        this.elements(expression.arguments),
                        ')',
                        this.authorBroke(opener, expression.arguments[0]),
                    ),
                ];
            }
            case 'BigOperator': {
                const opener = this.find('(', expression.name.span.end);
                const to = this.expression(expression.to, 5, ELEMENT);
                return [
                    expression.operator,
                    group(
                        '(',
                        [
                            [
                                expression.variable.name,
                                ' = ',
                                this.expression(expression.from, 5, ELEMENT),
                                // `1.. .5`, not `1...5`, which is a list range.
                                flat(to).startsWith('.') ? '.. ' : '..',
                                to,
                            ],
                            this.expression(expression.body, 1, ELEMENT),
                        ],
                        ')',
                        this.authorBroke(opener, expression.variable),
                    ),
                ];
            }
            case 'Derivative': {
                // The body must open with something that multiplies, or `d/dx`
                // reads as the division it would otherwise be: `d/dx (-x)`.
                let body = this.expression(expression.body, 6, inner);
                if (!startsFactor(edgeTokens(flat(body)).first, context.inAbs)) {
                    body = this.parenthesized(expression.body);
                }
                return [`d/d${expression.variable.name} `, body];
            }
            case 'Index':
                return [
                    this.expression(expression.target, 9, context),
                    group('[', [this.expression(expression.index, 1, ELEMENT)], ']'),
                ];
            case 'Member':
                return [this.expression(expression.target, 9, context), '.', expression.name.name];
            case 'Factorial':
                return [this.expression(expression.operand, 9, context), '!'];

            case 'Action':
                return [
                    this.expression(expression.target, 3, context),
                    ' -> ',
                    this.expression(expression.value, 4, inner),
                ];
            case 'Sequence':
                return join(
                    expression.elements.map((element, index) =>
                        this.expression(element, 3, index === 0 ? context : inner),
                    ),
                    ', ',
                );
            case 'With':
            case 'For':
                return [
                    this.expression(expression.body, 1, { ...context, last: true }),
                    expression.kind === 'With' ? ' with ' : ' for ',
                    join(
                        expression.bindings.map(binding => [
                            binding.name.name,
                            ' = ',
                            this.expression(binding.value, 4, inner),
                        ]),
                        ', ',
                    ),
                ];
        }
    }

    private binary(expression: ast.Binary, context: Context, inner: Context): Doc {
        const { operator, left, right } = expression;
        switch (operator) {
            case '+':
            case '-':
                return [
                    this.expression(left, 5, context),
                    ` ${operator} `,
                    this.expression(right, 6, inner),
                ];
            case '*':
            case '/':
                return [
                    opensRight(left) ? this.parenthesized(left) : this.expression(left, 6, context),
                    ` ${operator} `,
                    this.expression(right, 7, inner),
                ];
            case '^':
                return [this.expression(left, 9, context), ' ^ ', this.exponent(right, inner)];
            case 'implicit':
                return this.juxtaposition(expression, context, inner);
        }
    }

    /** An exponent may open with a sign, `2 ^ -1`, and is right-associative, `2 ^ 3 ^ 2`. */
    private exponent(expression: ast.Expression, context: Context): Doc {
        if (expression.kind === 'Unary') {
            return [expression.operator, this.exponent(expression.operand, context)];
        }
        return this.expression(expression, 8, context);
    }

    /**
     * `2x`, `2pi x`, `x y`, `3cos(t)`, `2(x + 1)`, `(a)(b)`.
     *
     * Juxtaposition has no operator to stand between its operands, so what
     * keeps them apart is spelling, and three things go wrong when it is not
     * minded. Two words run together become one name - `x y` is not `xy`, and
     * `2e2` is a number. A name straight before a bracket is a call, with or
     * without a space (spec §5.3), so `x (a + b)` has to be written
     * `(x)(a + b)`. And a right-hand side that opens with anything the parser
     * does not take for one - a sign, a `[`, a string - has to be bracketed.
     *
     * Past that it is taste: a number sits tight against the name or bracket
     * it multiplies, and anything else is spaced.
     */
    private juxtaposition(expression: ast.Binary, context: Context, inner: Context): Doc {
        let left = opensRight(expression.left)
            ? this.parenthesized(expression.left)
            : this.expression(expression.left, 6, context);
        let right = this.expression(expression.right, 8, inner);

        let { first } = edgeTokens(flat(right));
        if (!startsFactor(first, context.inAbs)) {
            right = this.parenthesized(expression.right);
            first = edgeTokens('(').first;
        }
        const { last } = edgeTokens(flat(left));
        const coefficient = isCoefficient(expression.left);

        let gap = ' ';
        if (first?.text === '(') {
            if (last?.kind === 'identifier') {
                left = this.parenthesized(expression.left);
                gap = '';
            } else if (coefficient || last?.kind !== 'number') {
                gap = '';
            }
        } else if (coefficient && first?.text === '|') {
            gap = '';
        } else if (coefficient && first?.kind === 'identifier' && !/^e\d/.test(first.text)) {
            gap = '';
        }
        return [left, gap, right];
    }

    /** `lo..hi step s soft min` */
    private range(range: ast.Range): Doc {
        const max = range.max ? this.expression(range.max, 4, RUN) : '';
        // `0.. .5`, not `0...5`, which is a list range.
        const gap = flat(max).startsWith('.') ? ' ' : '';
        return [
            range.min ? this.expression(range.min, 4, RUN) : '',
            '..',
            gap,
            max,
            range.step ? [' step ', this.expression(range.step, 4, RUN)] : '',
            range.soft === 'none' ? '' : range.soft === 'both' ? ' soft' : ` soft ${range.soft}`,
        ];
    }

    private property(property: ast.Property): Doc {
        if (!property.colon) return property.key.name;
        if (!property.value) return `${property.key.name}:`;
        const value =
            property.value.kind === 'Range'
                ? this.range(property.value)
                : this.expression(property.value, 1, RUN);
        return [property.key.name, ': ', value];
    }

    // ── Layout ───────────────────────────────────────────────────────────────

    /**
     * A line's worth of document, broken over as many lines as it takes.
     *
     * A group something forces open is opened, first come first. Otherwise a
     * line that fits stays whole, and one that does not is broken at the first
     * group of several items still open past the width - the first rather than
     * the widest, since breaking it moves everything after it, which is then
     * measured again. A break that leaves the longest line no shorter - a line
     * made long by a name or a string, which no bracket can help - is not
     * made.
     */
    fit(docs: Doc[], level: number): string[] {
        const parts = lineParts(docs);
        const forced = parts.findIndex(part => isGroup(part) && part.broken);
        if (forced >= 0) return this.breakAt(parts, forced, level);

        const indent = this.indentOf(level);
        const line = indent + parts.map(flat).join('');
        if (this.fits(line)) return [line];

        let column = indent.length;
        for (let index = 0; index < parts.length; index++) {
            const part = parts[index];
            const text = flat(part);
            if (isGroup(part) && part.items.length > 1 && column + text.length - 1 >= this.width) {
                const broken = this.breakAt(parts, index, level);
                return longest(broken) < line.length ? broken : [line];
            }
            column += text.length;
        }
        return [line];
    }

    private breakAt(parts: Doc[], index: number, level: number): string[] {
        const open = parts[index] as Group;
        const { items } = open;
        return [
            ...this.fit([...parts.slice(0, index), open.open], level),
            ...items.flatMap((item, at) =>
                this.fit([item, at < items.length - 1 ? ',' : ''], level + 1),
            ),
            ...this.fit([open.close, ...parts.slice(index + 1)], level),
        ];
    }

    // ── Statements ───────────────────────────────────────────────────────────

    /** An entry of a block - a statement, a property, a column - at a depth, fully indented. */
    entry(entry: Entry, level: number): string[] {
        if (
            this.source !== undefined &&
            (entry.kind === 'ErrorStatement' || this.hasLooseComments(entry))
        ) {
            return this.verbatim(entry, level);
        }

        switch (entry.kind) {
            case 'ErrorStatement':
                return [this.indentOf(level)];
            case 'Property':
                return this.fit([this.property(entry)], level);
            case 'TableColumn': {
                const head: Doc = entry.values
                    ? [
                          this.expression(entry.header, 5, RUN),
                          ' = ',
                          group(
                              '[',
                              this.elements(entry.values),
                              ']',
                              this.authorBroke(
                                  this.find('[', entry.header.span.end),
                                  entry.values[0],
                              ),
                          ),
                      ]
                    : this.statementValue(entry.header, false);
                return this.annotated(head, entry.metadata, level);
            }
            case 'ExpressionStatement':
                return this.annotated(
                    this.statementValue(entry.expression, true),
                    entry.metadata,
                    level,
                );
            case 'NoteStatement':
                return this.annotated(quote(entry.text.value), entry.metadata, level);
            case 'ImportStatement':
                return this.annotated(
                    [
                        'import ',
                        quote(entry.path.value),
                        entry.alias ? ` as ${quote(entry.alias.value)}` : '',
                    ],
                    entry.metadata,
                    level,
                );
            case 'ImageStatement':
                return this.annotated(['image ', quote(entry.source.value)], entry.metadata, level);
            case 'TickerStatement':
                return this.annotated(
                    ['ticker ', this.expression(entry.handler, 1, RUN)],
                    entry.metadata,
                    level,
                );
            case 'MacroStatement':
                return this.fit(
                    [
                        'macro ',
                        entry.name.name,
                        entry.parameters ? `(${entry.parameters.map(p => p.name).join(', ')})` : '',
                        ' = ',
                        this.statementValue(entry.body, true),
                    ],
                    level,
                );
            case 'ConfigStatement':
                return this.block('config', null, entry.entries, entry, level);
            case 'StyleStatement':
                return this.block(`style ${entry.name.name}`, null, entry.entries, entry, level);
            case 'FolderStatement':
                return this.block(
                    entry.title ? `folder ${quote(entry.title.value)}` : 'folder',
                    entry.metadata,
                    entry.body,
                    entry,
                    level,
                );
            case 'TableStatement':
                return this.block('table', entry.metadata, entry.columns, entry, level);
        }
    }

    /**
     * Whether inline metadata would read back as written. In `@ …` a comma
     * followed by a bare name is the start of a flag (spec §4.1), so a run with
     * a bare name after its first action - `onClick: A, B` - can only be
     * written in a block, where commas belong to the value.
     */
    private inlineSafe(metadata: ast.Metadata): boolean {
        return metadata.entries.every(
            property =>
                property.value?.kind !== 'Sequence' ||
                property.value.elements.slice(1).every(element => element.kind !== 'Identifier'),
        );
    }

    /**
     * A statement and its metadata: inline when it fits, or when there is only
     * the one property, which a block would spend two lines on and settle
     * nothing; a `@{ … }` block, one property to a line, otherwise - and
     * always when the metadata was written as one.
     */
    private annotated(head: Doc, metadata: ast.Metadata | null, level: number): string[] {
        if (!metadata) return this.fit([head], level);

        if (!metadata.block && this.inlineSafe(metadata)) {
            const inline: Doc[] = [
                head,
                ' @ ',
                join(
                    metadata.entries.map(p => this.property(p)),
                    ', ',
                ),
            ];
            if (metadata.entries.length < 2 || this.fits(this.indentOf(level) + flat(inline))) {
                return this.fit(inline, level);
            }
        }

        if (metadata.entries.length === 0 && !this.hasComments(metadata.span)) {
            return this.fit([head, ' @{}'], level);
        }
        // Properties written inline were separated by commas, not by the
        // author's choice of line, so a block made of them has one to a line.
        const { header, lines } = this.body(
            metadata.entries,
            metadata.span.start + 2,
            metadata.span.end - 1,
            level + 1,
            metadata.block,
        );
        const opening = this.fit([head, ' @{'], level);
        if (header) opening[opening.length - 1] += ` ${header}`;
        return [...opening, ...lines, `${this.indentOf(level)}}`];
    }

    /**
     * `config { … }`, `style name { … }`, `folder "Title" { … }`, `table { … }`.
     *
     * On one line - entries separated by `; ` - when the author wrote it on
     * one and it still fits; otherwise one entry to a line. A folder's or a
     * table's own metadata rides on the line of the `{`.
     */
    private block(
        keyword: string,
        metadata: ast.Metadata | null,
        entries: Entry[],
        node: Entry,
        level: number,
    ): string[] {
        const indent = this.indentOf(level);
        const open = this.openBrace(node);
        const close = node.span.end - 1;
        const bodyStart = metadata ? metadata.span.end : open + 1;
        const hasComments =
            this.source !== undefined && this.hasComments({ start: open, end: close });

        let own: string | null = null;
        if (metadata && this.inlineSafe(metadata)) {
            own = flat([
                '@ ',
                join(
                    metadata.entries.map(p => this.property(p)),
                    ', ',
                ),
            ]);
        }

        const oneLine =
            !hasComments &&
            (entries.length === 0 ||
                (this.source !== undefined && !this.source.slice(open, close).includes('\n')));
        if (oneLine && (!metadata || own !== null)) {
            const printed = entries.map(entry => this.entry(entry, level + 1));
            if (printed.every(lines => lines.length === 1)) {
                const inside = [
                    ...(own ? [own] : []),
                    ...printed.map(lines => lines[0].trimStart()),
                ];
                const line = `${indent}${keyword} ${inside.length ? `{ ${inside.join('; ')} }` : '{}'}`;
                if (this.fits(line)) return [line];
            }
        }

        // A folder's metadata that has to be a block is written as the parser
        // reads one: straight after the `{`, closed before the body starts.
        const opening =
            metadata && own === null
                ? this.annotated(`${keyword} {`, metadata, level)
                : [`${indent}${keyword} {${own ? ` ${own}` : ''}`];
        // A block that was on one line and no longer fits on it is laid out
        // one entry to a line, not in the runs of its old one line.
        const { header, lines } = this.body(entries, bodyStart, close, level + 1, !oneLine);
        if (header) opening[opening.length - 1] += ` ${header}`;
        return [...opening, ...lines, `${indent}}`];
    }

    /** Where a block statement's `{` is: the first one after its keyword. */
    private openBrace(node: Entry): number {
        const token = this.tokens.find(
            token =>
                token.span.start >= node.span.start &&
                token.text === '{' &&
                token.kind === 'punctuation',
        );
        return token ? token.span.start : -1;
    }

    /**
     * The entries of a block, or of the file, between two offsets, with the
     * comments and blank lines among them.
     *
     * A comment on a line of its own stays on one; a comment after an entry,
     * on its line, stays after it; a comment on the line the block opens on,
     * before any entry, is handed back as `header` for the caller to put
     * there. Entries the author wrote on one line separated by `;` stay on one
     * line if they still fit on it. A blank line, or a run of them, between
     * two things is one blank line; at the start or end of a block it is none.
     */
    body(
        entries: Entry[],
        start: number,
        end: number,
        level: number,
        keepRuns = true,
    ): { header?: string; lines: string[] } {
        const source = this.source;
        const indent = this.indentOf(level);

        const comments = this.comments.filter(
            comment =>
                comment.span.start >= start &&
                comment.span.end <= end &&
                !entries.some(entry => inside(comment.span, entry.span)),
        );
        const things = [
            ...entries.map(entry => ({ entry, span: entry.span })),
            ...comments.map(comment => ({ comment, span: comment.span })),
        ].sort((a, b) => a.span.start - b.span.start);

        const newlinesBetween = (from: number, to: number) =>
            source === undefined ? 1 : (source.slice(from, to).match(/\n/g) ?? []).length;

        let header: string | undefined;
        const items: (Item | { comment: string; blankBefore: boolean })[] = [];
        let previousEnd = start;
        for (const thing of things) {
            const newlines = newlinesBetween(previousEnd, thing.span.start);
            const blankBefore = items.length > 0 && newlines >= 2;
            const previous = items[items.length - 1];
            if ('comment' in thing && thing.comment) {
                const text = thing.comment.text.trimEnd();
                if (newlines === 0 && previous && 'entries' in previous && !previous.comment) {
                    previous.comment = text;
                } else if (newlines === 0 && !previous && start > 0) {
                    header = text;
                } else {
                    items.push({ comment: text, blankBefore });
                }
            } else if ('entry' in thing && thing.entry) {
                if (
                    keepRuns &&
                    newlines === 0 &&
                    previous &&
                    'entries' in previous &&
                    !previous.comment
                ) {
                    previous.entries.push(thing.entry);
                } else {
                    items.push({ entries: [thing.entry], blankBefore });
                }
            }
            previousEnd = thing.span.end;
        }

        const lines: string[] = [];
        for (const item of items) {
            if (item.blankBefore) lines.push('');
            if (!('entries' in item)) {
                lines.push(indent + item.comment);
                continue;
            }
            const printed = item.entries.map(entry => this.entry(entry, level));
            const joined = indent + printed.map(entry => entry[0].trimStart()).join('; ');
            const run =
                printed.length > 1 &&
                printed.every(entry => entry.length === 1) &&
                this.fits(joined)
                    ? [joined]
                    : printed.flat();
            if ('comment' in item && item.comment) run[run.length - 1] += ` ${item.comment}`;
            lines.push(...run);
        }
        return { header, lines: lines.map(line => line.trimEnd()) };
    }

    private hasComments(span: ast.Span): boolean {
        return this.comments.some(comment => inside(comment.span, span));
    }

    /**
     * Whether an entry holds a comment that no block inside it will place - one
     * inside a bracket spread over lines, say. There is no telling what such a
     * comment was about once the bracket is laid out again, so the entry is
     * kept as it was written instead.
     */
    private hasLooseComments(entry: Entry): boolean {
        const within = this.comments.filter(comment => inside(comment.span, entry.span));
        if (within.length === 0) return false;

        let placed: ast.Span | null = null;
        switch (entry.kind) {
            case 'FolderStatement':
            case 'TableStatement':
                placed = {
                    start: entry.metadata ? entry.metadata.span.end : this.openBrace(entry) + 1,
                    end: entry.span.end - 1,
                };
                break;
            case 'ConfigStatement':
            case 'StyleStatement':
                placed = { start: this.openBrace(entry) + 1, end: entry.span.end - 1 };
                break;
            case 'ExpressionStatement':
            case 'NoteStatement':
            case 'ImportStatement':
            case 'ImageStatement':
            case 'TickerStatement':
            case 'TableColumn':
                if (entry.metadata?.block) {
                    placed = {
                        start: entry.metadata.span.start + 2,
                        end: entry.metadata.span.end - 1,
                    };
                }
                break;
        }
        return within.some(comment => !placed || !inside(comment.span, placed));
    }

    /**
     * An entry exactly as written, moved to its new depth: every line after
     * the first loses the indentation the first had and takes the new one.
     */
    private verbatim(entry: Entry, level: number): string[] {
        const source = this.source ?? '';
        const lineStart = source.lastIndexOf('\n', entry.span.start - 1) + 1;
        const original = /^[ \t]*/.exec(source.slice(lineStart))?.[0] ?? '';
        const indent = this.indentOf(level);
        return source
            .slice(entry.span.start, entry.span.end)
            .split(/\r?\n/)
            .map((line, index) => {
                if (index === 0) return indent + line.trimEnd();
                if (line.trim() === '') return '';
                let at = 0;
                while (at < original.length && at < line.length && line[at] === original[at]) at++;
                return indent + line.slice(at).trimEnd();
            });
    }
}

const inside = (inner: ast.Span, outer: ast.Span) =>
    inner.start >= outer.start && inner.end <= outer.end;
