// ═════════════════════════════════════════════════════════════════════════════
// The parser
// ═════════════════════════════════════════════════════════════════════════════
//
// Tokens in, the syntax tree of `ast.ts` out. Statements and blocks are read by
// recursive descent; expressions by precedence climbing over the table in spec
// §5.1, one function per level, loosest first:
//
//   parseTop          with / for                       (1)
//   parseRun          a -> 1, b -> 2                   (2)
//   parseAction       target -> value                  (3)
//   parseComparison   = < <= > >=, chained             (4)
//   parseAdditive     + -                              (5)
//   parseMultiplicative  * / and juxtaposition         (6)
//   parseUnary        prefix - +, d/dx                 (7)
//   parsePower        ^, right-associative             (8)
//   parsePostfix      f(…) f'(…) L[…] P.x n!           (9)
//   parseAtom                                          (10)
//
// The parser is purely syntactic. Whether a property exists, whether a folder
// may sit inside another, whether `a(b)` is a call or a product - all of that is
// the checker's, which reads this tree. What the parser promises is that it
// always returns one: it never throws, it reports what it could not read as a
// diagnostic, keeps going from the next statement, and leaves an
// `ErrorStatement` or `ErrorExpression` where the unreadable part was, so every
// tool after it still sees the rest of the file.

import type * as ast from './ast';
import type { SyntaxDiagnosticCode } from './diagnostics';
import { lex, unescapeString } from './lexer';
import { isTrivia, type Token } from './tokens';

/** Everything the parser read from one source: the tree, and the tokens beside it. */
export interface SyntaxTree {
    source: string;
    /** Every token, trivia included - the lossless half of the tree. */
    tokens: Token[];
    file: ast.File;
    /** The lexer's diagnostics and the parser's, in source order. */
    diagnostics: ast.Diagnostic<SyntaxDiagnosticCode>[];
}

export function parse(source: string): SyntaxTree {
    const { tokens, diagnostics } = lex(source);
    const parser = new Parser(tokens, diagnostics);
    const file = parser.parseFile();
    return { source, tokens, file, diagnostics: parser.finish() };
}

/**
 * Parse a lone expression, as a statement's value would be read - action runs
 * allowed. For tools that hold an expression rather than a file: an evaluator,
 * a test, a completion that wants to know what is to the left of the cursor.
 */
export function parseExpression(source: string): {
    expression: ast.Expression;
    tokens: Token[];
    diagnostics: ast.Diagnostic<SyntaxDiagnosticCode>[];
} {
    const { tokens, diagnostics } = lex(source);
    const parser = new Parser(tokens, diagnostics);
    const expression = parser.parseLoneExpression();
    return { expression, tokens, diagnostics: parser.finish() };
}

/**
 * What newlines, commas and bars mean at the current point.
 *
 * `newlines`: whether a newline is skipped, as it is inside a bracket, or ends
 * the statement, as it does everywhere else.
 *
 * `commaRule`: whether we are in the value of an inline `@ …` property, where a
 * comma starts the next property only when the next property is plainly what
 * follows (spec §4.1).
 *
 * `inAbs`: whether a `|` closes an absolute value rather than opening a new one
 * as a juxtaposed operand.
 */
interface Context {
    newlines: boolean;
    commaRule: boolean;
    inAbs: boolean;
}

const COMPARISON_OPERATORS: ReadonlySet<string> = new Set(['=', '<', '<=', '>', '>=', '~']);
const OPENERS: ReadonlySet<string> = new Set(['(', '[', '{', '@{']);
const MATCHING_OPENERS: Readonly<Record<string, readonly string[]>> = {
    ')': ['('],
    ']': ['['],
    '}': ['{', '@{'],
};

/** The words that open a `BigOperator` when a bracket follows them. */
const BIG_OPERATORS: ReadonlySet<string> = new Set(['sum', 'prod', 'int']);

/** What each one does to its body, for a message. */
const VERBS: Record<ast.BigOperator['operator'], string> = {
    sum: 'sum',
    prod: 'multiply',
    int: 'integrate',
};

class Parser {
    /** The tokens that mean something: trivia is dropped, newlines are kept. */
    private readonly tokens: Token[];
    /**
     * For each opening bracket, the index of the bracket that closes it, or -1
     * if nothing does; -2 for every other token.
     */
    private readonly closers: number[];
    private pos = 0;
    /** The end of the last token consumed, which is where a node ends. */
    private lastEnd = 0;
    /** The last token consumed, newlines stepped over not counted. */
    private lastToken: Token | null = null;
    private readonly contexts: Context[] = [{ newlines: false, commaRule: false, inAbs: false }];
    /** How many blocks we are inside, so recovery knows a `}` is not its to skip. */
    private blockDepth = 0;
    private readonly diagnostics: ast.Diagnostic<SyntaxDiagnosticCode>[];

    constructor(tokens: Token[], diagnostics: ast.Diagnostic<SyntaxDiagnosticCode>[]) {
        this.tokens = tokens.filter(token => !isTrivia(token));
        this.diagnostics = [...diagnostics];
        this.closers = matchBrackets(this.tokens);
    }

