import { useEffect, useState } from 'react';
import { compileAxis, toGraph } from '@axis-dsl/compiler';
import { CalculatorOptions, GraphState } from '@axis-dsl/desmos';

export interface CompiledAxis {
    /** The whole graph state, null until the first compile has finished. */
    state: GraphState | null;
    /** The calculator options, applied after the state. */
    options: CalculatorOptions;
    /** Message from the last failed compile, or null. */
    error: string | null;
    /** True between a source edit and the debounced compile that follows it. */
    isStale: boolean;
}

const DEBOUNCE_MS = 250;

/**
 * Compiles `source` on a debounce.
 *
 * A failed compile keeps the last good graph on screen and surfaces the error
 * alongside it — clearing the graph on every half-typed line would make the
 * live preview useless.
 */
export function useCompiledAxis(source: string): CompiledAxis {
    const [result, setResult] = useState<Omit<CompiledAxis, 'isStale'>>(() => ({
        state: null,
        options: {},
        error: null,
    }));
    const [isStale, setIsStale] = useState(true);

    useEffect(() => {
        setIsStale(true);
        const timer = window.setTimeout(() => {
            try {
                const { state, options } = toGraph(compileAxis(source));
                setResult({ state, options, error: null });
            } catch (error) {
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
