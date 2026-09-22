import { useEffect, useState } from 'react';
import { type CompilationResult, compileAxis } from '@axis-dsl/compiler';
import { CalculatorOptions, GraphState } from '@axis-dsl/desmos';

export interface CompiledAxis {
    /** The whole graph state, null until the first compile has finished. */
    state: GraphState | null;
    /** The calculator options, applied after the state. */
    options: CalculatorOptions;
    /** Everything the compiler had to say about the source. */
    diagnostics: CompilationResult['diagnostics'];
    /** The first error the compiler reported, for the bar above the graph, or null. */
    error: string | null;
    /** True between a source edit and the debounced compile that follows it. */
    isStale: boolean;
}

const DEBOUNCE_MS = 250;

/**
 * Compiles `source` on a debounce.
 *
 * The compiler never throws on a script: a mistake is a diagnostic, and the
 * graph it hands back alongside is everything the rest of the script still
 * makes. So the preview keeps drawing while a line is half typed, and the
 * first error is surfaced beside it.
 */
export function useCompiledAxis(source: string): CompiledAxis {
    const [result, setResult] = useState<Omit<CompiledAxis, 'isStale'>>(() => ({
        state: null,
        options: {},
        diagnostics: [],
        error: null,
    }));
    const [isStale, setIsStale] = useState(true);

    useEffect(() => {
        setIsStale(true);
        const timer = window.setTimeout(() => {
            try {
                const { state, options, diagnostics } = compileAxis(source);
                setResult({
                    state,
                    options,
                    diagnostics,
                    error: describeErrors(diagnostics, source),
                });
            } catch (error) {
                // Only a bug in the compiler lands here.
                setResult(previous => ({
                    ...previous,
                    error: error instanceof Error ? error.message : String(error),
                }));
            }
            setIsStale(false);
        }, DEBOUNCE_MS);

        return () => window.clearTimeout(timer);
    }, [source]);

    return { ...result, isStale };
}

/** `line 3: \`sine\` is not a function… (and 2 more)`, or null for a clean script. */
function describeErrors(
    diagnostics: CompilationResult['diagnostics'],
    source: string,
): string | null {
    const errors = diagnostics.filter(diagnostic => diagnostic.severity === 'error');
    if (errors.length === 0) {
        return null;
    }
    const [first] = errors;
    const line = source.slice(0, first.span.start).split('\n').length;
    const more = errors.length > 1 ? ` (and ${errors.length - 1} more)` : '';
    return `line ${line}: ${first.message}${more}`;
}
