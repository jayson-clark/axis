import { useEffect, useRef, useState } from 'react';
import type { CalculatorOptions, DesmosExpression } from '@axis-dsl/desmos';
import { createLocalChannel, type HostTransport, type ViewerTransport } from '@axis-dsl/protocol';

export interface LocalViewerHost {
    apiKey: string | null;
    expressions: DesmosExpression[];
    settings?: CalculatorOptions;
    /** Shown in the tab strip. */
    status?: string | null;
    /**
     * Open your settings UI. Leaving this out tells the viewer not to offer the
     * affordance at all, rather than leaving a button that does nothing.
     */
    onRequestApiKey?: () => void;
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
    host.send({
        command: 'setExpressions',
        data: { expressions: state.expressions, settings: state.settings },
    });
    host.send({ command: 'setStatus', data: { status: state.status ?? null } });
}

/**
 * Drives an `AxisViewer` rendered in the same page, for a host with no webview
 * boundary to cross. It speaks the same protocol the extension does — this hook
 * is only the ceremony of turning React state into messages.
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

    const { apiKey, expressions, settings, status } = state;
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
        channel.host.send({ command: 'setExpressions', data: { expressions, settings } });
    }, [channel, expressions, settings]);

    useEffect(() => {
        channel.host.send({ command: 'setStatus', data: { status: status ?? null } });
    }, [channel, status]);

    return channel.viewer;
}
