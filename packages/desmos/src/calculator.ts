// ═════════════════════════════════════════════════════════════════════════════
// Desmos Calculator Options
// @see https://www.desmos.com/api/v1.12/docs/index.html#document-calculator
// ═════════════════════════════════════════════════════════════════════════════

import { AxisArrowMode } from './expressions';

/** A 3- or 6-character hex color, e.g. `#cde` or `#ffaaaa`. */
export type HexColor = string;

/**
 * Called when a user uploads an image. Serialize `file` somewhere publicly
 * reachable, then call `cb(null, url)` — or `cb(err)` on failure.
 * @see https://www.desmos.com/api/v1.12/docs/index.html#document-image-uploads
 */
export type ImageUploadCallback = (file: File, cb: (err: unknown, url?: string) => void) => void;

/**
 * Options shared by the graphing, four function, and scientific calculators.
 * `backgroundColor`, `textColor`, and `accentColor` are marked Beta by Desmos
 * as of v1.12 — they are a work in progress and may change.
 */
export interface CommonCalculatorOptions {
    links?: boolean;
    fontSize?: number;
    invertedColors?: boolean;
    /** New in v1.12. When false, hides the "Reverse Contrast" checkbox. */
    invertedColorsControl?: boolean;
    /** Beta, new in v1.12. */
    backgroundColor?: HexColor;
    /** Beta, new in v1.12. */
    textColor?: HexColor;
    /** Beta, new in v1.12. */
    accentColor?: HexColor;
    settingsMenu?: boolean;
    language?: string;
    brailleMode?: 'none' | 'nemeth' | 'ueb';
    sixKeyInput?: boolean;
    projectorMode?: boolean;
    decimalToFraction?: boolean;
    capExpressionSize?: boolean;
}

export interface CalculatorOptions extends CommonCalculatorOptions {
    // Configuration Options
    graphpaper?: boolean;
    expressions?: boolean;
    zoomButtons?: boolean;
    keypad?: boolean;
    keypadActivated?: boolean;
    showResetButtonOnGraphpaper?: boolean;
    expressionsTopbar?: boolean;
    pointsOfInterest?: boolean;
    trace?: boolean;
    border?: boolean;
    lockViewport?: boolean;
    expressionsCollapsed?: boolean;
    authorFeatures?: boolean;
    /** Reveal the contents of secret folders. Documented under Author Features. */
    administerSecretFolders?: boolean;
    images?: boolean;
    imageUploadCallback?: ImageUploadCallback;
    folders?: boolean;
    notes?: boolean;
    sliders?: boolean;
    actions?: boolean | 'auto';
    substitutions?: boolean;
    qwertyKeyboard?: boolean;
    distributions?: boolean;
    restrictedFunctions?: boolean;
    forceEnableGeometryFunctions?: boolean;
    /** New in v1.12. When false, derivatives and integrals are disabled. */
    calculus?: boolean;
    pasteGraphLink?: boolean;
    /** Pauses animations behind an opt-in cover for `prefers-reduced-motion`. */
    showReducedMotionCover?: boolean;
    pasteTableData?: boolean;
    /**
     * Instantiation only. As of v1.12 this defaults to match `degreeMode`
     * rather than to `false`.
     */
    clearIntoDegreeMode?: boolean;
    colors?: Record<string, string>;
    autosize?: boolean;
    plotInequalities?: boolean;
    plotImplicits?: boolean;
    plotSingleVariableImplicitEquations?: boolean;
    brailleControls?: boolean;
    audio?: boolean;
    graphDescription?: string;
    zoomFit?: boolean;
    forceLogModeRegressions?: boolean;
    defaultLogModeRegressions?: boolean;
    customRegressions?: boolean;
    regressionTemplates?: boolean;
    logScales?: boolean;
    tone?: boolean;
    intervalComprehensions?: boolean;
    muted?: boolean;
    allowComplex?: boolean;
    reportPosition?: 'default' | 'coordinates' | 'percents';
    showEvaluationCopyButtons?: boolean;
    onEvaluationCopyClick?: (latex: string) => void;
    recursion?: boolean;

    // Graph Settings
    degreeMode?: boolean;
    showGrid?: boolean;
    polarMode?: boolean;
    showXAxis?: boolean;
    showYAxis?: boolean;
    xAxisNumbers?: boolean;
    yAxisNumbers?: boolean;
    polarNumbers?: boolean;
    xAxisStep?: number;
    yAxisStep?: number;
    xAxisMinorSubdivisions?: number;
    yAxisMinorSubdivisions?: number;
    xAxisArrowMode?: AxisArrowMode | string;
    yAxisArrowMode?: AxisArrowMode | string;
    xAxisLabel?: string;
    yAxisLabel?: string;
    xAxisScale?: 'linear' | 'logarithmic';
    yAxisScale?: 'linear' | 'logarithmic';
    randomSeed?: string;
}

/**
 * @see https://www.desmos.com/api/v1.12/docs/index.html#document-basic-calculators
 */
export interface FourFunctionCalculatorOptions extends CommonCalculatorOptions {
    /** One or two of 'exponent' | 'percent' | 'fraction' | 'sqrt'. */
    additionalFunctions?: string | string[];
    /** New in v1.12. Restricts numbers to 0 or magnitude in [1e-7, 1e8). */
    limitNumberScale?: boolean;
}

export interface ScientificCalculatorOptions extends CommonCalculatorOptions {
    qwertyKeyboard?: boolean;
    degreeMode?: boolean;
    /** Export a Braille rendering of the expression list. */
    brailleExpressionDownload?: boolean;
    /** Allow function definition, i.e. `f(x) = 2x`. */
    functionDefinition?: boolean;
    autosize?: boolean;
    allowComplex?: boolean;
}
