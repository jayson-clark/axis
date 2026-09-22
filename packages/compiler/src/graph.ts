// ═════════════════════════════════════════════════════════════════════════════
// A compilation as the two things a calculator takes
// ═════════════════════════════════════════════════════════════════════════════
//
// Temporary: #20 replaces this. The v2 compiler returns `{ state, options }`
// from `compileAxis` itself, at which point this adapter and the five-part
// result it reads both go. Every host already applies what this returns and
// nothing else, so when that lands they change their import and not their
// logic.

import type { CalculatorOptions, GraphState } from '@axis-dsl/desmos';
import type { CompilationResult } from './compile';

/**
 * A graph, whole: applied as `calculator.setState(state)` and then
 * `calculator.updateSettings(options)`, in that order, and nothing else.
 *
 * `setState` resets the calculator's settings, so the options go second.
 */
export interface CompiledGraph {
    state: GraphState;
    options: CalculatorOptions;
}

/**
 * The framing a graph gets when its script does not ask for one. Without a
 * viewport in the state each host would fall back on whatever its calculator
 * happened to be showing, so the same script would open differently in the
 * preview, the playground and the harness.
 */
const DEFAULT_VIEWPORT = { xmin: -10, ymin: -10, xmax: 10, ymax: 10 };

/**
 * The v1 compilation's five parts, assembled into the one state Desmos reads.
 *
 * Takes only the parts that reach the graph, so the harness can hand it
 * expressions it built by hand as readily as a compilation.
 */
export function toGraph(
    compilation: Pick<CompilationResult, 'expressions' | 'settings' | 'graph' | 'state' | 'ticker'>,
): CompiledGraph {
    const { expressions, settings, graph, state: flags, ticker } = compilation;

    return {
        state: {
            version: 11,
            // The top-level state flags, which are neither calculator options
            // nor part of `graph`: Desmos reads them here and only here.
            ...flags,
            // `# pointStyle: SQUARE` means that style, on a draggable point as
            // much as a fixed one. Without this, Desmos substitutes its own
            // style for any point it decides is movable and stashes the
            // author's away - so a square point silently becomes a round one
            // the moment its coordinates turn out to be draggable.
            doNotMigrateMovablePointStyle: true,
            graph: {
                ...graph,
                // A script that names only some edges gets the defaults for the
                // rest: `xmin: 0` alone is a half-written rectangle, and Desmos
                // would ignore it.
                viewport: { ...DEFAULT_VIEWPORT, ...graph?.viewport },
            },
            // The ticker rides beside the list rather than in it, and a graph
            // without one says so by carrying no ticker at all: Desmos reads a
            // ticker with no handler as no ticker, not as an empty one.
            expressions: { list: expressions, ...(ticker && { ticker }) },
        },
        options: settings ?? {},
    };
}
