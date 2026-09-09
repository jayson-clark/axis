import { useEffect, useRef, useState } from 'react';
import type {
    CalculatorOptions,
    DesmosExpression,
    GraphSettings,
    GraphStateFlags,
    TickerState,
} from '@axis-dsl/desmos';
import {
    createLocalChannel,
    type HostTransport,
    type ViewerMessage,
    type ViewerTransport,
} from '@axis-dsl/protocol';

export interface LocalViewerHost {
    apiKey: string | null;
    expressions: DesmosExpression[];
    settings?: CalculatorOptions;
    /** The viewport and `squareAxes`, applied through the calculator's state. */
    graph?: GraphSettings;
    /** The flags Desmos reads off the top of the state, applied the same way. */
    state?: GraphStateFlags;
    /** The graph's ticker, applied the same way. */
    ticker?: TickerState;
    /** Shown in the tab strip. */
    status?: string | null;
    /**
     * Open your settings UI. Leaving this out tells the viewer not to offer the
     * affordance at all, rather than leaving a button that does nothing.
     */
    onRequestApiKey?: () => void;
}

/** The half of a host's state that describes the graph rather than the page. */
type CompiledGraph = Pick<
    LocalViewerHost,
    'expressions' | 'settings' | 'graph' | 'state' | 'ticker'
>;

/**
 * The compiled graph, as the one message that carries it.
 *
 * Built here rather than at each of the two places that send it — the first
 * push when the viewer says `ready`, and the effect that re-sends on every
 * recompile. They have to agree: whichever one leaves out a part of the
 * compilation replaces what the other delivered with nothing, and the graph
 * loses it a render later. The ticker is the part that shows this up, being the
 * one thing that can change while the expression list does not.
 */
function expressionsMessage({
    expressions,
    settings,
    graph,
    state,
    ticker,
}: CompiledGraph): ViewerMessage {
    return { command: 'setExpressions', data: { expressions, settings, graph, state, ticker } };
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
    host.send(expressionsMessage(state));
    host.send({ command: 'setStatus', data: { status: state.status ?? null } });
}

/**
 * Drives an `AxisViewer` rendered in the same page, for a host with no wire to
 * cross. It speaks the same protocol the extension does — this hook is only the
 * ceremony of turning React state into messages.
 */
export function useLocalViewerHost(state: LocalViewerHost): ViewerTransport {
    // Written during render so the `ready` handler below, which fires from the
    // viewer's mount effect, already sees this render's values.
    const latest = useRef(state);
    latest.current = state;

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
            }
        });
        return created;
    });

    const { apiKey, expressions, settings, graph, state: stateFlags, ticker, status } = state;
    const canSetApiKey = Boolean(state.onRequestApiKey);

    useEffect(() => {
        if (apiKey) {
            channel.host.send({
                command: 'init',
                data: { desmosApiKey: apiKey, canSetApiKey },
            });
        }
    }, [channel, apiKey, canSetApiKey]);

    useEffect(() => {
        channel.host.send(
            expressionsMessage({ expressions, settings, graph, state: stateFlags, ticker }),
        );
    }, [channel, expressions, settings, graph, stateFlags, ticker]);

    useEffect(() => {
        channel.host.send({ command: 'setStatus', data: { status: status ?? null } });
    }, [channel, status]);

    return channel.viewer;
}
