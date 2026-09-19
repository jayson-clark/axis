// ═════════════════════════════════════════════════════════════════════════════
// The viewer protocol
// ═════════════════════════════════════════════════════════════════════════════
//
// The viewer is a display surface driven entirely by these messages — it has no
// other way in. Every host speaks them: the extension's preview server over an
// HTTP event stream, the playground over an in-memory channel. One path means a
// feature is built once and every host gets it.

import type {
    CalculatorOptions,
    DesmosExpression,
    GraphSettings,
    GraphStateFlags,
    TickerState,
} from '@axis-dsl/desmos';

/** Host → viewer. */
export type ViewerMessage =
    | {
          command: 'init';
          data: {
              desmosApiKey: string;
              /**
               * Whether this host can act on `requestApiKey`. The viewer only
               * offers the affordance when someone is listening: the extension
               * opens VSCode settings, while a host with a key baked in has
               * nowhere to put one.
               */
              canSetApiKey?: boolean;
          };
      }
    | {
          command: 'setExpressions';
          data: {
              expressions: DesmosExpression[];
              settings?: CalculatorOptions;
              /**
               * The viewport and `squareAxes`, which reach the calculator
               * through its state rather than through `updateSettings`.
               */
              graph?: GraphSettings;
              /**
               * The flags Desmos reads off the top of a graph state, outside
               * `graph` — `includeFunctionParametersInRandomSeed` and any
               * later sibling.
               */
              state?: GraphStateFlags;
              /** The graph's ticker, which reaches it the same way. */
              ticker?: TickerState;
          };
      }
    /** Free text shown in the tab strip — a count, "Compiling…", null to clear. */
    | { command: 'setStatus'; data: { status: string | null } }
    /**
     * Whether to watch the graph for changes the user makes to it by hand and
     * report them back with `graphChanged`.
     *
     * Off unless a host asks, and deliberately so: watching means every drag,
     * every recolour and every pan comes back over this wire, and a host that
     * has nowhere to put them would only be paying for them. A host that does -
     * one with the script the graph was compiled from - switches it on.
     */
    | { command: 'setSync'; data: { enabled: boolean } };

/**
 * A graph as the calculator holds it, in the four parts Desmos keeps it in.
 *
 * The same shape `setExpressions` carries, because it is the same thing going
 * the other way: what the host sent, and what the graph became.
 */
export interface GraphReading {
    expressions: DesmosExpression[];
    settings?: CalculatorOptions;
    graph?: GraphSettings;
    state?: GraphStateFlags;
    ticker?: TickerState;
}

/** Viewer → host. */
export type HostMessage =
    /** Sent on mount. The host answers with `init` and the current expressions. */
    | { command: 'ready' }
    /** Sent only to a host that set `canSetApiKey`; only it knows where one goes. */
    | { command: 'requestApiKey' }
    /**
     * The user changed the graph by hand — dragged a point, moved a slider,
     * recoloured something, panned. Sent only while `setSync` is on.
     *
     * Both readings travel, and both are needed. `before` is the graph as the
     * calculator handed it back immediately after the host's expressions were
     * applied, `after` is the graph now, and the difference between them is
     * exactly what the user did. Comparing against what the host *sent* would
     * not do: Desmos normalises what it is given, leaving a property off the
     * state where it matches its own default, so every expression would look
     * changed the moment the graph loaded.
     */
    | { command: 'graphChanged'; data: { before: GraphReading; after: GraphReading } };

export type AxisMessage = ViewerMessage | HostMessage;
