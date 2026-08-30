// ═════════════════════════════════════════════════════════════════════════════
// AxisCalculator — Axis source in, a real Desmos graph's answers out
// ═════════════════════════════════════════════════════════════════════════════
//
// The compiler can only ever tell you what it emitted. Whether Desmos *accepts*
// that — whether `y=x^{2` is a syntax error, whether `f(x)` resolves, what a
// slider actually evaluates to, whether an expression is graphable at all — is
// knowable only by asking a calculator, and a calculator only exists in a
// browser. So the harness puts one in a headless Chromium and talks to it.
//
// Everything here is a thin wrapper over one `page.evaluate`. The functions
// handed to it run inside the page, so they close over nothing from this
// module; they are written as real functions rather than strings so that the
// Desmos types still check them.

import type { Browser, LaunchOptions, Page } from 'playwright-core';
import {
    AsyncScreenshotOptions,
    Calculator,
    CalculatorOptions,
    DESMOS_DEMO_API_KEY,
    DesmosExpression,
    DesmosNamespace,
    ExpressionAnalysis,
    ExpressionState,
    GraphState,
    MathBounds,
} from '@axis-dsl/desmos';
import { CompilationResult, CompileOptions, compileAxis } from '@axis-dsl/compiler';
import { acquireBrowser, releaseBrowser } from './browser';
import { HARNESS_URL, installRouting } from './page';

declare global {
    interface Window {
        Desmos?: DesmosNamespace;
        /** Installed by the bootstrap below; everything else reads it. */
        __axisHarness?: { calculator: Calculator; lastChange: number };
    }
}

const DEFAULT_VIEWPORT: MathBounds = { left: -10, right: 10, bottom: -10, top: 10 };

export interface AxisCalculatorOptions {
    /** Defaults to Desmos' public demo key, as the rest of Axis does. */
    apiKey?: string;
    /** Options the calculator is constructed with. */
    settings?: CalculatorOptions;
    /** Initial math bounds. Fixed rather than fitted, so tests are stable. */
    viewport?: Partial<MathBounds>;
    /** Fail on a cache miss instead of fetching from desmos.com. */
    offline?: boolean;
    /** Set false to watch the graph in a real window while debugging a test. */
    headless?: boolean;
    /** How long to wait for the calculator to load and to settle. */
    timeout?: number;
    /**
     * How long the calculator has to stop changing before it counts as settled.
     * Desmos computes asynchronously, so reading `expressionAnalysis` the tick
     * after a state is applied reads a graph that is still thinking.
     */
    quietMs?: number;
    /** Extra Chromium launch options, for the shared browser's first launch. */
    launch?: LaunchOptions;
}

/** One expression as Desmos sees it: what was sent, and what came back. */
export interface InspectedExpression {
    /** Its position in the compiled list, which is how a test names it. */
    index: number;
    id: string;
    type: NonNullable<ExpressionState['type']>;
    latex?: string;
    /** A folder's name. */
    title?: string;
    /** A note's contents. */
    text?: string;
    /** Absent for anything Desmos does not analyze — folders, notes, tables. */
    analysis?: ExpressionAnalysis;
}

/** An expression Desmos rejected, in the shape an error report wants. */
export interface ExpressionError {
    index: number;
    id: string;
    latex?: string;
    message: string;
}

/** Everything worth knowing about the loaded graph, in one object. */
export interface Inspection {
    expressions: InspectedExpression[];
    errors: ExpressionError[];
    analysis: Record<string, ExpressionAnalysis>;
    state: GraphState;
    /** Console errors and uncaught exceptions the page raised, if any. */
    consoleErrors: string[];
}

/** What `evaluate` got back. Both are present; the unusable one is empty. */
export interface EvaluatedValue {
    numericValue: number;
    listValue: number[];
}

export interface LoadOptions extends CompileOptions {
    /** Applied over any `config { … }` block the script compiled to. */
    settings?: CalculatorOptions;
}

/** A live headless Desmos calculator. Close it when the test is done. */
export class AxisCalculator {
    readonly page: Page;
    private readonly options: Required<Pick<AxisCalculatorOptions, 'timeout' | 'quietMs'>>;
    private readonly errors: string[] = [];
    private closed = false;

    private constructor(page: Page, timeout: number, quietMs: number) {
        this.page = page;
        this.options = { timeout, quietMs };

        page.on('pageerror', error => this.errors.push(String(error)));
        page.on('console', message => {
            if (message.type() === 'error') {
                this.errors.push(message.text());
            }
        });
    }

