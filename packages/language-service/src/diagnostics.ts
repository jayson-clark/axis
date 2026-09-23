// ═════════════════════════════════════════════════════════════════════════════
// Diagnostics
// ═════════════════════════════════════════════════════════════════════════════
//
// The parser's diagnostics come with the tree. What the tree cannot say - an
// unknown function, a property on the wrong statement, a macro called with
// the wrong number of arguments, an import that is not there - is the
// compiler's: by default the diagnostics are exactly what `compileAxis`
// reports for the document, with the host's resolvers, so an editor and a
// compile never disagree. `semantic` replaces that checker - with a cheaper
// one, a cached one, or `false` for the syntax alone.
//
// `missingImportDiagnostic` and `missingImageDiagnostic` are for a host that
// checks the file system itself rather than handing the compiler resolvers.

import type {
    Diagnostic as SyntaxDiagnostic,
    DiagnosticSeverity,
    Span,
    SyntaxTree,
} from '@axis-dsl/syntax';
import { rangeToSpan, spanToRange, toTree, type DocumentInput, type Range } from './document';
import type { DocumentLink } from './links';
import { compilerDiagnostics, type ProgramOptions } from './program';

export type { DiagnosticSeverity };

/** A diagnostic as an editor shows one: the tree's, with its range worked out. */
export interface Diagnostic {
    code: string;
    severity: DiagnosticSeverity;
    message: string;
    range: Range;
    /** The offsets `range` was worked out from, for a host that wants them. */
    span: Span;
    source: 'axis';
}

/**
 * A semantic checker: everything wrong with a script that its syntax does not
 * show. Given the tree, returns what a compile would add to the parser's.
 *
 * Diagnostics carrying a `path` other than the document's belong to another
 * file (an import's) and are left out, since their spans are not this
 * document's; a host that shows those does so against the file they name.
 */
export type SemanticChecker = (tree: SyntaxTree) => readonly SyntaxDiagnostic[];

export interface DiagnosticOptions extends ProgramOptions {
    /**
     * The checker to run beyond the parser. The compiler's by default, given
     * this object's `path` and resolvers; `false` for syntax alone.
     */
    semantic?: SemanticChecker | false;
}

/** Every problem with the document: the parser's and the compiler's. */
export function getDiagnostics(
    input: DocumentInput,
    options: DiagnosticOptions = {},
): Diagnostic[] {
    const tree = toTree(input);
    const found: SyntaxDiagnostic[] = [...tree.diagnostics];
    const semantic =
        options.semantic === false
            ? undefined
            : (options.semantic ??
              ((checked: SyntaxTree) => compilerDiagnostics(checked, options)));
    if (semantic) {
        // The compiler's list includes the parser's, which would otherwise
        // show every syntax error twice.
        const seen = new Set(found.map(key));
        for (const diagnostic of semantic(tree)) {
            if (diagnostic.path !== undefined && diagnostic.path !== options.path) continue;
            if (seen.has(key(diagnostic))) continue;
            seen.add(key(diagnostic));
            found.push(diagnostic);
        }
    }
    return found
        .sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end)
        .map(diagnostic => toDiagnostic(tree, diagnostic));
}

const key = (diagnostic: SyntaxDiagnostic) =>
    `${diagnostic.code}@${diagnostic.span.start}-${diagnostic.span.end}`;

/** One of the tree's diagnostics, converted - for a host with diagnostics of its own to show. */
export function toDiagnostic(tree: SyntaxTree, diagnostic: SyntaxDiagnostic): Diagnostic {
    return {
        code: diagnostic.code,
        severity: diagnostic.severity,
        message: diagnostic.message,
        range: spanToRange(tree, diagnostic.span),
        span: diagnostic.span,
        source: 'axis',
    };
}

/**
 * The diagnostic for an import whose file is not there, from its link
 * (`getDocumentLinks`).
 *
 * Whether a path resolves is not something the language can answer - only the
 * host knows what its paths mean and what it has - so this is built here and
 * reported by whoever did the looking.
 */
export function missingImportDiagnostic(input: DocumentInput, link: DocumentLink): Diagnostic {
    return missingFile(input, link, 'import-not-found', `Cannot find "${link.target}".`);
}

/**
 * The diagnostic for an image whose file is not there. The same bargain as
 * {@link missingImportDiagnostic}: a path, rather than a URL, is read off disk
 * by the host, so the host is the only one that can say whether it is there.
 */
export function missingImageDiagnostic(input: DocumentInput, link: DocumentLink): Diagnostic {
    return missingFile(input, link, 'image-not-found', `Cannot find image "${link.target}".`);
}

function missingFile(
    input: DocumentInput,
    link: DocumentLink,
    code: string,
    message: string,
): Diagnostic {
    return {
        code,
        severity: 'error',
        message,
        range: link.range,
        span: rangeToSpan(toTree(input), link.range),
        source: 'axis',
    };
}
