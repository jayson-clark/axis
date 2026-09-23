import { useEffect, useRef, useState } from 'react';
import type { CalculatorOptions, GraphState } from '@axis-dsl/desmos';
import {
    createLocalChannel,
    type GraphReading,
    type HostTransport,
    type ViewerMessage,
    type ViewerTransport,
} from './protocol/index.js';

export interface LocalViewerHost {
    apiKey: string | null;
    /**
     * The whole graph state, applied with `setState`. Left out, the viewer is
     * sent no graph at all and the calculator stays as it is - a host that has
     * not compiled anything yet has nothing to say.
     */
    state?: GraphState | null;
    /** Calculator options, applied with `updateSettings` after the state. */
    options?: CalculatorOptions;
    /** Shown in the tab strip. */
    status?: string | null;
    /**
     * Open your settings UI. Leaving this out tells the viewer not to offer the
     * affordance at all, rather than leaving a button that does nothing.
     */
    onRequestApiKey?: () => void;
    /**
     * Report changes the user makes to the graph by hand — a dragged point, a
     * moved slider, a recolour, a pan.
     *
     * Left out, the calculator is not watched: the viewer only starts looking
     * when a host says it has somewhere to put the answer. `before` is the
     * graph as the calculator held it when this host's graph was last applied,
     * `after` is the graph now.
     */
    onGraphChanged?: (before: GraphReading, after: GraphReading) => void;
}

/**
 * The graph, as the one message that carries it, or null for a host with none.
 *
 * Built here rather than at each of the two places that send it — the first
 * push when the viewer says `ready`, and the effect that re-sends on every
 * recompile — so the two cannot disagree about what a graph with no options
 * is.
 */
function graphMessage({
    state,
    options,
}: Pick<LocalViewerHost, 'state' | 'options'>): ViewerMessage | null {
    return state ? { command: 'setGraph', data: { state, options: options ?? {} } } : null;
}

function pushAll(host: HostTransport, state: LocalViewerHost) {
    if (state.apiKey) {
        host.send({
            command: 'init',
            data: {
                desmosApiKey: state.apiKey,
                canSetApiKey: Boolean(state.onRequestApiKey),
            },
        });
    }
    const graph = graphMessage(state);
    if (graph) {
        host.send(graph);
    }
    host.send({ command: 'setStatus', data: { status: state.status ?? null } });
    host.send({ command: 'setSync', data: { enabled: Boolean(state.onGraphChanged) } });
}

/**
 * Drives an `AxisViewer` rendered in the same page, for a host with no wire to
 * cross. It speaks the same protocol the extension does — this hook is only the
 * ceremony of turning React state into messages.
 */
export function useLocalViewerHost(host: LocalViewerHost): ViewerTransport {
    // Written during render so the `ready` handler below, which fires from the
    // viewer's mount effect, already sees this render's values.
    const latest = useRef(host);
    latest.current = host;

    const [channel] = useState(() => {
        const created = createLocalChannel();
        // Subscribed at creation rather than in an effect: a child's effects run
        // before its parent's, so by the time this hook's effects fire the
        // viewer has already announced `ready`.
        created.host.onMessage(message => {
            if (message.command === 'ready') {
                pushAll(created.host, latest.current);
            } else if (message.command === 'requestApiKey') {
                latest.current.onRequestApiKey?.();
            } else if (message.command === 'graphChanged') {
                latest.current.onGraphChanged?.(message.data.before, message.data.after);
            }
        });
        return created;
    });

    const { apiKey, state, options, status } = host;
    const canSetApiKey = Boolean(host.onRequestApiKey);
    // Whether a host is listening, not which function it is listening with: a
    // host writing this inline gets a new closure every render, and resending
    // `setSync` on each one would be a message per keystroke.
    const wantsSync = Boolean(host.onGraphChanged);

    useEffect(() => {
        if (apiKey) {
            channel.host.send({
                command: 'init',
                data: { desmosApiKey: apiKey, canSetApiKey },
            });
        }
    }, [channel, apiKey, canSetApiKey]);

    useEffect(() => {
        const graph = graphMessage({ state, options });
        if (graph) {
            channel.host.send(graph);
        }
    }, [channel, state, options]);

    useEffect(() => {
        channel.host.send({ command: 'setStatus', data: { status: status ?? null } });
    }, [channel, status]);

    useEffect(() => {
        channel.host.send({ command: 'setSync', data: { enabled: wantsSync } });
    }, [channel, wantsSync]);

    return channel.viewer;
}