    finish(): ast.Diagnostic<SyntaxDiagnosticCode>[] {
        return this.diagnostics.sort((a, b) => a.span.start - b.span.start);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tokens
    // ─────────────────────────────────────────────────────────────────────────

    private get context(): Context {
        return this.contexts[this.contexts.length - 1];
    }

    /**
     * The next token. Where newlines mean nothing it steps over them for good:
     * they are inside a bracket, and nothing outside it will want them back.
     */
    private peek(): Token {
        if (this.context.newlines) {
            while (this.tokens[this.pos].kind === 'newline') this.pos++;
        }
        return this.tokens[this.pos];
    }

    /** The token `n` ahead, skipping newlines where the context says they mean nothing. */
    private peekAt(n: number): Token {
        let i = this.pos;
        for (let k = 0; ; k++) {
            if (this.context.newlines) {
                while (this.tokens[i].kind === 'newline') i++;
            }
            if (k === n || this.tokens[i].kind === 'eof') return this.tokens[i];
            i++;
        }
    }

    private next(): Token {
        const token = this.peek();
        if (token.kind !== 'eof') this.pos++;
        this.lastEnd = token.span.end;
        this.lastToken = token;
        return token;
    }

    /** Whether the next token is this punctuation or keyword. */
    private at(text: string, token = this.peek()): boolean {
        return (token.kind === 'punctuation' || token.kind === 'keyword') && token.text === text;
    }

    /** Whether a token ends a statement: a newline, a `;`, or the end of the file. */
    private isSeparator(token = this.peek()): boolean {
        return token.kind === 'newline' || token.kind === 'eof' || this.at(';', token);
    }

    /** Whether a token ends the entry it follows: a separator, or the `}` of the block. */
    private isEntryEnd(token = this.peek()): boolean {
        return this.isSeparator(token) || this.at('}', token);
    }

    private skipSeparators(): void {
        while (this.peek().kind === 'newline' || this.at(';')) this.next();
    }

    private startOf(): number {
        return this.peek().span.start;
    }

    private span(start: number): ast.Span {
        return { start, end: Math.max(start, this.lastEnd) };
    }

    private withContext<T>(context: Partial<Context>, read: () => T): T {
        this.contexts.push({ ...this.context, ...context });
        try {
            return read();
        } finally {
            this.contexts.pop();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Diagnostics and recovery
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Report a problem - once. A token the lexer already complained about, or
     * one an inner rule reported before giving up, is not reported again by the
     * rule that finds it next.
     */
    private error(code: SyntaxDiagnosticCode, message: string, span: ast.Span): void {
        if (this.diagnostics.some(d => d.span.start === span.start)) return;
        this.diagnostics.push({ code, severity: 'error', message, span });
    }

    /** Where a missing thing should have been: the token that is there instead. */
    private missingSpan(): ast.Span {
        const token = this.peek();
        // A newline or the end of the file is not "there" in any visible way,
        // so point at the end of what came before it.
        if (token.kind === 'newline' || token.kind === 'eof') {
            return { start: this.lastEnd, end: this.lastEnd };
        }
        return token.span;
    }

    private unexpected(): void {
        const token = this.peek();
        this.error('unexpected-token', `Unexpected ${describe(token)}`, this.missingSpan());
    }

    /**
     * Skip what is left of a statement: up to the next newline or `;`, or the
     * `}` closing the block we are in. Braces opened on the way are skipped as
     * a whole, so the `}` of a bad `{ … }` does not close the enclosing block.
     */
    private skipStatement(): void {
        let depth = 0;
        for (;;) {
            const token = this.peek();
            if (token.kind === 'eof' || token.kind === 'newline') return;
            if (depth === 0 && this.at(';', token)) return;
            if (this.at('}', token)) {
                if (depth > 0) depth--;
                else if (this.blockDepth > 0) return;
            } else if (this.at('{', token) || this.at('@{', token)) {
                depth++;
            }
            this.next();
        }
    }

    /** Report the token in the way, skip the rest of the statement, and keep its place. */
    private recoverStatement(start = this.startOf()): ast.ErrorStatement {
        this.unexpected();
        this.skipStatement();
        return { kind: 'ErrorStatement', span: this.span(start) };
    }

    /** Give up on a statement already begun: its diagnostic is reported, its text kept. */
    private abandonStatement(start: number): ast.ErrorStatement {
        this.skipStatement();
        return { kind: 'ErrorStatement', span: this.span(start) };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Statements
    // ─────────────────────────────────────────────────────────────────────────

    parseFile(): ast.File {
        const statements = this.parseStatements();
        return { kind: 'File', statements, span: { start: 0, end: this.peek().span.end } };
    }

    parseLoneExpression(): ast.Expression {
        this.skipSeparators();
        const expression = this.canStartExpression()
            ? this.parseStatementValue(true)
            : this.errorExpression('Expected an expression');
        this.skipSeparators();
        if (this.peek().kind !== 'eof') this.unexpected();
        return expression;
    }

    /** Statements up to the end of the file, or the `}` of the block we are in. */
    private parseStatements(): ast.Statement[] {
        const statements: ast.Statement[] = [];
        for (;;) {
            this.skipSeparators();
            const token = this.peek();
            if (token.kind === 'eof' || (this.blockDepth > 0 && this.at('}'))) break;

            statements.push(this.parseStatement());

            // Something left on the line after a whole statement is its own
            // error, not a reason to throw the good statement away.
            if (!this.isSeparator() && !(this.blockDepth > 0 && this.at('}'))) {
                statements.push(this.recoverStatement());
            }
        }
        return statements;
    }

    private parseStatement(): ast.Statement {
        const token = this.peek();

        if (token.kind === 'keyword') {
            switch (token.text) {
                case 'config':
                    return this.parseConfig();
                case 'folder':
                    return this.parseFolder();
                case 'table':
                    return this.parseTable();
                case 'style':
                    return this.parseStyle();
                case 'macro':
                    return this.parseMacro();
                case 'import':
                    return this.parseImport();
                case 'image':
                    return this.parseImage();
                case 'ticker':
                    return this.parseTicker();
            }
        }

        // A string on its own is a note; a string with more expression after it
        // is an expression that happens to start with one.
        if (token.kind === 'string') {
            const after = this.peekAt(1);
            if (this.isEntryEnd(after) || this.at('@', after) || this.at('@{', after)) {
                const start = this.startOf();
                const text = this.parseString();
                const metadata = this.parseMetadata();
                return { kind: 'NoteStatement', text, metadata, span: this.span(start) };
            }
        }

        // Metadata with nothing to annotate: most often a folder's, written on
        // the line after its `{` rather than straight after it.
        if (this.at('@') || this.at('@{')) {
            this.error(
                'misplaced-metadata',
                'Metadata trails the statement it annotates; a block takes its own straight after the `{`, on the same line',
                token.span,
            );
            // Read it all the same, so a `@{ … }` over several lines is skipped
            // as one thing rather than read line by line as statements.
            const start = this.startOf();
            this.parseMetadata();
            return { kind: 'ErrorStatement', span: this.span(start) };
        }

        if (this.canStartExpression(token)) {
            const start = this.startOf();
            const expression = this.parseStatementValue(true);
            const metadata = this.parseMetadata();
            return { kind: 'ExpressionStatement', expression, metadata, span: this.span(start) };
        }

        return this.recoverStatement();
    }

    /** `config { … }` */
    private parseConfig(): ast.Statement {
        const start = this.startOf();
        this.next();
        const entries = this.parseBlock(() => this.parseProperties());
        if (!entries) return this.abandonStatement(start);
        return { kind: 'ConfigStatement', entries: entries.body, span: this.span(start) };
    }

    /** `folder "Title" { @ meta … }`, or `folder { … }` untitled. */
    private parseFolder(): ast.Statement {
        const start = this.startOf();
        this.next();
        const title = this.peek().kind === 'string' ? this.parseString() : null;
        const block = this.parseBlock(() => this.parseStatements(), true);
        if (!block) return this.abandonStatement(start);
        return {
            kind: 'FolderStatement',
            title,
            metadata: block.metadata,
            body: block.body,
            span: this.span(start),
        };
    }

    /** `table { @ meta; x = [1, 2]; x ^ 2 }` */
    private parseTable(): ast.Statement {
        const start = this.startOf();
        this.next();
        const block = this.parseBlock(() => this.parseColumns(), true);
        if (!block) return this.abandonStatement(start);
        return {
            kind: 'TableStatement',
            metadata: block.metadata,
            columns: block.body,
            span: this.span(start),
        };
    }

    /** `style name { … }` */
    private parseStyle(): ast.Statement {
        const start = this.startOf();
        this.next();
        const name = this.parseIdentifier('Expected a name for the style');
        const block = this.parseBlock(() => this.parseProperties());
        if (!block) return this.abandonStatement(start);
        return { kind: 'StyleStatement', name, entries: block.body, span: this.span(start) };
    }

    /** `macro name(a, b) = body`, or `macro NAME = body`. */
    private parseMacro(): ast.Statement {
        const start = this.startOf();
        this.next();
        if (this.peek().kind !== 'identifier') {
            this.error('expected-identifier', 'Expected a name for the macro', this.missingSpan());
            return this.abandonStatement(start);
        }
        const name = this.parseIdentifier();

        let parameters: ast.Identifier[] | null = null;
        if (this.at('(')) {
            parameters = this.parseBracket(')', () => {
                const list: ast.Identifier[] = [];
                if (this.at(')')) return list;
                for (;;) {
                    if (this.peek().kind !== 'identifier') {
                        this.error(
                            'expected-identifier',
                            'Expected a parameter name',
                            this.missingSpan(),
                        );
                        break;
                    }
                    list.push(this.parseIdentifier());
                    if (!this.at(',')) break;
                    this.next();
                }
                return list;
            }).value;
        }

        if (!this.at('=')) {
            this.error('expected-equals', 'Expected `=` and the macro body', this.missingSpan());
            return this.abandonStatement(start);
        }
        this.next();

        const body = this.canStartExpression()
            ? this.parseStatementValue(true)
            : this.errorExpression('Expected the macro body');
        return { kind: 'MacroStatement', name, parameters, body, span: this.span(start) };
    }

    /** `import "./path" as "Title" @ meta` */
    private parseImport(): ast.Statement {
        const start = this.startOf();
        this.next();
        if (this.peek().kind !== 'string') {
            this.error(
                'expected-string',
                'Expected the path to import, in quotes',
                this.missingSpan(),
            );
            return this.abandonStatement(start);
        }
        const path = this.parseString();

        let alias: ast.StringLiteral | null = null;
        if (this.at('as')) {
            this.next();
            if (this.peek().kind === 'string') {
                alias = this.parseString();
            } else {
                this.error(
                    'expected-string',
                    'Expected a folder title after `as`, in quotes',
                    this.missingSpan(),
                );
            }
        }

        const metadata = this.parseMetadata();
        return { kind: 'ImportStatement', path, alias, metadata, span: this.span(start) };
    }

    /** `image "./beach.png" @ meta` */
    private parseImage(): ast.Statement {
        const start = this.startOf();
        this.next();
        if (this.peek().kind !== 'string') {
            this.error(
                'expected-string',
                'Expected the image: a path, a URL or a data URI, in quotes',
                this.missingSpan(),
            );
            return this.abandonStatement(start);
        }
        const source = this.parseString();
        const metadata = this.parseMetadata();
        return { kind: 'ImageStatement', source, metadata, span: this.span(start) };
    }

    /** `ticker n -> n + dt @ meta` */
    private parseTicker(): ast.Statement {
        const start = this.startOf();
        this.next();
        const handler = this.parseTopOrError(true);
        const metadata = this.parseMetadata();
        return { kind: 'TickerStatement', handler, metadata, span: this.span(start) };
    }

    /**
     * `{ … }` after a block keyword, with `body` reading what is inside.
     *
     * A metadata clause straight after the `{`, before anything has separated
     * it from the brace, belongs to the block itself (spec §3.2), and only the
     * blocks that take one ask for it. Returns null, reported, when there is no
     * `{` at all.
     */
    private parseBlock<T>(
        body: () => T,
        metadata = false,
    ): { body: T; metadata: ast.Metadata | null } | null {
        if (!this.at('{')) {
            this.error('expected-block', 'Expected `{` to open the block', this.missingSpan());
            return null;
        }
        const open = this.pos;
        const brace = this.next();

        this.blockDepth++;
        const result = this.withContext({ newlines: false, commaRule: false, inAbs: false }, () => {
            const own = metadata ? this.parseMetadata() : null;
            return { metadata: own, body: body() };
        });
        this.blockDepth--;

        this.closeBlock(open, brace);
        return result;
    }

    private closeBlock(open: number, brace: Token): void {
        if (this.at('}')) {
            this.next();
            return;
        }
        // The block's contents stopped short of the `}` that the bracket
        // matching found for it: skip what is in between, reported once.
        if (this.closers[open] >= 0) {
            this.unexpected();
            this.skipTo(this.closers[open]);
            this.next();
            return;
        }
        this.error('unclosed-block', `\`${brace.text}\` is never closed`, brace.span);
    }

    /** The columns of a table, up to its `}`. */
    private parseColumns(): ast.TableColumn[] {
        const columns: ast.TableColumn[] = [];
        for (;;) {
            this.skipSeparators();
            if (this.peek().kind === 'eof' || this.at('}')) break;

            if (!this.canStartExpression()) {
                this.unexpected();
                this.skipStatement();
                continue;
            }

            const start = this.startOf();
            const expression = this.parseStatementValue(false);
            const metadata = this.parseMetadata();

            // `x = [1, 2, 3]` is a header and its values. Anything else is a
            // computed column, whole, and the checker says whether it is one.
            let header = expression;
            let values: ast.Expression[] | null = null;
            if (
                expression.kind === 'Comparison' &&
                expression.operators.length === 1 &&
                expression.operators[0] === '=' &&
                expression.operands[1].kind === 'List'
            ) {
                header = expression.operands[0];
                values = expression.operands[1].elements;
            }
            columns.push({ kind: 'TableColumn', header, values, metadata, span: this.span(start) });

            if (!this.isEntryEnd()) {
                this.unexpected();
                this.skipStatement();
            }
        }
        return columns;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Properties and metadata
    // ─────────────────────────────────────────────────────────────────────────

    /** `@ …` or `@{ … }` trailing a statement, if there is one. */
    private parseMetadata(): ast.Metadata | null {
        if (this.at('@')) return this.parseInlineMetadata();
        if (this.at('@{')) return this.parseBlockMetadata();
        return null;
    }

    /** `@ key: value, flag, key: value` - properties to the end of the statement. */
    private parseInlineMetadata(): ast.Metadata {
        const start = this.startOf();
        this.next();
        const entries: ast.Property[] = [];
        this.withContext({ commaRule: true }, () => {
            for (;;) {
                const property = this.parseProperty();
                if (!property) break;
                entries.push(property);
                if (!this.at(',')) break;
                this.next();
            }
        });
        return { kind: 'Metadata', block: false, entries, span: this.span(start) };
    }

    /** `@{ … }` - properties separated as a block's are. */
    private parseBlockMetadata(): ast.Metadata {
        const start = this.startOf();
        const open = this.pos;
        const brace = this.next();

        this.blockDepth++;
        const entries = this.withContext({ newlines: false, commaRule: false, inAbs: false }, () =>
            this.parseProperties(),
        );
        this.blockDepth--;

        this.closeBlock(open, brace);
        return { kind: 'Metadata', block: true, entries, span: this.span(start) };
    }

    /** The entries of a `config`, `style` or `@{ … }` block, up to its `}`. */
    private parseProperties(): ast.Property[] {
        const entries: ast.Property[] = [];
        for (;;) {
            this.skipSeparators();
            if (this.peek().kind === 'eof' || this.at('}')) break;

            const property = this.parseProperty();
            if (!property) {
                this.skipStatement();
                continue;
            }
            entries.push(property);

            // A comma between entries is the v1 habit, and never right in a
            // block: say so, and carry on as if it had been a `;`.
            if (this.at(',')) {
                this.error(
                    'comma-between-properties',
                    'Separate the entries of a block with `;` or a newline, not a comma',
                    this.peek().span,
                );
                this.next();
                continue;
            }
            if (!this.isEntryEnd()) {
                this.unexpected();
                this.skipStatement();
            }
        }
        return entries;
    }

    /** `key: value`, `key` alone (a flag), or null - reported - when there is no key. */
    private parseProperty(): ast.Property | null {
        const token = this.peek();
        if (token.kind !== 'identifier') {
            this.error(
                'expected-property',
                `Expected a property name, found ${describe(token)}`,
                this.missingSpan(),
            );
            return null;
        }
        const start = this.startOf();
        const key = this.parseIdentifier();

        if (this.at(':')) {
            this.next();
            if (this.at('..') || this.canStartExpression()) {
                const value = this.parsePropertyValue();
                return { kind: 'Property', key, colon: true, value, span: this.span(start) };
            }
            this.error('expected-value', `\`${key.name}\` needs a value`, this.span(start));
            return { kind: 'Property', key, colon: true, value: null, span: this.span(start) };
        }

        if (!this.isEntryEnd() && !this.at(',')) {
            this.error(
                'expected-colon',
                `Expected \`:\` after \`${key.name}\`, or a comma if it is a flag`,
                this.missingSpan(),
            );
            // Skip the value that was probably meant, to the next entry.
            while (!this.isEntryEnd() && !(this.context.commaRule && this.at(','))) this.next();
        }
        return { kind: 'Property', key, colon: false, value: null, span: this.span(start) };
    }

    /** An expression, or a range `lo..hi step s soft min` (spec §4.4). */
    private parsePropertyValue(): ast.PropertyValue {
        const start = this.startOf();
        const min = this.at('..') ? null : this.parseTop(true);
        if (!this.at('..')) return min as ast.Expression;
        this.next();

        const max = this.canStartExpression() ? this.parseComparison() : null;

        let step: ast.Expression | null = null;
        if (this.at('step')) {
            this.next();
            step = this.canStartExpression()
                ? this.parseComparison()
                : this.errorExpression('Expected the step after `step`');
        }

        let soft: ast.Range['soft'] = 'none';
        if (this.at('soft')) {
            this.next();
            soft = 'both';
            // `min` and `max` are words only here, so they are read by text
            // rather than being keywords everywhere.
            const end = this.peek();
            if (end.kind === 'identifier' && (end.text === 'min' || end.text === 'max')) {
                this.next();
                soft = end.text;
            }
        }

        return { kind: 'Range', min, max, step, soft, span: this.span(start) };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Expressions
    // ─────────────────────────────────────────────────────────────────────────

    /** Whether a token can begin an expression. */
    private canStartExpression(token = this.peek()): boolean {
        switch (token.kind) {
            case 'number':
            case 'identifier':
            case 'string':
            case 'color':
            case 'error':
                return true;
            case 'punctuation':
                return ['(', '[', '{', '|', '-', '+'].includes(token.text);
            default:
                return false;
        }
    }

    /**
     * Whether a token juxtaposed with the operand before it multiplies it:
     * `2x`, `3cos(t)`, `(a)(b)`, `x^2 {x > 0}`, `2|x|`. Never a sign - `a -b`
     * is a subtraction - and never a `[`, which indexes the operand before it.
     */
    private canStartImplicitOperand(token = this.peek()): boolean {
        if (token.kind === 'number' || token.kind === 'identifier') return true;
        if (token.kind !== 'punctuation') return false;
        if (token.text === '|') return !this.context.inAbs;
        return token.text === '(' || token.text === '{';
    }

    /**
     * Whether the comma ahead ends the value it follows rather than continuing
     * it (spec §4.1). `ident :` can only ever start a property, so it ends a
     * value anywhere; in inline metadata, a bare identifier that ends there too
     * is a flag.
     */
    private commaEndsValue(): boolean {
        const first = this.peekAt(1);
        const second = this.peekAt(2);
        if (first.kind !== 'identifier') return false;
        if (this.at(':', second)) return true;
        return this.context.commaRule && (this.isEntryEnd(second) || this.at(',', second));
    }

    private parseTopOrError(allowRun: boolean): ast.Expression {
        return this.canStartExpression()
            ? this.parseTop(allowRun)
            : this.errorExpression('Expected an expression');
    }

    /**
     * The value of a statement: an expression statement's, a macro's body, a
     * table column.
     *
     * The one place `=` binds more loosely than anything else. A definition's
     * right-hand side runs to the end of the statement at the loosest level
     * there is, so `R = a -> 1, b -> 2` names the whole run, `R = a -> 1` the
     * action, and `f(x) = x n with n = 3` substitutes into the body rather than
     * into the definition (spec §5.5). Anywhere else - a chain, or a comparison
     * inside a bracket - `=` keeps its place in the table.
     */
    private parseStatementValue(allowRun: boolean): ast.Expression {
        const left = this.parseAdditive();
        if (!this.at('=')) return this.parseTop(allowRun, left);
        this.next();
        const right = this.parseOperand(() => this.parseTop(allowRun));
        return {
            kind: 'Comparison',
            operands: [left, right],
            operators: ['='],
            span: this.span(left.span.start),
        };
    }

    /**
     * Level 1: `body with a = 1, b = 2`, `body for i = L`.
     *
     * `left`, here and in the levels below, is an operand already read by a
     * caller that had to look past it before knowing what it was part of.
     */
    private parseTop(allowRun: boolean, left?: ast.Expression): ast.Expression {
        const start = left?.span.start ?? this.startOf();
        let body = allowRun ? this.parseRun(left) : this.parseAction(left);
        while (this.at('with') || this.at('for')) {
            const keyword = this.next().text;
            const bindings = this.parseBindings(keyword === 'with');
            body =
                keyword === 'with'
                    ? { kind: 'With', body, bindings, span: this.span(start) }
                    : { kind: 'For', body, bindings, span: this.span(start) };
        }
        return body;
    }

    /**
     * `a = 1, b = 2` after `with` or `for`: to the end of the bracket or
     * statement. After a `with`, a binding can also be a case of a function,
     * `f(1) = 1` - a recursion's base, as Desmos writes one.
     */
    private parseBindings(cases: boolean): ast.Binding[] {
        const bindings: ast.Binding[] = [];
        for (;;) {
            const call = cases && this.caseAhead();
            if (!call && (this.peek().kind !== 'identifier' || !this.at('=', this.peekAt(1)))) {
                this.error(
                    'expected-binding',
                    cases
                        ? 'Expected a binding: `name = value`, or a case such as `f(1) = value`'
                        : 'Expected a binding: `name = value`',
                    this.missingSpan(),
                );
                break;
            }
            const start = this.startOf();
            const name = this.parseIdentifier();
            const args = call
                ? this.parseBracket(')', () => this.parseElements(')')).value
                : undefined;
            this.next();
            const value = this.canStartExpression()
                ? this.parseComparison()
                : this.errorExpression('Expected a value to bind');
            bindings.push(
                args
                    ? { kind: 'Binding', name, arguments: args, value, span: this.span(start) }
                    : { kind: 'Binding', name, value, span: this.span(start) },
            );

            if (!this.at(',') || this.commaEndsValue()) break;
            this.next();
        }
        return bindings;
    }

    /**
     * Whether a function case, `f(…) =`, is next: a name, a bracket straight
     * after it, and an `=` once the bracket closes.
     */
    private caseAhead(): boolean {
        if (this.peek().kind !== 'identifier' || !this.at('(', this.peekAt(1))) return false;
        let depth = 0;
        for (let n = 1; ; n++) {
            const token = this.peekAt(n);
            if (token.kind === 'eof') return false;
            if (this.at('(', token) || this.at('[', token) || this.at('{', token)) depth++;
            if (this.at(')', token) || this.at(']', token) || this.at('}', token)) {
                if (--depth === 0) return this.at('=', this.peekAt(n + 1));
            }
        }
    }

    /** Level 2: an action run, `a -> 1, b -> 2`, or a run of names, `A, B`. */
    private parseRun(left?: ast.Expression): ast.Expression {
        const first = this.parseAction(left);
        if (!this.at(',') || this.commaEndsValue()) return first;

        const elements = [first];
        while (this.at(',') && !this.commaEndsValue()) {
            this.next();
            elements.push(this.parseAction());
        }
        return { kind: 'Sequence', elements, span: this.span(first.span.start) };
    }

    /** Level 3: `target -> value`. */
    private parseAction(left?: ast.Expression): ast.Expression {
        let target = this.parseComparison(left);
        while (this.at('->')) {
            this.next();
            const value = this.parseOperand(() => this.parseComparison());
            target = { kind: 'Action', target, value, span: this.span(target.span.start) };
        }
        return target;
    }

    /** Level 4: `a = b`, `1 < x < 2` - a chain holds every operand and operator. */
    private parseComparison(left?: ast.Expression): ast.Expression {
        const first = left ?? this.parseAdditive();
        if (!this.isComparisonOperator()) return first;

        const operands = [first];
        const operators: ast.ComparisonOperator[] = [];
        while (this.isComparisonOperator()) {
            operators.push(this.next().text as ast.ComparisonOperator);
            operands.push(this.parseOperand(() => this.parseAdditive()));
        }
        return { kind: 'Comparison', operands, operators, span: this.span(first.span.start) };
    }

    private isComparisonOperator(): boolean {
        const token = this.peek();
        return token.kind === 'punctuation' && COMPARISON_OPERATORS.has(token.text);
    }

    /** Level 5: `+ -` */
    private parseAdditive(): ast.Expression {
        let left = this.parseMultiplicative();
        while (this.at('+') || this.at('-')) {
            const operator = this.next().text as '+' | '-';
            const right = this.parseOperand(() => this.parseMultiplicative());
            left = { kind: 'Binary', operator, left, right, span: this.span(left.span.start) };
        }
        return left;
    }

    /** Level 6: `* /`, and juxtaposition, which binds exactly as they do. */
    private parseMultiplicative(): ast.Expression {
        let left = this.parseUnary();
        for (;;) {
            if (this.at('*') || this.at('/')) {
                const operator = this.next().text as '*' | '/';
                const right = this.parseOperand(() => this.parseUnary());
                left = { kind: 'Binary', operator, left, right, span: this.span(left.span.start) };
            } else if (this.canStartImplicitOperand()) {
                const right = this.parseUnary();
                left = {
                    kind: 'Binary',
                    operator: 'implicit',
                    left,
                    right,
                    span: this.span(left.span.start),
                };
            } else {
                return left;
            }
        }
    }

    /**
     * Level 7: prefix `-` and `+`, looser than `^` so that `-x^2` is `-(x^2)` -
     * and `d/dx`, which takes the whole product after it, as Desmos' does.
     */
    private parseUnary(): ast.Expression {
        if (this.atDerivative()) {
            const start = this.startOf();
            this.next();
            this.next();
            const denominator = this.next();
            // `dx` names `x`: the variable is spanned over the name alone, so
            // hover and rename land on it rather than on the `d`.
            const variable: ast.Identifier = {
                kind: 'Identifier',
                name: denominator.text.slice(1),
                span: { start: denominator.span.start + 1, end: denominator.span.end },
            };
            const body = this.parseMultiplicative();
            return { kind: 'Derivative', variable, body, span: this.span(start) };
        }
        if (this.at('-') || this.at('+')) {
            const start = this.startOf();
            const operator = this.next().text as '-' | '+';
            const operand = this.parseOperand(() => this.parseUnary());
            return { kind: 'Unary', operator, operand, span: this.span(start) };
        }
        return this.parsePower();
    }

    /**
     * Whether `d/dx` starts here: `d`, `/`, a name that is `d` and another
     * name, and an operand after it. Without the operand it is the division it
     * always was, so `d/dx` on its own still divides two variables.
     */
    private atDerivative(): boolean {
        const [d, slash, denominator, operand] = [0, 1, 2, 3].map(n => this.peekAt(n));
        return (
            d.kind === 'identifier' &&
            d.text === 'd' &&
            this.at('/', slash) &&
            denominator.kind === 'identifier' &&
            /^d[A-Za-z]/.test(denominator.text) &&
            this.canStartImplicitOperand(operand)
        );
    }

    /** Level 8: `^`, right-associative, with an exponent that may be negated: `2^-1`. */
    private parsePower(): ast.Expression {
        const base = this.parsePostfix();
        if (!this.at('^')) return base;
        this.next();
        const exponent = this.parseOperand(() => this.parseExponent());
        return {
            kind: 'Binary',
            operator: '^',
            left: base,
            right: exponent,
            span: this.span(base.span.start),
        };
    }

    private parseExponent(): ast.Expression {
        if (this.at('-') || this.at('+')) {
            const start = this.startOf();
            const operator = this.next().text as '-' | '+';
            const operand = this.parseOperand(() => this.parseExponent());
            return { kind: 'Unary', operator, operand, span: this.span(start) };
        }
        return this.parsePower();
    }

    /** Level 9: `f(…)`, `L[…]`, `P.x`, `n!` */
    private parsePostfix(): ast.Expression {
        let expression = this.parseAtom();
        for (;;) {
            const start = expression.span.start;
            if (
                this.at('(') &&
                expression.kind === 'Identifier' &&
                BIG_OPERATORS.has(expression.name)
            ) {
                expression = this.parseBigOperator(expression);
            } else if (this.at("'") && expression.kind === 'Identifier') {
                let order = 0;
                while (this.at("'")) {
                    this.next();
                    order++;
                }
                if (!this.at('(')) {
                    this.error(
                        'unexpected-token',
                        `A prime is written on a call: \`${expression.name}${"'".repeat(order)}(x)\``,
                        this.missingSpan(),
                    );
                    return expression;
                }
                const args = this.parseBracket(')', () => this.parseElements(')')).value;
                expression = {
                    kind: 'Prime',
                    callee: expression,
                    order,
                    arguments: args,
                    span: this.span(start),
                };
            } else if (this.at('(') && expression.kind === 'Identifier') {
                const args = this.parseBracket(')', () => this.parseElements(')')).value;
                expression = {
                    kind: 'Call',
                    callee: expression,
                    arguments: args,
                    span: this.span(start),
                };
            } else if (this.at('[')) {
                const index = this.parseBracket(']', () => {
                    const elements = this.parseListElements();
                    if (elements.length === 0) {
                        return this.errorExpression('Expected an index');
                    }
                    if (elements.length > 1) {
                        this.error(
                            'unexpected-token',
                            'An index takes one expression',
                            elements[1].span,
                        );
                    }
                    return elements[0];
                }).value;
                expression = { kind: 'Index', target: expression, index, span: this.span(start) };
            } else if (this.at('.')) {
                this.next();
                if (this.peek().kind !== 'identifier') {
                    this.error(
                        'expected-identifier',
                        'Expected a name after `.`, such as `x` or `count`',
                        this.missingSpan(),
                    );
                    return expression;
                }
                const name = this.parseIdentifier();
                // `D.cdf(1)`: a member called with arguments, as `cdf(D, 1)`
                // would be (§5.4). A bracket after `.x` is read the same way,
                // and the checker makes it the product it has always been.
                const args = this.at('(')
                    ? this.parseBracket(')', () => this.parseElements(')')).value
                    : undefined;
                expression = {
                    kind: 'Member',
                    target: expression,
                    name,
                    ...(args && { arguments: args }),
                    span: this.span(start),
                };
            } else if (this.at('!')) {
                this.next();
                expression = { kind: 'Factorial', operand: expression, span: this.span(start) };
            } else {
                return expression;
            }
        }
    }

    /**
     * `sum(n = 1..10, body)`, and `prod` and `int` alike. Either bound is any
     * expression up to a sum; the body is anything an argument can be. A shape
     * that is not this one is skipped to the closing bracket, so one mistake
     * is one diagnostic.
     */
    private parseBigOperator(name: ast.Identifier): ast.Expression {
        const open = this.pos;
        const start = name.span.start;
        const operator = name.name as ast.BigOperator['operator'];
        const shape = `\`${operator}(n = from..to, body)\``;

        const inside = this.parseBracket(')', (): ast.Expression | null => {
            const fail = (): null => {
                this.error(
                    'expected-bounds',
                    `\`${operator}\` is written ${shape}`,
                    this.missingSpan(),
                );
                if (this.closers[open] >= 0) this.skipTo(this.closers[open]);
                return null;
            };

            if (this.peek().kind !== 'identifier' || !this.at('=', this.peekAt(1))) return fail();
            const variable = this.parseIdentifier();
            this.next();
            const from = this.parseOperand(() => this.parseAdditive());
            if (!this.at('..')) return fail();
            this.next();
            const to = this.parseOperand(() => this.parseAdditive());
            if (!this.at(',')) {
                return this.errorExpression(`Expected \`,\` and what to ${VERBS[operator]}`);
            }
            this.next();
            const body = this.parseTopOrError(false);
            return {
                kind: 'BigOperator',
                operator,
                name,
                variable,
                from,
                to,
                body,
                span: this.span(start),
            };
        }).value;

        return inside?.kind === 'BigOperator'
            ? { ...inside, span: this.span(start) }
            : { kind: 'ErrorExpression', span: this.span(start) };
    }

    /** Level 10. */
    private parseAtom(): ast.Expression {
        const token = this.peek();
        const start = token.span.start;

        switch (token.kind) {
            case 'number':
                this.next();
                return { kind: 'Number', value: token.text, span: token.span };
            case 'identifier':
                return this.parseIdentifier();
            case 'string':
                return this.parseString();
            case 'color':
                this.next();
                return { kind: 'Color', value: token.text, span: token.span };
            case 'error':
                // Already reported by the lexer.
                this.next();
                return { kind: 'ErrorExpression', span: token.span };
        }

        if (this.at('(')) {
            const { value: elements, trailingComma } = this.parseBracket(')', () =>
                this.parseElements(')'),
            );
            if (elements.length === 1 && !trailingComma) {
                return { kind: 'Paren', expression: elements[0], span: this.span(start) };
            }
            if (elements.length === 0) {
                this.error('expected-expression', 'Empty brackets hold nothing', this.span(start));
                return { kind: 'ErrorExpression', span: this.span(start) };
            }
            return { kind: 'Tuple', elements, span: this.span(start) };
        }

        if (this.at('[')) {
            const elements = this.parseBracket(']', () => this.parseListElements()).value;
            return { kind: 'List', elements, span: this.span(start) };
        }

        if (this.at('{')) {
            const piecewise = this.parseBracket('}', () => this.parsePiecewise(start)).value;
            return { ...piecewise, span: this.span(start) };
        }

        if (this.at('|')) {
            this.next();
            const expression = this.withContext({ inAbs: true }, () => this.parseTopOrError(false));
            if (this.at('|')) {
                this.next();
            } else {
                this.error('unclosed-bracket', '`|` is never closed', token.span);
            }
            return { kind: 'Abs', expression, span: this.span(start) };
        }

        return this.errorExpression('Expected an expression');
    }

    /** An operand after an operator, or an error in its place if there is none. */
    private parseOperand(read: () => ast.Expression): ast.Expression {
        return this.canStartExpression() ? read() : this.errorExpression('Expected an expression');
    }

    /** Report a missing expression and stand an empty one in for it, consuming nothing. */
    private errorExpression(message: string): ast.ErrorExpression {
        const span = this.missingSpan();
        this.error('expected-expression', message, span);
        return { kind: 'ErrorExpression', span: { start: span.start, end: span.start } };
    }

    /**
     * An expression bracket, `(`, `[` or `{`, with `inside` reading what it
     * holds. Newlines inside it mean nothing - unless it is never closed, in
     * which case they do, so that one missing `)` ends at the end of its line
     * rather than swallowing the rest of the file.
     */
    private parseBracket<T>(closer: string, inside: () => T): { value: T; trailingComma: boolean } {
        const open = this.pos;
        const opener = this.next();
        const closed = this.closers[open] >= 0;

        const result = this.withContext(
            { newlines: closed, commaRule: false, inAbs: false },
            () => {
                const value = inside();
                // Step over the newlines before the closer while they still mean
                // nothing: outside the bracket they would end the statement.
                this.peek();
                return value;
            },
        );
        const trailingComma = this.lastToken?.text === ',';

        if (this.at(closer)) {
            this.next();
        } else if (closed) {
            this.unexpected();
            this.skipTo(this.closers[open]);
            this.next();
        } else {
            this.error('unclosed-bracket', `\`${opener.text}\` is never closed`, opener.span);
        }
        return { value: result, trailingComma };
    }

    /** Move straight to a token found by the bracket matching. */
    private skipTo(index: number): void {
        if (index > this.pos) {
            this.lastEnd = this.tokens[index - 1].span.end;
            this.pos = index;
        }
    }

    /** Comma-separated expressions up to a closer: call arguments, tuple elements. */
    private parseElements(closer: string): ast.Expression[] {
        const elements: ast.Expression[] = [];
        if (this.at(closer)) return elements;
        for (;;) {
            elements.push(this.parseTopOrError(false));
            if (!this.at(',')) return elements;
            this.next();
            // `(a, b,)`: leave the trailing comma to be noticed by the caller.
            if (this.at(closer)) return elements;
        }
    }

    /**
     * The elements of a list, or of an index, where `...` makes a range:
     * `[1...10]`, `[1, 3...9]`, and Desmos' own `[1, ..., 10]`, which is the
     * same range spelt with commas round the dots.
     */
    private parseListElements(): ast.Expression[] {
        const elements: ast.Expression[] = [];
        if (this.at(']')) return elements;
        // An end left off - `L[2...]`, `L[...3]`, `L[2, ...]` - is read here
        // wherever it is written, and the checker says where it may be.
        const end = (): ast.Expression | null =>
            this.at(']') ? null : this.parseTopOrError(false);
        for (;;) {
            if (this.at('...')) {
                const dots = this.next();
                if (this.at(',')) this.next();
                const to = end();
                // `[1, ..., 10]` is Desmos' spelling of `[1...10]`; `[...3]`
                // has no start at all.
                const from = elements.pop() ?? null;
                if (from === null && to === null) {
                    this.error('expected-expression', 'A range needs at least one end', dots.span);
                } else {
                    elements.push({
                        kind: 'ListRange',
                        from,
                        to,
                        span: this.span(from?.span.start ?? dots.span.start),
                    });
                }
            } else if (this.at(',')) {
                // `[4, , 6]`: a slot with nothing in it, a table's blank cell.
                const at = this.peek().span.start;
                elements.push({ kind: 'Blank', span: { start: at, end: at } });
            } else {
                const start = this.startOf();
                const element = this.parseTopOrError(false);
                if (this.at('...')) {
                    this.next();
                    const to = this.at(',') ? null : end();
                    elements.push({ kind: 'ListRange', from: element, to, span: this.span(start) });
                } else {
                    elements.push(element);
                }
            }
            if (!this.at(',')) return elements;
            this.next();
            // A list spread over lines may end its last line with a comma.
            if (this.at(']')) return elements;
        }
    }

    /**
     * `{c1: v1, c2: v2, otherwise}` or `{x > 0}`.
     *
     * A trailing entry with no `: value` is the `otherwise` when some entry
     * before it has a value. When none does, every entry is a bare condition:
     * `{x > 0}` is a restriction, and `{x > 0, x < 2}` two of them.
     */
    private parsePiecewise(start: number): ast.Piecewise {
        const entries: ast.PiecewiseBranch[] = [];
        if (!this.at('}')) {
            for (;;) {
                const branchStart = this.startOf();
                const condition = this.parseTopOrError(false);
                let value: ast.Expression | null = null;
                if (this.at(':')) {
                    this.next();
                    value = this.parseTopOrError(false);
                }
                entries.push({
                    kind: 'PiecewiseBranch',
                    condition,
                    value,
                    span: this.span(branchStart),
                });
                if (!this.at(',')) break;
                this.next();
            }
        }

        let otherwise: ast.Expression | null = null;
        const last = entries[entries.length - 1];
        if (last && last.value === null && entries.some(entry => entry.value !== null)) {
            entries.pop();
            otherwise = last.condition;
        }
        // The span is provisional: the caller finishes it once the `}` is read.
        return { kind: 'Piecewise', branches: entries, otherwise, span: this.span(start) };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Leaves
    // ─────────────────────────────────────────────────────────────────────────

    private parseIdentifier(message?: string): ast.Identifier {
        const token = this.peek();
        if (token.kind !== 'identifier') {
            const span = this.missingSpan();
            this.error('expected-identifier', message ?? 'Expected a name', span);
            return { kind: 'Identifier', name: '', span: { start: span.start, end: span.start } };
        }
        this.next();
        return { kind: 'Identifier', name: token.text, span: token.span };
    }

    private parseString(): ast.StringLiteral {
        const token = this.next();
        return { kind: 'String', value: unescapeString(token.text), span: token.span };
    }
}

/**
 * Pair every opening bracket with its closer before parsing starts.
 *
 * The parser uses this twice. A bracket known to be unclosed does not skip
 * newlines, so a missing `)` costs one line rather than the file. And a
 * bracket whose contents stop short of its closer can skip straight to it.
 * A closer that matches an opener further down the stack closes everything
 * above it unclosed - `{ (x }` leaves the `(` open, not the `{`.
 */
function matchBrackets(tokens: Token[]): number[] {
    const closers = tokens.map(() => -2);
    const stack: number[] = [];
    tokens.forEach((token, index) => {
        if (token.kind !== 'punctuation') return;
        if (OPENERS.has(token.text)) {
            closers[index] = -1;
            stack.push(index);
            return;
        }
        const openers = MATCHING_OPENERS[token.text];
        if (!openers) return;
        for (let depth = stack.length - 1; depth >= 0; depth--) {
            if (openers.includes(tokens[stack[depth]].text)) {
                closers[stack[depth]] = index;
                stack.length = depth;
                return;
            }
        }
    });
    return closers;
}

/** A token as a message names it. */
function describe(token: Token): string {
    switch (token.kind) {
        case 'eof':
            return 'end of file';
        case 'newline':
            return 'end of line';
        case 'string':
            return 'string';
        case 'number':
            return `number \`${token.text}\``;
        default:
            return `\`${token.text}\``;
    }
}
