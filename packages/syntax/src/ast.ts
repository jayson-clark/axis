// ═════════════════════════════════════════════════════════════════════════════
// The Axis syntax tree
// ═════════════════════════════════════════════════════════════════════════════
//
// What the parser produces and everything after it reads: the checker, the
// compiler, the printer, the language service. It is the contract between them,
// and `docs/spec.md` is the prose it implements.
//
// A tree rather than text, because every tool used to rediscover the structure
// of a file for itself - with its own regexes, and its own disagreements. Now
// the parser finds it once, and every node carries the span it was read from,
// so a diagnostic, a source map entry or a write-back edit points at the exact
// characters without anybody counting lines again.
//
// The tree is *abstract*: it holds what a statement means, not its spelling.
// What makes the whole thing lossless is the token stream beside it
// (`SyntaxTree.tokens`), which keeps every comment and every space - the printer
// reads comments from there, by position, and writing a node back means
// replacing exactly the characters its span covers.

/**
 * A half-open range of UTF-16 offsets into the source: `[start, end)`.
 *
 * Offsets rather than lines and columns, because offsets survive being handed
 * between tools and lines are cheap to recover (`lineIndex`).
 */
export interface Span {
    start: number;
    end: number;
}

interface NodeBase {
    span: Span;
}

// ─────────────────────────────────────────────────────────────────────────────
// The file
// ─────────────────────────────────────────────────────────────────────────────

