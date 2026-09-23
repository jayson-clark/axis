// ═════════════════════════════════════════════════════════════════════════════
// The diagnostics the lexer and parser report
// ═════════════════════════════════════════════════════════════════════════════
//
// Every code is declared once, here, with what it means and a file that
// raises it; the lexer's and the parser's `report` take nothing else, so a new
// code cannot be raised without an entry. The summaries are the spec's (§8) -
// a test holds the two tables to each other - and the docs site's page of
// diagnostics is generated from this and the compiler's catalogue.

/** What a diagnostic code means, and a file that raises it. */
export interface DiagnosticInfo {
    /** A phrase, as the spec's table has it: "a string still open at the end of its line". */
    summary: string;
    /** A file that raises this code and no other. */
    example: string;
}

export const SYNTAX_DIAGNOSTICS = {
    // The lexer
    'unexpected-character': {
        summary: 'a character no token starts with',
        example: 'a = 5 $ 2',
    },
    'unterminated-string': {
        summary: 'a string still open at the end of its line',
        example: '"A note that never ends',
    },
    'invalid-escape': {
        summary: 'a string escape other than `\\"`, `\\\\`, `\\n`',
        example: '"A \\q in a note"',
    },
    'invalid-color': {
        summary: '`#` without exactly 3 or 6 hex digits',
        example: 'y = x @ color: #12',
    },

    // The parser
    'unexpected-token': {
        summary: 'a token no rule could use where it stands',
        example: 'y = x )',
    },
    'expected-expression': {
        summary: 'an operand, element or value missing',
        example: 'y = 2 +',
    },
    'unclosed-bracket': {
        summary: 'a `(`, `[`, expression `{` or `\\|` never closed',
        example: 'y = (x + 1',
    },
    'unclosed-block': {
        summary: 'a block `{` or `@{` never closed',
        example: 'folder "Waves" {\n    y = sin(x)',
    },
    'expected-block': {
        summary: 'a block keyword without its `{`',
        example: 'folder "Waves"',
    },
    'expected-identifier': {
        summary: 'a style or macro name, a macro parameter, or a member name missing',
        example: 'style { color: RED }',
    },
    'expected-string': {
        summary: 'an import path, `as` title or image source missing',
        example: 'image',
    },
    'expected-equals': {
        summary: 'a macro without its `=`',
        example: 'macro double(a) 2a',
    },
    'expected-binding': {
        summary: '`with` or `for` not followed by `name = value`',
        example: 'y = a x with 3',
    },
    'expected-bounds': {
        summary: '`sum`, `prod` or `int` not opened with `name = from..to`',
        example: 'y = sum(n, n)',
    },
    'expected-property': {
        summary: 'metadata or a block entry that does not start with a property name',
        example: 'y = x @ 3',
    },
    'expected-colon': {
        summary: 'a property name followed by something other than `:` or the next entry',
        example: 'y = x @ color RED',
    },
    'expected-value': {
        summary: '`key:` with nothing after it',
        example: 'y = x @ color:',
    },
    'comma-between-properties': {
        summary: 'block entries separated by a comma (§4.1)',
        example: 'config { showGrid: false, xmin: -5 }',
    },
    'misplaced-metadata': {
        summary: 'metadata trailing nothing',
        example: 'folder "Waves" {\n    y = sin(x)\n    @ collapsed\n}',
    },
} as const satisfies Record<string, DiagnosticInfo>;

export type SyntaxDiagnosticCode = keyof typeof SYNTAX_DIAGNOSTICS;
