// ═════════════════════════════════════════════════════════════════════════════
// Keywords - what each one does, and how to start writing one
// ═════════════════════════════════════════════════════════════════════════════
//
// The manifest lists the keywords but says nothing about them, since nothing
// but an editor wants prose about `folder`. Completions offer the statement
// keywords with a snippet of the whole statement; hover explains every one,
// the contextual `min` and `max` of a range included.

import type { Keyword } from '@axis-dsl/syntax';
import type { StatementOwner } from './context';

export interface KeywordInfo {
    /** One line, as a completion's detail. */
    detail: string;
    /** A paragraph and an example, as a hover's body. */
    documentation: string;
    /** The statement it starts, as a snippet, for the keywords that start one. */
    snippet?: string;
    /** Where the statement may stand (spec §3.2); absent for the keywords that start none. */
    allowedIn?: readonly StatementOwner[];
}

const FILE_ONLY: readonly StatementOwner[] = ['file'];
const FILE_OR_FOLDER: readonly StatementOwner[] = ['file', 'folder'];

export const KEYWORD_INFO: Readonly<Record<Keyword | 'min' | 'max', KeywordInfo>> = {
    folder: {
        detail: 'A folder of statements',
        documentation:
            'Groups statements in the expression list. The title is optional, and metadata written straight after the `{` styles the folder itself. Folders do not nest.\n\n```axis\nfolder "Waves" { @ collapsed\n    y = sin(x)\n}\n```',
        snippet: 'folder "${1:Name}" {\n\t$0\n}',
        allowedIn: FILE_ONLY,
    },
    table: {
        detail: 'A table of columns',
        documentation:
            'Each entry is a column: `x_1 = [1, 2, 3]` is a header and its values, a bare expression is a computed column. Metadata straight after the `{` applies to every column.\n\n```axis\ntable { x_1 = [1, 2, 3]; y_1 = [1, 4, 9] @ lines }\n```',
        snippet: 'table {\n\t${1:x_1} = [${2:1, 2, 3}]\n\t${3:y_1} = [${4:1, 4, 9}]\n}',
        allowedIn: FILE_OR_FOLDER,
    },
    config: {
        detail: 'Calculator settings',
        documentation:
            'The graph’s settings, one `key: value` to an entry. At most one per file, at the top level.\n\n```axis\nconfig { showGrid: false; xmin: -10; xmax: 10 }\n```',
        snippet: 'config {\n\t$0\n}',
        allowedIn: FILE_ONLY,
    },
    import: {
        detail: 'Bring in another script, as a folder',
        documentation:
            'The path is relative to this file, and `.axis` may be left off. The imported statements land in one folder, named after the file unless `as` names it.\n\n```axis\nimport "./lib/waves" as "Waves" @ collapsed: false\n```',
        snippet: 'import "${1:./file.axis}"',
        allowedIn: FILE_OR_FOLDER,
    },
    image: {
        detail: 'A picture on the graph',
        documentation:
            'A path beside this file, an `http(s):` URL or a `data:` URI.\n\n```axis\nimage "./beach.png" @ center: (0, 0), width: 10\n```',
        snippet: 'image "${1:./picture.png}" @ center: (${2:0}, ${3:0}), width: ${4:10}',
        allowedIn: FILE_OR_FOLDER,
    },
    ticker: {
        detail: 'Run an action over and over',
        documentation:
            'The graph’s ticker: an action, or a run of them, performed every tick. `dt` is the milliseconds since the last one. One per graph, at the top level.\n\n```axis\nticker n -> n + dt @ minStep: 50, playing\n```',
        snippet: 'ticker ${1:n} -> ${2:n + dt} @ minStep: ${3:50}, playing',
        allowedIn: FILE_ONLY,
    },
    style: {
        detail: 'A named set of properties',
        documentation:
            'Properties written once and applied with `use: name` wherever a statement’s metadata goes. Styles may use other styles. Top level only.\n\n```axis\nstyle emphasis { color: RED; lineWidth: 4 }\ny = x @ use: emphasis\n```',
        snippet: 'style ${1:name} { $0 }',
        allowedIn: FILE_ONLY,
    },
    macro: {
        detail: 'A named expression, substituted where it is used',
        documentation:
            'Replaced by its body wherever the name appears, with the arguments put in for the parameters. In scope everywhere, imports included. Top level only.\n\n```axis\nmacro wave(k, phase) = sin(k * x + phase)\n```',
        snippet: 'macro ${1:name}(${2:a}) = ${3:2a}',
        allowedIn: FILE_ONLY,
    },
    as: {
        detail: 'The title of an import’s folder',
        documentation: '```axis\nimport "./lib/waves" as "Waves"\n```',
    },
    for: {
        detail: 'List comprehension',
        documentation:
            'Binds list variables for the expression in front of it.\n\n```axis\nL = [i ^ 2 for i = [1...10]]\n```',
    },
    with: {
        detail: 'Local definition',
        documentation:
            'Substitutes values into the expression in front of it.\n\n```axis\nf(x) = x n with n = 3\n```',
    },
    step: {
        detail: 'A slider’s step',
        documentation: '```axis\na = 1 @ slider: -5..5 step 0.5\n```',
    },
    soft: {
        detail: 'Slider ends that may be dragged past',
        documentation:
            '`soft` makes both ends of a range soft; `soft min` or `soft max` only the one.\n\n```axis\nb = 0 @ slider: 0..10 soft max\n```',
    },
    min: {
        detail: 'The lower end of a range',
        documentation: 'After `soft`: only the lower end may be dragged past.',
    },
    max: {
        detail: 'The upper end of a range',
        documentation: 'After `soft`: only the upper end may be dragged past.',
    },
};

/** The keywords that start a statement, in the order they are offered. */
export const STATEMENT_KEYWORDS = [
    'folder',
    'table',
    'config',
    'style',
    'macro',
    'import',
    'image',
    'ticker',
] as const satisfies readonly Keyword[];
