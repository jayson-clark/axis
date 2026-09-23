import { CSSProperties, ReactNode, Ref, useEffect, useImperativeHandle, useRef } from 'react';
import {
    AsyncScreenshotOptions,
    Calculator,
    CalculatorOptions,
    DESMOS_PRODUCT_CONSTRUCTORS,
    DesmosExpression,
    GraphState,
    stateProduct,
} from '@axis-dsl/desmos';
import type { GraphReading } from './protocol/index.js';
import { useDesmos } from './useDesmos.js';

export interface DesmosGraphHandle {
    /**
     * The live Desmos calculator - a graphing, geometry or 3D one, as the state
     * asks - or null before it is constructed.
     */
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
    /**
     * The whole graph, applied with `setState` exactly as given: the expression
     * list, the ticker beside it, the viewport and every top-level flag. Left
     * out, the calculator is left as it is.
     */
    state?: GraphState | null;
    /**
     * Calculator options, applied with `updateSettings` once the state is in.
     * Separate because Desmos keeps the two apart: an option inside the state
     * is ignored, and so is a piece of state handed to `updateSettings`.
     */
    options?: CalculatorOptions;
    /**
     * Report changes the user makes to the graph by hand.
     *
     * `before` is the graph as the calculator handed it back immediately after
     * this component last applied a state to it; `after` is the graph now. The
     * difference between them is what the user did, and nothing else - which is
     * why the baseline is read back off the calculator rather than taken from
     * the props that produced it. Desmos normalises what it is given, so the
     * two are not the same graph, and comparing against the props would report
     * a change on every expression the moment one loaded.
     *
     * Left out, the calculator is not watched at all.
     */
    onGraphChanged?: (before: GraphReading, after: GraphReading) => void;
    /**
     * How long the graph has to be still before a change is reported, in
     * milliseconds. A drag is hundreds of changes and only one edit.
     */
    changeDelay?: number;
    /** Rendered instead of the graph while the Desmos script is loading. */
    loadingFallback?: ReactNode;
    /** Rendered instead of the graph when the script or key fails. */
    renderError?: (message: string) => ReactNode;
    className?: string;
    style?: CSSProperties;
}

/**
 * How long the graph has to be still before a change is reported.
 *
 * Desmos fires `change` on every frame of a drag, and a point dragged across
 * the graphpaper is one edit rather than three hundred. Long enough to let go
 * of the mouse, short enough that the file catches up while you are still
 * looking at what you did.
 */
const DEFAULT_CHANGE_DELAY = 400;

/**
 * A calculator's graph, in the two halves a graph is applied as.
 *
 * `settings` is copied rather than handed over: it is the live observable
 * object Desmos keeps updating, and a reading has to stay what it was when it
 * was taken.
 */
function reading(calculator: Calculator): GraphReading {
    return { state: calculator.getState(), options: { ...calculator.settings } };
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
 * Renders a Desmos calculator and keeps it in sync with `state` and
 * `options`. Knows nothing about where those come from.
 */
export function DesmosGraph({
    ref,
    apiKey,
    state,
    options,
    onGraphChanged,
    changeDelay = DEFAULT_CHANGE_DELAY,
    loadingFallback,
    renderError,
    className,
    style,
}: DesmosGraphProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const calculatorRef = useRef<Calculator | null>(null);
    /** Serialized state+options last pushed to the calculator. */
    const lastAppliedRef = useRef<string | null>(null);
    /**
     * The graph as the calculator held it the moment the last state finished
     * being applied - what a change is a change from.
     */
    const baselineRef = useRef<GraphReading | null>(null);
    /** Written during render, so the observer below always calls the current one. */
    const onChanged = useRef(onGraphChanged);
    onChanged.current = onGraphChanged;
    const { status, error } = useDesmos(apiKey);
    // A calculator is built for one product and cannot become another, so a
    // state that asks for a different one gets a new calculator.
    const product = stateProduct(state);

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

        const calculator = window.Desmos[DESMOS_PRODUCT_CONSTRUCTORS[product]](
            containerRef.current,
        );
        calculatorRef.current = calculator;

        return () => {
            calculator.destroy();
            calculatorRef.current = null;
            lastAppliedRef.current = null;
        };
    }, [status, product]);

    // Runs after the effect above on the render that flips status to 'ready',
    // so the first graph never needs to be queued.
    useEffect(() => {
        const calculator = calculatorRef.current;
        if (!calculator || !state) {
            return;
        }

        // Every compile hands us fresh object identities, so compare contents.
        // Re-applying an identical state would churn the calculator for nothing,
        // and would throw away wherever the user has panned to since - saving a
        // file without changing the graph should not reframe it.
        const applied = JSON.stringify({ state, options: options ?? null });
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

        // setState rather than setExpressions, because only the state form
        // carries folder membership - and the state is applied as it came, so
        // this graph is the same one every other host shows.
        calculator.setState(state);

        // updateSettings has to follow setState, which resets graph settings.
        if (options) {
            calculator.updateSettings(options);
        }

        // The baseline moves with the graph: from here on, a change is
        // something the user did rather than something this effect did.
        baselineRef.current = reading(calculator);

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
    }, [status, state, options]);

    // Watching the calculator for what the user does to the graph directly.
    //
    // Desmos fires `change` for everything, its own `setState` included, so the
    // baseline is what tells the two apart: the effect above moves it every
    // time it applies a state, and anything still different from it afterwards
    // is the user's doing. A report the host acts on comes back as a new
    // compilation, a new state, and a new baseline - which is what closes the
    // loop rather than leaving it ringing.
    useEffect(() => {
        const calculator = calculatorRef.current;
        if (!calculator || !onGraphChanged) {
            return;
        }

        let timer: number | undefined;

        const settled = () => {
            const before = baselineRef.current;
            const after = reading(calculator);
            if (!before || JSON.stringify(before) === JSON.stringify(after)) {
                return;
            }
            onChanged.current?.(before, after);
        };

        // Namespaced, because `unobserveEvent('change')` takes every observer
        // of it with it - including one a host attached to the same calculator
        // through `getCalculator()`.
        calculator.observeEvent('change.axisGraphSync', () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(settled, changeDelay);
        });

        return () => {
            window.clearTimeout(timer);
            calculator.unobserveEvent('change.axisGraphSync');
        };
        // `status` and `product` are what say which calculator above exists; `onGraphChanged`
        // is read for whether to watch at all, never to call - `onChanged`
        // holds the current one, so a host passing a fresh closure every render
        // does not re-subscribe on every render.
    }, [status, product, Boolean(onGraphChanged), changeDelay]);

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