    /** Launch a calculator and wait for Desmos to be ready to answer. */
    static async create(options: AxisCalculatorOptions = {}): Promise<AxisCalculator> {
        const timeout = options.timeout ?? 30_000;
        const browser: Browser = await acquireBrowser({
            headless: options.headless ?? true,
            ...options.launch,
        });

        let page: Page | undefined;
        try {
            page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
            const routing = await installRouting(page, {
                apiKey: options.apiKey ?? DESMOS_DEMO_API_KEY,
                offline: options.offline,
            });

            await page.goto(HARNESS_URL, { timeout });

            try {
                await page.waitForFunction(() => !!window.Desmos, undefined, { timeout });
            } catch (error) {
                throw new Error(
                    routing.scriptFailure ??
                        `The Desmos calculator did not load within ${timeout}ms: ${String(error)}`,
                );
            }

            await page.evaluate(
                ([settings, viewport]) => {
                    const container = document.getElementById('calculator')!;
                    const calculator = window.Desmos!.GraphingCalculator(container, settings);
                    calculator.setMathBounds(viewport);

                    const harness = { calculator, lastChange: Date.now() };
                    window.__axisHarness = harness;

                    // Two signals, because they fire for different things: the
                    // event covers edits to the graph, the observer covers the
                    // asynchronous recompute that follows one.
                    const touch = () => {
                        harness.lastChange = Date.now();
                    };
                    calculator.observeEvent('change', touch);
                    calculator.observe('expressionAnalysis', touch);
                },
                [
                    (options.settings ?? {}) as CalculatorOptions,
                    { ...DEFAULT_VIEWPORT, ...options.viewport } as MathBounds,
                ] as const,
            );

            const calculator = new AxisCalculator(page, timeout, options.quietMs ?? 200);
            await calculator.settle();
            return calculator;
        } catch (error) {
            await page?.close().catch(() => undefined);
            await releaseBrowser();
            throw error;
        }
    }

    /** Compile `source` and apply it. The compilation result is handed back. */
    async load(source: string, options: LoadOptions = {}): Promise<CompilationResult> {
        const compiled = compileAxis(source, options);
        await this.setExpressions(compiled.expressions, {
            ...compiled.settings,
            ...options.settings,
        });
        return compiled;
    }

    /**
     * Apply expressions directly, for a test that has them already or is
     * checking something the Axis syntax cannot express.
     */
    async setExpressions(
        expressions: DesmosExpression[],
        settings?: CalculatorOptions,
    ): Promise<void> {
        await this.page.evaluate(
            ([list, options]) => {
                const { calculator } = window.__axisHarness!;
                // setState, not setExpressions: folder membership only travels
                // as part of a whole graph state.
                const bounds = calculator.graphpaperBounds.mathCoordinates;
                calculator.setState({
                    version: 11,
                    graph: {
                        viewport: {
                            xmin: bounds.left,
                            xmax: bounds.right,
                            ymin: bounds.bottom,
                            ymax: bounds.top,
                        },
                    },
                    expressions: { list },
                });
                // updateSettings has to follow setState, which resets them.
                if (options) {
                    calculator.updateSettings(options);
                }
            },
            [expressions as ExpressionState[], settings ?? null] as const,
        );
        await this.settle();
    }

    /** Clear the graph back to empty. */
    async reset(): Promise<void> {
        await this.page.evaluate(() => window.__axisHarness!.calculator.setBlank());
        await this.settle();
    }

    /**
     * Wait until the calculator has stopped changing. Every mutating method
     * already does this, so a test only needs it after driving the page itself.
     */
    async settle(quietMs = this.options.quietMs): Promise<void> {
        await this.page.waitForFunction(
            quiet => Date.now() - window.__axisHarness!.lastChange >= quiet,
            quietMs,
            { timeout: this.options.timeout, polling: 50 },
        );
    }

    async getState(): Promise<GraphState> {
        return this.page.evaluate(() => window.__axisHarness!.calculator.getState());
    }

    async getExpressions(): Promise<ExpressionState[]> {
        return this.page.evaluate(() => window.__axisHarness!.calculator.getExpressions());
    }

    async getSettings(): Promise<CalculatorOptions> {
        // `settings` is a live observable object, so it is copied on the way
        // out — Playwright can only serialize plain data.
        return this.page.evaluate(() => ({ ...window.__axisHarness!.calculator.settings }));
    }

    /** Desmos' verdict on every expression, keyed by expression id. */
    async getAnalysis(): Promise<Record<string, ExpressionAnalysis>> {
        return this.page.evaluate(() => ({
            ...window.__axisHarness!.calculator.expressionAnalysis,
        }));
    }

