import { useEffect, useState } from 'react';
import { compileAxis } from '@axis-dsl/compiler';
import { CalculatorOptions, DesmosExpression } from '@axis-dsl/desmos';

export interface CompiledAxis {
    expressions: DesmosExpression[];
    settings?: CalculatorOptions;
    /** Message from the last failed compile, or null. */
    error: string | null;
    /** True between a source edit and the debounced compile that follows it. */
    isStale: boolean;
}

const DEBOUNCE_MS = 250;

/**
 * Compiles `source` on a debounce.
 *
 * A failed compile keeps the last good expressions on screen and surfaces the
 * error alongside them — clearing the graph on every half-typed line would make
 * the live preview useless.
 */
export function useCompiledAxis(source: string): CompiledAxis {
    const [result, setResult] = useState<Omit<CompiledAxis, 'isStale'>>(() => ({
        expressions: [],
        settings: undefined,
        error: null,
    }));
    const [isStale, setIsStale] = useState(true);

    useEffect(() => {
        setIsStale(true);
        const timer = window.setTimeout(() => {
            try {
                const compiled = compileAxis(source);
                setResult({
                    expressions: compiled.expressions,
                    settings: compiled.settings,
                    error: null,
                });
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
