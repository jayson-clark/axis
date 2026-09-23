// ═════════════════════════════════════════════════════════════════════════════
// The viewer protocol
// ═════════════════════════════════════════════════════════════════════════════
//
// The viewer is a display surface driven entirely by these messages — it has no
// other way in. Every host speaks them: the extension's preview server over an
// HTTP event stream, the playground over an in-memory channel. One path means a
// feature is built once and every host gets it.

import type { CalculatorOptions, GraphState } from '@axis-dsl/desmos';

/**
 * A graph as a host hands it over: the payload of `setGraph`, and what the
 * compiler produces.
 *
 * Applied as `calculator.setState(state)` followed by
 * `calculator.updateSettings(options)`, in that order - `setState` resets the
 * calculator's settings, so the other way round would lose them.
 */
export interface ViewerGraph {
    state: GraphState;
    options: CalculatorOptions;
}

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
    /**
     * The graph to show, whole: what `setState` takes and what
     * `updateSettings` takes, and nothing a host has to assemble first.
     *
     * Two fields because Desmos has exactly two ways in, and a setting given to
     * the wrong one is ignored without complaint - the viewport and the
     * top-level state flags only take through `setState`, the calculator
     * options only through `updateSettings`. Everything else the graph is made
     * of, the ticker and the expression list included, is part of `state`.
     */
    | { command: 'setGraph'; data: ViewerGraph }
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
 * A graph as the calculator holds it: `calculator.getState()` and a copy of
 * the live `calculator.settings` - the same two halves a {@link ViewerGraph}
 * is applied as, read back the other way.
 *
 * The shape `writeBackGraph` in `@axis-dsl/compiler` reads. It is kept whole
 * rather than split up, because what the state holds is exactly what the
 * compiler lowered to - so the write-back can compare the two readings in the
 * terms it wrote them in.
 */
export interface GraphReading {
    state: GraphState;
    options: CalculatorOptions;
}

/** Viewer → host. */
export type HostMessage =
    /** Sent on mount. The host answers with `init` and the current graph. */
    | { command: 'ready' }
    /** Sent only to a host that set `canSetApiKey`; only it knows where one goes. */
    | { command: 'requestApiKey' }
    /**
     * The user changed the graph by hand — dragged a point, moved a slider,
     * recoloured something, panned. Sent only while `setSync` is on.
     *
     * Both readings travel, and both are needed. `before` is the graph as the
     * calculator handed it back immediately after the host's graph was
     * applied, `after` is the graph now, and the difference between them is
     * exactly what the user did. Comparing against what the host *sent* would
     * not do: Desmos normalises what it is given, leaving a property off the
     * state where it matches its own default, so every expression would look
     * changed the moment the graph loaded.
     */
    | { command: 'graphChanged'; data: { before: GraphReading; after: GraphReading } };

export type AxisMessage = ViewerMessage | HostMessage;
