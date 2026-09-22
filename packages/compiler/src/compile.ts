// ═════════════════════════════════════════════════════════════════════════════
// The Axis compiler
// ═════════════════════════════════════════════════════════════════════════════
//
// `.axis` source in, one Desmos graph out (spec §9). Four passes, each over the
// whole import graph at once:
//
//   1. load     parse the script and every file it imports      (program.ts)
//   2. gather   the macros, styles and names they define        (symbols.ts)
//   3. check    everything the parser could not know             (check.ts)
//   4. lower    macros and styles resolved, trees into a state  (lower.ts)
//
// Every pass reports what is wrong and carries on, so a compilation never
// throws on anything a script can say: it hands back every diagnostic beside
// whatever graph could still be built, and a preview keeps drawing the parts
// of a script that are fine while one line is being typed.
//
// Compilation is synchronous and never touches a filesystem. Imports and
// images are asked for through `resolveImport` and `resolveImage`, which a host
// fills ahead of time with `loadImports` and `loadImages` - so the same compiler
// runs in an editor, a browser and a test with three strings in a Map.

import type { CalculatorOptions, GraphState } from '@axis-dsl/desmos';
import type { Diagnostic } from '@axis-dsl/syntax';
import { checkProgram } from './check';
import type { ResolveImage } from './images';
import type { ResolveImport } from './imports';
import { lowerProgram, type StatementOrigin } from './lower';
import { loadProgram } from './program';
import { collectSymbols } from './symbols';

export type { StatementOrigin } from './lower';

export interface CompilationResult {
    /**
     * The whole graph, as `calculator.setState` takes it: the expression list
     * and the ticker beside it, the viewport and the other `graph` settings,
     * and the flags Desmos reads off the top of a state. Complete - a host
     * applies it as it is and adds nothing.
     */
    state: GraphState;
    /**
     * The calculator options, for `calculator.updateSettings` - after
     * `setState`, which resets them. The Axis defaults, under whatever the
     * script's config (and its imports') said.
     */
    options: CalculatorOptions;
    /**
     * Every problem found, from the parser, the checker and the compiler, in
     * source order within each file. One with a `path` belongs to an imported
     * file; one without, to the script itself.
     */
    diagnostics: Diagnostic[];
    /**
     * Where each expression in the list was written, keyed by its id.
     *
     * Every folder, note, table, image and expression has an entry, imported
     * ones included - an import is compiled like any other file, so its
     * statements are traced back to the file they were written in rather than
     * to the `import` that pulled them in.
     */
    sourceMap: Map<string, StatementOrigin>;
    /**
     * Where the entry script's own `config { … }` block is written, if it has
     * one. An imported file's is not it: the entry's is the one that wins, so
     * it is the one a change to the graph's settings belongs in. Absent for a
     * script with no config block at all, which is the signal to a host
     * writing settings back that it has to open one.
     */
    configOrigin?: StatementOrigin;
    /**
     * Every file the graph was built from besides the script, as the resolvers
     * named them. A host watching a script for changes watches these too.
     */
    dependencies: { imports: string[]; images: string[] };
}

export interface CompileOptions {
    /**
     * Where the script itself lives. Handed back to the resolvers as the file
     * a path was written in, so relative imports and images have something to
     * be relative to.
     */
    path?: string;
    /**
     * How `import "…"` finds its source. An import that does not resolve - for
     * want of a resolver or of the file - is a diagnostic against the import.
     */
    resolveImport?: ResolveImport;
    /**
     * How `image "./beach.png"` finds its picture, which the compiler inlines
     * as a `data:` URI. Only paths ask: an image that names a URL Desmos can
     * load needs no resolver.
     */
    resolveImage?: ResolveImage;
}

/** Compile a `.axis` script into one Desmos graph state and its calculator options. */
export function compileAxis(source: string, options: CompileOptions = {}): CompilationResult {
    const program = loadProgram(source, options);
    const { symbols, diagnostics: symbolDiagnostics } = collectSymbols(program);
    const checked = checkProgram(program, symbols);
    const lowered = lowerProgram(program, symbols, options.resolveImage);

    const diagnostics = [
        ...program.diagnostics,
        ...symbolDiagnostics,
        ...checked.diagnostics,
        ...lowered.diagnostics,
    ];

    return {
        state: lowered.state,
        options: lowered.options,
        diagnostics: sortDiagnostics(
            diagnostics,
            program.files.map(file => file.path),
        ),
        sourceMap: lowered.sourceMap,
        ...(lowered.configOrigin && { configOrigin: lowered.configOrigin }),
        dependencies: {
            imports: program.files.filter(file => !file.entry).map(file => file.path),
            images: lowered.images,
        },
    };
}

/**
 * The script's own diagnostics first, then each import's in the order the
 * imports were read, and within a file by where they start - which is the
 * order a reader meets them in.
 */
function sortDiagnostics(diagnostics: Diagnostic[], order: readonly string[]): Diagnostic[] {
    const rank = (diagnostic: Diagnostic) =>
        diagnostic.path === undefined ? -1 : order.indexOf(diagnostic.path);
    return diagnostics
        .map((diagnostic, index) => ({ diagnostic, index }))
        .sort(
            (a, b) =>
                rank(a.diagnostic) - rank(b.diagnostic) ||
                a.diagnostic.span.start - b.diagnostic.span.start ||
                a.index - b.index,
        )
        .map(({ diagnostic }) => diagnostic);
}
