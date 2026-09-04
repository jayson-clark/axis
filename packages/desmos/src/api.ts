// ═════════════════════════════════════════════════════════════════════════════
// Desmos runtime API — the `Desmos` global and the calculator instance
// @see https://www.desmos.com/api/v1.12/docs/index.html
// ═════════════════════════════════════════════════════════════════════════════

import {
    CalculatorOptions,
    FourFunctionCalculatorOptions,
    ScientificCalculatorOptions,
} from './calculator';
import {
    ExpressionState,
    TickerState,
    LineStyle,
    PointStyle,
    DragMode,
    LabelOrientation,
    AxisArrowMode,
} from './expressions';

/** Anything with observable properties exposes `observe`/`unobserve`. */
export interface Observable {
    observe(property: string, callback: () => void): void;
    unobserve(property: string): void;
}

export interface MathBounds {
    left: number;
    right: number;
    bottom: number;
    top: number;
}

export interface GraphpaperBounds {
    mathCoordinates: MathBounds & { width: number; height: number };
    pixelCoordinates: {
        top: number;
        bottom: number;
        left: number;
        right: number;
        width: number;
        height: number;
    };
}

export interface Point {
    x: number;
    y: number;
}

export interface ExpressionAnalysis {
    isGraphable: boolean;
    isError: boolean;
    errorMessage?: string;
    evaluationDisplayed?: boolean;
    evaluation?: { type: 'Number'; value: number } | { type: 'ListOfNumber'; value: number[] };
}

/**
 * The viewport rectangle, the way a graph state spells it.
 *
 * Not {@link MathBounds}: `setMathBounds` takes `left`/`right`/`bottom`/`top`,
 * while the state — and so anything read off `getState()` or written into
 * `setState` — says `xmin`/`xmax`/`ymin`/`ymax` for the same rectangle.
 */
export interface Viewport {
    xmin?: number;
    xmax?: number;
    ymin?: number;
    ymax?: number;
}

/**
 * The settings that live in a graph's state rather than in its calculator's
 * options — the ones `updateSettings` has no say over.
 *
 * `updateSettings({ xmin: 0 })` is not an error; it is silently nothing, since
 * the viewport belongs to the graph. A host that wants these applied has to put
 * them in a `setState`, or call `setMathBounds`.
 */
export interface GraphSettings {
    viewport?: Viewport;
    /** One x unit drawn the same length as one y unit. Desmos defaults to true. */
    squareAxes?: boolean;
    /**
     * The viewport lock the graph's own settings menu sets, which pins the
     * framing for anybody who opens it. Not `lockViewport`: that is a
     * calculator option the embedder chooses, and it is not part of the state.
     */
    userLockedViewport?: boolean;
}

/**
 * The settings Desmos keeps at the very top of a graph state, outside both
 * `graph` and the calculator options.
 *
 * A third place for a setting to live sounds like one too many, but Desmos
 * really does have three, and this one is the strictest of them: these keys are
 * read off the state as `setState` applies it and nowhere else. Neither
 * `updateSettings` nor a `Desmos.GraphingCalculator` option nor a key tucked
 * inside `graph` has any effect — each is accepted in silence and ignored.
 */
export interface GraphStateFlags {
    /**
     * Mix a function's arguments into the seed of a bare `random()` inside its
     * definition, so `h(1)` and `h(2)` draw differently.
     *
     * False, and absent, are Desmos' "legacy randomization behavior": every
     * call to the function returns the identical draw no matter its arguments.
     * The editor offers a button to migrate a graph off it, and that button
     * writes exactly this key.
     *
     * @see https://help.desmos.com/hc/en-us/articles/25261997911181-Random
     */
    includeFunctionParametersInRandomSeed?: boolean;
}

export interface GraphState extends GraphStateFlags {
    version: number;
    graph?: GraphSettings & { [key: string]: unknown };
    expressions?: { list?: ExpressionState[]; ticker?: TickerState };
    randomSeed?: string;
    [key: string]: unknown;
}

export interface SetStateOptions {
    allowUndo?: boolean;
    remapColors?: boolean;
}

export interface ScreenshotOptions {
    width?: number;
    height?: number;
    targetPixelRatio?: number;
    preserveAxisNumbers?: boolean;
}

export interface AsyncScreenshotOptions extends ScreenshotOptions {
    format?: 'png' | 'svg';
    mode?: 'contain' | 'stretch' | 'preserveX' | 'preserveY';
    mathBounds?: Partial<MathBounds>;
    showLabels?: boolean;
}

/** A non-visible expression whose value can be observed. */
export interface HelperExpression extends Observable {
    readonly numericValue: number;
    readonly listValue: number[];
}

/** Global event names accepted by `observeEvent`. */
export type CalculatorEvent = 'change' | 'graphReset' | string;

