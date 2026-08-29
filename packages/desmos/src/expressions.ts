// ═════════════════════════════════════════════════════════════════════════════
// Desmos Expression Types and Enums
// @see https://www.desmos.com/api/v1.12/docs/index.html#document-manipulating-expressions
// ═════════════════════════════════════════════════════════════════════════════

// Enums

export enum LineStyle {
    SOLID = 'solid',
    DASHED = 'dashed',
    DOTTED = 'dotted',
}

export enum PointStyle {
    POINT = 'point',
    OPEN = 'open',
    CROSS = 'cross',
    SQUARE = 'square',
    PLUS = 'plus',
    TRIANGLE = 'triangle',
    DIAMOND = 'diamond',
    STAR = 'star',
}

export enum DragMode {
    AUTO = 'auto',
    X = 'x',
    Y = 'y',
    XY = 'xy',
    NONE = 'none',
}

export enum LabelOrientation {
    DEFAULT = 'default',
    ABOVE = 'above',
    BELOW = 'below',
    LEFT = 'left',
    RIGHT = 'right',
}

export enum AxisArrowMode {
    NONE = 'none',
    POSITIVE = 'positive',
    BOTH = 'both',
}

// Interfaces

export interface DomainBounds {
    min: string | number;
    max: string | number;
}

export interface SliderBounds {
    /**
     * An end left out is the one Desmos assumes, which is how it stores a
     * slider whose author only moved the other end.
     */
    min?: string | number;
    max?: string | number;
    step?: string | number;
    /**
     * Whether the bound is a limit rather than just the initial range. Axis
     * defaults both to true, which is not Desmos' own default — see
     * {@link SliderState}.
     */
    hardMin?: boolean;
    hardMax?: boolean;
}

/**
 * A slider as the graph state carries it — which is not how `setExpression`
 * takes one. The API accepts `sliderBounds` and `playing`; the serialized state
 * this object belongs to spells the same thing `slider`, with the bounds as
 * latex strings and `hardMin`/`hardMax` marking a bound the user cannot drag
 * past. Anything applied with `setState` has to be written this way, and
 * `setState` is what carries folder membership, so it is the form Axis emits.
 */
export interface SliderState {
    min?: string;
    max?: string;
    step?: string;
    /** Whether `min`/`max` are limits rather than just the initial range. */
    hardMin?: boolean;
    hardMax?: boolean;
    isPlaying?: boolean;
    loopMode?: 'LOOP_FORWARD_REVERSE' | 'LOOP_FORWARD' | 'PLAY_ONCE' | 'PLAY_INDEFINITELY';
    playDirection?: 1 | -1;
    /** How long one sweep of the slider takes, in milliseconds. */
    animationPeriod?: number;
}

export interface TableColumn {
    id?: string;
    latex: string;
    values?: string[];
    color?: string;
    hidden?: boolean;
    lineStyle?: LineStyle | string;
    pointStyle?: PointStyle | string;
    lineWidth?: number | string;
    lineOpacity?: number | string;
    pointSize?: number | string;
    /** How large the point is drawn while it is draggable. */
    movablePointSize?: number | string;
    pointOpacity?: number | string;
    lines?: boolean;
    points?: boolean;
    dragMode?: DragMode | string;
}

/**
 * Makes an expression clickable. Desmos runs `latex` (an action, e.g.
 * `a\\to a+1`) each time the object is clicked.
 *
 * State-only: it round-trips through `getState`/`setState`, not `setExpression`.
 * @see https://help.desmos.com/hc/en-us/articles/4406895312781-Clickable-Objects
 */
export interface ClickableInfo {
    enabled?: boolean;
    /** The action to run on click. */
    latex?: string;
    /** Screen-reader description of what clicking does. */
    description?: string;
}

