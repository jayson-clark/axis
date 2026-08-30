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
    min: string | number;
    max: string | number;
    step?: string | number;
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
    lineStyle?: LineStyle | string;
    lineWidth?: number | string;
    lineOpacity?: number | string;
    pointStyle?: PointStyle | string;
    pointSize?: number | string;
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
    parametricDomain?: DomainBounds;
    polarDomain?: DomainBounds;
    dragMode?: DragMode | string;
    label?: string;
    showLabel?: boolean;
    labelSize?: string;
    labelOrientation?: LabelOrientation | string;
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

export type ExpressionState = Expression | Table | Note | Folder;

export type DesmosExpression = ExpressionState;
