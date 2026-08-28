import { CSSProperties, ReactNode, Ref, useEffect, useImperativeHandle, useRef } from 'react';
import {
    AsyncScreenshotOptions,
    Calculator,
    CalculatorOptions,
    DesmosExpression,
    GraphState,
} from '@axis-dsl/desmos';
import { useDesmos } from './useDesmos.js';

export interface DesmosGraphHandle {
    /** The live Desmos GraphingCalculator, or null before it is constructed. */
    getCalculator(): Calculator | null;
    getExpressions(): DesmosExpression[] | null;
    getState(): GraphState | null;
    /**
     * A data URI of the graphpaper alone - the expression list is never in it.
     * Resolves null before the calculator exists, so a caller can offer the
     * affordance without first knowing whether Desmos has loaded.
     */
    capture(options?: AsyncScreenshotOptions): Promise<string | null>;
}

export interface DesmosGraphProps {
    /** Exposes {@link DesmosGraphHandle}. A plain prop, as React 19 has it. */
    ref?: Ref<DesmosGraphHandle>;
    apiKey: string | null | undefined;
    expressions: DesmosExpression[];
    settings?: CalculatorOptions;
    /** Rendered instead of the graph while the Desmos script is loading. */
    loadingFallback?: ReactNode;
    /** Rendered instead of the graph when the script or key fails. */
    renderError?: (message: string) => ReactNode;
    className?: string;
    style?: CSSProperties;
}

const DEFAULT_VIEWPORT = { xmin: -10, ymin: -10, xmax: 10, ymax: 10 };

/**
 * setState (rather than setExpressions) is what carries folder membership, so
 * expressions are always applied as a whole graph state.
 */
function graphState(expressions: DesmosExpression[]): GraphState {
    return {
        version: 11,
        graph: { viewport: DEFAULT_VIEWPORT },
        expressions: { list: expressions },
    };
}

/**
 * asyncScreenshot is the callback form of the two Desmos offers. It is the one
 * worth wrapping: only it takes a format, a fit mode and explicit math bounds,
 * and it renders off the animation loop rather than grabbing whatever frame the
 * canvas happens to be showing.
 */
function capture(
    calculator: Calculator | null,
    options: AsyncScreenshotOptions | undefined,
): Promise<string | null> {
    if (!calculator) {
        return Promise.resolve(null);
    }
    return new Promise(resolve => {
        calculator.asyncScreenshot(options ?? {}, dataUri => resolve(dataUri));
    });
}

/**
 * Renders a Desmos graphing calculator and keeps it in sync with `expressions`
 * and `settings`. Knows nothing about where those come from.
 */
export function DesmosGraph({
    ref,
    apiKey,
    expressions,
    settings,
    loadingFallback,
    renderError,
    className,
    style,
}: DesmosGraphProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const calculatorRef = useRef<Calculator | null>(null);
    /** Serialized state+settings last pushed to the calculator. */
    const lastAppliedRef = useRef<string | null>(null);
    const { status, error } = useDesmos(apiKey);

    useImperativeHandle(
        ref,
        () => ({
            getCalculator: () => calculatorRef.current,
            getExpressions: () => calculatorRef.current?.getExpressions() ?? null,
            getState: () => calculatorRef.current?.getState() ?? null,
            capture: options => capture(calculatorRef.current, options),
        }),
        [],
    );

    useEffect(() => {
        if (status !== 'ready' || !containerRef.current || !window.Desmos) {
            return;
        }

        const calculator = window.Desmos.GraphingCalculator(containerRef.current);
        calculatorRef.current = calculator;

        return () => {
            calculator.destroy();
            calculatorRef.current = null;
            lastAppliedRef.current = null;
        };
    }, [status]);

    // Runs after the effect above on the render that flips status to 'ready',
    // so the first batch of expressions never needs to be queued.
    useEffect(() => {
        const calculator = calculatorRef.current;
        if (!calculator) {
            return;
        }

        const state = graphState(expressions);

        // Every compile hands us fresh object identities, so compare contents:
        // re-applying an identical state would churn the calculator for nothing.
        const applied = JSON.stringify({ state, settings: settings ?? null });
        if (applied === lastAppliedRef.current) {
            return;
        }
        lastAppliedRef.current = applied;

        // Desmos pulls focus into its own expression list when a state is
        // applied. That lands on the user mid-keystroke, so anything focused
        // outside the calculator gets its focus handed back.
        const previous = document.activeElement;
        const container = containerRef.current;
        const wasOutside =
            previous instanceof HTMLElement && !!container && !container.contains(previous);

        calculator.setState(state);

        // updateSettings has to follow setState, which resets graph settings.
        if (settings) {
            calculator.updateSettings(settings);
        }

        if (!wasOutside) {
            return;
        }

        const restore = () => {
            const current = document.activeElement;
            // Only reclaim focus the calculator took — never focus the user
            // moved there deliberately in the meantime.
            if (
                current !== previous &&
                current instanceof HTMLElement &&
                container?.contains(current)
            ) {
                (previous as HTMLElement).focus({ preventScroll: true });
            }
        };

        restore();
        // MathQuill focuses itself a tick after the list is rebuilt.
        const frame = requestAnimationFrame(restore);
        return () => cancelAnimationFrame(frame);
    }, [status, expressions, settings]);

    if (status === 'error' && error) {
        return <>{renderError ? renderError(error) : <div style={{ padding: 20 }}>{error}</div>}</>;
    }

    return (
        <div
            className={className}
            style={{ position: 'relative', width: '100%', height: '100%', ...style }}
        >
            <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
            {status !== 'ready' && (
                <div style={{ position: 'absolute', inset: 0, padding: 20 }}>
                    {loadingFallback ?? 'Loading Desmos…'}
                </div>
            )}
        </div>
    );
}