    /** The expression list with each expression's analysis attached. */
    async inspectExpressions(): Promise<InspectedExpression[]> {
        const [expressions, analysis] = await Promise.all([
            this.getExpressions(),
            this.getAnalysis(),
        ]);
        return expressions.map((expression, index) => ({
            index,
            id: expression.id ?? String(index),
            type: expression.type ?? 'expression',
            latex: 'latex' in expression ? expression.latex : undefined,
            title: 'title' in expression ? expression.title : undefined,
            text: 'text' in expression ? expression.text : undefined,
            analysis: expression.id ? analysis[expression.id] : undefined,
        }));
    }

    /** Every expression Desmos rejected. An empty array means a valid graph. */
    async getErrors(): Promise<ExpressionError[]> {
        const expressions = await this.inspectExpressions();
        return expressions
            .filter(expression => expression.analysis?.isError)
            .map(({ index, id, latex, analysis }) => ({
                index,
                id,
                latex,
                message: analysis?.errorMessage ?? 'Desmos reported an error',
            }));
    }

    /**
     * Evaluate `latex` against the loaded graph, so a test can assert on what a
     * function or a slider-driven definition actually comes out to.
     */
    async evaluate(latex: string, timeout = 2000): Promise<EvaluatedValue> {
        return this.page.evaluate(
            async ([expression, wait]) => {
                const helper = window.__axisHarness!.calculator.HelperExpression({
                    latex: expression,
                });

                // A helper's value arrives asynchronously, and never arrives at
                // all for an expression that does not evaluate — so the wait is
                // bounded and an unevaluated helper reports NaN, as Desmos does.
                await new Promise<void>(resolve => {
                    let settled = false;
                    const done = () => {
                        if (!settled) {
                            settled = true;
                            resolve();
                        }
                    };
                    helper.observe('numericValue', done);
                    helper.observe('listValue', done);
                    setTimeout(done, wait);
                });

                return {
                    numericValue: helper.numericValue,
                    listValue: helper.listValue ?? [],
                };
            },
            [latex, timeout] as const,
        );
    }

    async updateSettings(settings: CalculatorOptions): Promise<void> {
        await this.page.evaluate(
            options => window.__axisHarness!.calculator.updateSettings(options),
            settings,
        );
        await this.settle();
    }

    async setMathBounds(bounds: MathBounds): Promise<void> {
        await this.page.evaluate(
            value => window.__axisHarness!.calculator.setMathBounds(value),
            bounds,
        );
        await this.settle();
    }

    /** A PNG (or SVG) data URI of the graphpaper alone. */
    async screenshot(options: AsyncScreenshotOptions = {}): Promise<string> {
        return this.page.evaluate(
            screenshotOptions =>
                new Promise<string>(resolve =>
                    window.__axisHarness!.calculator.asyncScreenshot(screenshotOptions, resolve),
                ),
            options,
        );
    }

    /** Console errors and uncaught exceptions the page has raised so far. */
    consoleErrors(): string[] {
        return [...this.errors];
    }

    /** State, expressions, analysis and errors in one round trip. */
    async inspect(): Promise<Inspection> {
        const [expressions, analysis, state] = await Promise.all([
            this.inspectExpressions(),
            this.getAnalysis(),
            this.getState(),
        ]);
        return {
            expressions,
            errors: expressions
                .filter(expression => expression.analysis?.isError)
                .map(({ index, id, latex, analysis: result }) => ({
                    index,
                    id,
                    latex,
                    message: result?.errorMessage ?? 'Desmos reported an error',
                })),
            analysis,
            state,
            consoleErrors: this.consoleErrors(),
        };
    }

    /** Close the page, and the shared browser if this was the last calculator. */
    async close(): Promise<void> {
        if (this.closed) {
            return;
        }
        this.closed = true;
        await this.page.close().catch(() => undefined);
        await releaseBrowser();
    }
}

/** Launch a calculator. Pair it with `close()`, usually in an `after` hook. */
export function createCalculator(options?: AxisCalculatorOptions): Promise<AxisCalculator> {
    return AxisCalculator.create(options);
}

/** Launch a calculator for the length of one callback, then close it. */
export async function withCalculator<T>(
    body: (calculator: AxisCalculator) => Promise<T>,
    options?: AxisCalculatorOptions,
): Promise<T> {
    const calculator = await AxisCalculator.create(options);
    try {
        return await body(calculator);
    } finally {
        await calculator.close();
    }
}