export interface File extends NodeBase {
    kind: 'File';
    statements: Statement[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Statements
// ─────────────────────────────────────────────────────────────────────────────

export type Statement =
    | ConfigStatement
    | FolderStatement
    | TableStatement
    | StyleStatement
    | MacroStatement
    | ImportStatement
    | ImageStatement
    | TickerStatement
    | NoteStatement
    | ExpressionStatement
    | ErrorStatement;

/** `config { showGrid: true; xmin: -7 }` */
export interface ConfigStatement extends NodeBase {
    kind: 'ConfigStatement';
    entries: Property[];
}

/**
 * `folder "Name" { @ collapsed … }`, or `folder { … }` with no title.
 *
 * `metadata` is the clause written straight after the `{`, which annotates the
 * folder rather than its first statement.
 */
export interface FolderStatement extends NodeBase {
    kind: 'FolderStatement';
    title: StringLiteral | null;
    metadata: Metadata | null;
    body: Statement[];
}

/** `table { @ color: RED; x = [1, 2, 3]; x ^ 2 }` */
export interface TableStatement extends NodeBase {
    kind: 'TableStatement';
    metadata: Metadata | null;
    columns: TableColumn[];
}

/**
 * One column of a table.
 *
 * `x = [1, 2, 3]` has a header `x` and three values; a bare `x ^ 2` is a
 * computed column, with `values` null. An empty list `x = []` is a column with
 * no values yet, which is not the same thing.
 */
export interface TableColumn extends NodeBase {
    kind: 'TableColumn';
    header: Expression;
    values: Expression[] | null;
    metadata: Metadata | null;
}

/** `style swatch { pointSize: 14; showLabel }` */
export interface StyleStatement extends NodeBase {
    kind: 'StyleStatement';
    name: Identifier;
    entries: Property[];
}

/**
 * `macro wave(k, phase) = sin(k * x + phase)`, or `macro TAU2 = 2tau`.
 *
 * `parameters` is null for the parameterless form and `[]` for `macro f() = …`,
 * which is used as `f()`.
 */
export interface MacroStatement extends NodeBase {
    kind: 'MacroStatement';
    name: Identifier;
    parameters: Identifier[] | null;
    body: Expression;
}

/** `import "./lib/waves" as "Waves" @ collapsed: false` */
export interface ImportStatement extends NodeBase {
    kind: 'ImportStatement';
    path: StringLiteral;
    alias: StringLiteral | null;
    metadata: Metadata | null;
}

/** `image "./beach.png" @ center: (0, 1), width: 10` */
export interface ImageStatement extends NodeBase {
    kind: 'ImageStatement';
    source: StringLiteral;
    metadata: Metadata | null;
}

/** `ticker n -> n + dt @ minStep: 50, playing` */
export interface TickerStatement extends NodeBase {
    kind: 'TickerStatement';
    handler: Expression;
    metadata: Metadata | null;
}

/** `"A note"` */
export interface NoteStatement extends NodeBase {
    kind: 'NoteStatement';
    text: StringLiteral;
    metadata: Metadata | null;
}

/** Any expression standing as a statement: a definition, an equation, a point. */
export interface ExpressionStatement extends NodeBase {
    kind: 'ExpressionStatement';
    expression: Expression;
    metadata: Metadata | null;
}

/**
 * What the parser could not read, skipped up to where it recovered.
 *
 * Kept in the tree rather than dropped, so a tool walking the statements still
 * knows something was there - the printer leaves its text alone, and the
 * source map knows the lines are spoken for.
 */
export interface ErrorStatement extends NodeBase {
    kind: 'ErrorStatement';
}

// ─────────────────────────────────────────────────────────────────────────────
// Properties
// ─────────────────────────────────────────────────────────────────────────────

/** `@ color: RED, hidden` or `@{ … }`. */
export interface Metadata extends NodeBase {
    kind: 'Metadata';
    /** Whether it was written as a `@{ … }` block rather than inline. */
    block: boolean;
    entries: Property[];
}

/**
 * `key: value`, or a bare `key` - a flag, meaning `true`.
 *
 * `value` is null for the bare form and for a `key:` whose value is missing,
 * which the parser reports; `colon` tells the two apart.
 */
export interface Property extends NodeBase {
    kind: 'Property';
    key: Identifier;
    colon: boolean;
    value: PropertyValue | null;
}

export type PropertyValue = Expression | Range;

/**
 * `lo..hi step s soft min`. Either end, and the step, may be absent.
 */
export interface Range extends NodeBase {
    kind: 'Range';
    min: Expression | null;
    max: Expression | null;
    step: Expression | null;
    /** Which ends the slider may be dragged past. `none` is the default: both hard. */
    soft: 'none' | 'both' | 'min' | 'max';
}

// ─────────────────────────────────────────────────────────────────────────────
// Expressions
// ─────────────────────────────────────────────────────────────────────────────

export type Expression =
    | NumberLiteral
    | Identifier
    | StringLiteral
    | ColorLiteral
    | Paren
    | Tuple
    | List
    | ListRange
    | Piecewise
    | Abs
    | Unary
    | Binary
    | Comparison
    | Call
    | Prime
    | BigOperator
    | Derivative
    | Index
    | Member
    | Factorial
    | Action
    | Sequence
    | With
    | For
    | Blank
    | ErrorExpression;

/** `3`, `0.5`, `1e-3` - the text as written, so nothing is lost to a float. */
export interface NumberLiteral extends NodeBase {
    kind: 'Number';
    value: string;
}

/**
 * A name as the author wrote it: `x`, `amp`, `x_1`, `theta2`.
 *
 * The compiler turns it into Desmos' spelling; the tree keeps the author's.
 */
export interface Identifier extends NodeBase {
    kind: 'Identifier';
    name: string;
}

/** A string, unescaped in `value`. */
export interface StringLiteral extends NodeBase {
    kind: 'String';
    value: string;
}

/** `#c74440` or `#fff`, including the `#`. */
export interface ColorLiteral extends NodeBase {
    kind: 'Color';
    value: string;
}

/**
 * `(e)` - kept so the printer writes the author's brackets back, and so the
 * emitter can keep a bracket Desmos would otherwise draw differently. The
 * emitter adds whatever brackets precedence needs on its own; it never relies
 * on these.
 */
export interface Paren extends NodeBase {
    kind: 'Paren';
    expression: Expression;
}

/** `(a, b)` - a point, or any tuple of two or more. */
export interface Tuple extends NodeBase {
    kind: 'Tuple';
    elements: Expression[];
}

/**
 * `[a, b, c]`, `[1...10]`, `[1, 3...9]`, `[f(i) for i = L]`.
 *
 * A comprehension is a list with one element, a `For`.
 */
export interface List extends NodeBase {
    kind: 'List';
    elements: Expression[];
}

/** `a...b` inside a list or an index. */
export interface ListRange extends NodeBase {
    kind: 'ListRange';
    /**
     * Either end may be left off in an index, where it means the start or the
     * end of the list: `L[2...]`, `L[...3]` (spec §5.2). Anywhere else the
     * checker reports it.
     */
    from: Expression | null;
    to: Expression | null;
}

/**
 * `{x < 0: -x, x}` or `{x > 0}`.
 *
 * A branch with a null `value` is a bare condition: a restriction when it is
 * the only one. `otherwise` is the trailing value with no condition.
 */
export interface Piecewise extends NodeBase {
    kind: 'Piecewise';
    branches: PiecewiseBranch[];
    otherwise: Expression | null;
}

export interface PiecewiseBranch extends NodeBase {
    kind: 'PiecewiseBranch';
    condition: Expression;
    value: Expression | null;
}

/** `|e|` */
export interface Abs extends NodeBase {
    kind: 'Abs';
    expression: Expression;
}

export interface Unary extends NodeBase {
    kind: 'Unary';
    operator: '-' | '+';
    operand: Expression;
}

/**
 * `a + b`, `a * b`, `a / b`, `a ^ b`, and `2x` - juxtaposition, which binds
 * exactly as `*` does and is kept apart only so the printer can write it back
 * the way it was written.
 */
export interface Binary extends NodeBase {
    kind: 'Binary';
    operator: '+' | '-' | '*' | '/' | '^' | 'implicit';
    left: Expression;
    right: Expression;
}

/** `~` is a regression: fit the right side's parameters to the left (§5.5). */
export type ComparisonOperator = '=' | '<' | '<=' | '>' | '>=' | '~';

/**
 * `y = x`, `f(x) = x^2`, `1 < x < 2`.
 *
 * A chain holds one more operand than it has operators. Whether an `=` defines
 * something or states an equation is the checker's decision, not the parser's.
 */
export interface Comparison extends NodeBase {
    kind: 'Comparison';
    operands: Expression[];
    operators: ComparisonOperator[];
}

/**
 * `f(a, b)` - a call, or a product the checker will say is one.
 *
 * Only an identifier is callable. `callee` is kept as the node, so its span is
 * there for a diagnostic.
 */
export interface Call extends NodeBase {
    kind: 'Call';
    callee: Identifier;
    arguments: Expression[];
}

/**
 * `f'(x)`, `f''(x)`: a derivative of a function, taken by Desmos. `order` is
 * the number of primes.
 */
export interface Prime extends NodeBase {
    kind: 'Prime';
    callee: Identifier;
    order: number;
    arguments: Expression[];
}

/**
 * `sum(n = 1..10, f(n))`, `prod(n = 1..10, n)`, `int(t = 0..1, f(t))`.
 *
 * `name` is the word as written, kept for its span. `variable` is bound in the
 * body and nowhere else - not in either bound, as in Desmos.
 */
export interface BigOperator extends NodeBase {
    kind: 'BigOperator';
    operator: 'sum' | 'prod' | 'int';
    name: Identifier;
    variable: Identifier;
    from: Expression;
    to: Expression;
    body: Expression;
}

/**
 * `d/dx f(x)`: the derivative of `body` with respect to `variable`. The body
 * is a product, as `-` takes one: `d/dx x^2 + 1` is the derivative plus 1.
 * `variable` is spanned over the `x` of `dx`.
 */
export interface Derivative extends NodeBase {
    kind: 'Derivative';
    variable: Identifier;
    body: Expression;
}

/** `L[1]`, `L[2...5]`, `L[L > 2]` */
export interface Index extends NodeBase {
    kind: 'Index';
    target: Expression;
    index: Expression;
}

/** `P.x`, `L.count`, and called: `D.cdf(1)`, `L.quantile(0.5)` */
export interface Member extends NodeBase {
    kind: 'Member';
    target: Expression;
    name: Identifier;
    /** The arguments of a member that is called; absent for one that is not. */
    arguments?: Expression[];
}

/** `n!` */
export interface Factorial extends NodeBase {
    kind: 'Factorial';
    operand: Expression;
}

/** `a -> a + 1` */
export interface Action extends NodeBase {
    kind: 'Action';
    target: Expression;
    value: Expression;
}

/**
 * A comma-separated run at the top of a value: `a -> 1, b -> 2`, or `A, B` where
 * both name actions. Only where the grammar allows a run - a statement's value,
 * a ticker's handler, an `action` property.
 */
export interface Sequence extends NodeBase {
    kind: 'Sequence';
    elements: Expression[];
}

/**
 * `name = value`, as `with` and `for` take them - or, after a `with` only,
 * `f(1) = value`: a case of the function being defined, which is how Desmos
 * writes the base of a recursion (spec §5.5).
 */
export interface Binding extends NodeBase {
    kind: 'Binding';
    name: Identifier;
    /** The arguments of a function case, `f(1) = 1`; absent on a plain binding. */
    arguments?: Expression[];
    value: Expression;
}

/** `body with a = 1, b = 2` */
export interface With extends NodeBase {
    kind: 'With';
    body: Expression;
    bindings: Binding[];
}

/** `body for i = [1...10], j = L` */
export interface For extends NodeBase {
    kind: 'For';
    body: Expression;
    bindings: Binding[];
}

/** Where an expression should have been and was not, already reported. */
export interface ErrorExpression extends NodeBase {
    kind: 'ErrorExpression';
}

/**
 * The empty slot in `[4, , 6]`: a table cell left blank (spec §3.2). The
 * parser reads one in any list, and the checker allows it only in a table
 * column's values.
 */
export interface Blank extends NodeBase {
    kind: 'Blank';
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostics
// ─────────────────────────────────────────────────────────────────────────────

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/**
 * One problem, from any stage. The parser, the checker and the compiler all
 * produce this, so an editor shows exactly what a compile would report.
 *
 * `code` is stable, so tests and editors can match a rule rather than its
 * wording. `path` is set once a diagnostic is known to belong to a file other
 * than the one being compiled - an import's.
 */
export interface Diagnostic<Code extends string = string> {
    code: Code;
    severity: DiagnosticSeverity;
    message: string;
    span: Span;
    path?: string;
}
