// ═════════════════════════════════════════════════════════════════════════════
// Diagnostics
// ═════════════════════════════════════════════════════════════════════════════
//
// The parser's diagnostics are always here: they come with the tree. What the
// tree cannot say - an unknown function, a property on the wrong statement, a
// macro called with the wrong number of arguments - is the checker's (#17),
// and the checker lives in the compiler, which this package does not depend
// on. So it is a seam: a host that has the compiler passes its checker as
// `semantic`, and an editor then shows exactly what a compile would report,
// while a host without one (a playground that only highlights) still gets
// every syntax error.
//
// Whether an import or an image's file exists is a third kind again, which
// only a host with a file system can answer; `missingImportDiagnostic` and
// `missingImageDiagnostic` build what it reports.

import type {
    Diagnostic as SyntaxDiagnostic,
    DiagnosticSeverity,
    Span,
    SyntaxTree,
} from '@axis-dsl/syntax';
import { rangeToSpan, spanToRange, toTree, type DocumentInput, type Range } from './document';
import type { DocumentLink } from './links';

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
 * The semantic checker: everything wrong with a script that its syntax does
 * not show. Given the tree, returns the diagnostics a compile would add to the
 * parser's - the compiler's `check` (#17), in a host that has it.
 *
 * Diagnostics carrying a `path` belong to another file (an import's) and are
 * left out, since their spans are not this document's; a host that shows
 * those does so against the file they name.
 */
export type SemanticChecker = (tree: SyntaxTree) => readonly SyntaxDiagnostic[];

export interface DiagnosticOptions {
    semantic?: SemanticChecker;
}

/** Every problem with the document: the parser's, and the checker's when one is given. */
export function getDiagnostics(
    input: DocumentInput,
    options: DiagnosticOptions = {},
): Diagnostic[] {
    const tree = toTree(input);
    const found = [...tree.diagnostics];
    if (options.semantic) {
        // A checker that also reports syntax - the compiler's own list does -
        // would otherwise show every parse error twice.
        const seen = new Set(found.map(key));
        for (const diagnostic of options.semantic(tree)) {
            if (diagnostic.path !== undefined || seen.has(key(diagnostic))) continue;
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