export interface Expression {
    type?: 'expression';
    latex?: string;
    id?: string;
    color?: string;
    /** A color from an expression - `rgb(…)`, or a list for a list of colors. */
    colorLatex?: string;
    lineStyle?: LineStyle | string;
    lineWidth?: number | string;
    lineOpacity?: number | string;
    pointStyle?: PointStyle | string;
    pointSize?: number | string;
    /**
     * How large the point is drawn while it is draggable. Desmos sizes a
     * movable point from this rather than from `pointSize`, so a graph that
     * sets one and not the other changes size the moment it becomes draggable.
     */
    movablePointSize?: number | string;
    pointOpacity?: number | string;
    fillOpacity?: number | string;
    points?: boolean;
    lines?: boolean;
    fill?: boolean;
    hidden?: boolean;
    secret?: boolean;
    /** `setExpression` only — `setState` ignores it. See {@link SliderState}. */
    sliderBounds?: SliderBounds;
    /** `setExpression` only — `setState` ignores it. See {@link SliderState}. */
    playing?: boolean;
    /** Slider range and animation, as `setState` takes them. */
    slider?: SliderState;
    /**
     * The range of the parameter a parametric or polar curve is drawn over.
     *
     * Desmos keeps two copies of the same bounds: `domain` is what it reads,
     * and `parametricDomain` is the older key it still writes beside it. They
     * hold the same thing, except that `parametricDomain` says "the default"
     * with an empty string where `domain` writes the default out.
     */
    domain?: DomainBounds;
    parametricDomain?: DomainBounds;
    polarDomain?: DomainBounds;
    dragMode?: DragMode | string;
    label?: string;
    showLabel?: boolean;
    labelSize?: string;
    labelOrientation?: LabelOrientation | string;
    /** Drop the outline Desmos draws behind a label. */
    suppressTextOutline?: boolean;
    /** Draw a ring around each point, in the graph's background colour. */
    pointOutline?: boolean;
    folderId?: string;
    /** Click action. Applied via `setState`; `setExpression` ignores it. */
    clickableInfo?: ClickableInfo;
    /** Accessibility description, read out for clickable objects. */
    description?: string;
}

export interface Table {
    type: 'table';
    columns: TableColumn[];
    id?: string;
    folderId?: string;
}

export interface Note {
    type: 'text';
    text?: string;
    id?: string;
    folderId?: string;
}

export interface Folder {
    type: 'folder';
    id: string;
    title?: string;
    collapsed?: boolean;
    hidden?: boolean;
    secret?: boolean;
}

/**
 * The graph's ticker: one action, run over and over while the ticker plays.
 *
 * State-only, and not part of the expression *list* — Desmos keeps it beside
 * the list, under `expressions.ticker`, so it travels through `setState` and
 * nothing else. There is exactly one per graph.
 *
 * Desmos normalises what it is given here as it does everywhere else: `open`
 * and `playing` are written by leaving them off rather than storing `false`,
 * and a ticker with no handler at all comes back as no ticker.
 *
 * @see https://help.desmos.com/hc/en-us/articles/8459434454669-Tickers
 */
export interface TickerState {
    /** The action to run on each tick, as latex - `a\\to a+1`. */
    handlerLatex?: string;
    /**
     * The shortest gap between two ticks, in milliseconds, as latex. Desmos
     * ticks once a frame when this is 0 or absent, and the handler can read the
     * gap it actually got as `dt`.
     */
    minStepLatex?: string;
    /** Whether the ticker starts running as soon as the graph opens. */
    playing?: boolean;
    /** Whether the ticker's row sits expanded in the expression list. */
    open?: boolean;
}

/**
 * An image placed on the graphpaper.
 *
 * Everything but the URL is latex, because every one of them may be an
 * expression: an image can be centred on a point the graph computes, sized by a
 * slider, and rotated as it animates.
 *
 * @see https://help.desmos.com/hc/en-us/articles/4405633787533-Images
 */
export interface GraphImage {
    type: 'image';
    id?: string;
    folderId?: string;
    /** The image itself, as a `data:` URI or an address Desmos may fetch. */
    image_url?: string;
    /** The caption shown in the expression list. */
    name?: string;
    width?: string;
    height?: string;
    /** The point the image is centred on, as latex - `\left(0,0\right)`. */
    center?: string;
    angle?: string;
    opacity?: string;
    /** Whether the image is drawn over the graph rather than under it. */
    foreground?: boolean;
    /** Whether the image ignores clicks aimed at what is behind it. */
    clickableInfo?: ClickableInfo;
    hidden?: boolean;
    secret?: boolean;
    dragMode?: DragMode | string;
}

export type ExpressionState = Expression | Table | Note | Folder | GraphImage;

export type DesmosExpression = ExpressionState;