/**
 * A live `Desmos.GraphingCalculator` instance.
 * @see https://www.desmos.com/api/v1.12/docs/index.html#document-manipulating-expressions
 */
export interface Calculator extends Observable {
    // Expressions
    setExpression(state: ExpressionState): void;
    setExpressions(states: ExpressionState[]): void;
    removeExpression(state: { id: string }): void;
    removeExpressions(states: { id: string }[]): void;
    getExpressions(): ExpressionState[];
    readonly expressionAnalysis: Record<string, ExpressionAnalysis>;
    HelperExpression(state: { latex: string }): HelperExpression;

    // State
    getState(): GraphState;
    setState(state: GraphState, options?: SetStateOptions): void;
    setBlank(options?: SetStateOptions): void;
    setDefaultState(state: GraphState): void;
    undo(): void;
    redo(): void;
    clearHistory(): void;
    withHistoryReplacement(callback: () => void): void;

    // Settings
    updateSettings(settings: CalculatorOptions): void;
    /** @deprecated Use `updateSettings`. */
    setGraphSettings(settings: CalculatorOptions): void;
    readonly settings: CalculatorOptions & Observable;
    newRandomSeed(): void;

    // Viewport
    setMathBounds(bounds: MathBounds): void;
    readonly graphpaperBounds: GraphpaperBounds;
    mathToPixels(coords: Partial<Point>): Partial<Point>;
    pixelsToMath(coords: Partial<Point>): Partial<Point>;
    resize(): void;

    // Selection & focus
    focusFirstExpression(): void;
    /** @deprecated Prefer the `keypadActivated` option. */
    openKeypad(): void;
    readonly isAnyExpressionSelected: boolean;
    readonly selectedExpressionId: string | undefined;
    /** New in v1.12. Selects an expression as though the user clicked it. */
    setSelectedExpressionId(id: string): void;
    removeSelected(): string | undefined;

    // Audio trace — new in v1.12
    /** Opens the audio-trace keypad for the selected expression. */
    enterAudioTrace(): void;
    exitAudioTrace(): void;
    /** Observable. True while audio trace mode is active. */
    readonly isAudioTraceActive: boolean;

    // Screenshots
    screenshot(options?: ScreenshotOptions): string;
    asyncScreenshot(options: AsyncScreenshotOptions, callback: (dataUri: string) => void): void;
    asyncScreenshot(callback: (dataUri: string) => void): void;

    // Events & lifecycle
    observeEvent(event: CalculatorEvent, callback: () => void): void;
    unobserveEvent(event: CalculatorEvent): void;
    isProjectorMode(): boolean;
    destroy(): void;
}

/** The four function and scientific calculators expose a subset of `Calculator`. */
export interface BasicCalculator extends Observable {
    getState(): GraphState;
    setState(state: GraphState, options?: SetStateOptions): void;
    setBlank(options?: SetStateOptions): void;
    undo(): void;
    redo(): void;
    clearHistory(): void;
    resize(): void;
    focusFirstExpression(): void;
    updateSettings(options: FourFunctionCalculatorOptions & ScientificCalculatorOptions): void;
    observeEvent(event: CalculatorEvent, callback: () => void): void;
    unobserveEvent(event: CalculatorEvent): void;
    destroy(): void;
}

/** Which constructors the current API key is licensed for. */
export interface DesmosEnabledFeatures {
    GraphingCalculator: boolean;
    FourFunctionCalculator: boolean;
    ScientificCalculator: boolean;
    Calculator3D?: boolean;
    Geometry?: boolean;
    [feature: string]: boolean | undefined;
}

/** The `window.Desmos` global installed by `calculator.js`. */
export interface DesmosNamespace {
    GraphingCalculator(element: HTMLElement, options?: CalculatorOptions): Calculator;
    FourFunctionCalculator(
        element: HTMLElement,
        options?: FourFunctionCalculatorOptions,
    ): BasicCalculator;
    ScientificCalculator(
        element: HTMLElement,
        options?: ScientificCalculatorOptions,
    ): BasicCalculator;
    imageFileToDataURL(file: File, cb: (err: unknown, dataURL?: string) => void): void;
    supportedLanguages: string[];
    enabledFeatures: DesmosEnabledFeatures;
    Colors: Record<'RED' | 'BLUE' | 'GREEN' | 'PURPLE' | 'ORANGE' | 'BLACK', string>;
    Styles: Record<keyof typeof PointStyle | keyof typeof LineStyle, string>;
    DragModes: Record<keyof typeof DragMode, string>;
    LabelOrientations: Record<keyof typeof LabelOrientation, string>;
    AxisArrowModes: Record<keyof typeof AxisArrowMode, string>;
    FontSizes: Record<string, number>;
    /** @deprecated Split into the boolean `points`/`lines` column properties. */
    ColumnModes: Record<string, string>;
}
