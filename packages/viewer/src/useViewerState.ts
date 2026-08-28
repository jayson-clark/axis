import { useEffect, useState } from 'react';
import type { CalculatorOptions, DesmosExpression } from '@axis-dsl/desmos';
import type { ConnectionState, ViewerTransport } from '@axis-dsl/protocol';

export interface ViewerState {
    /** null until the host answers our `ready` with a key. */
    apiKey: string | null;
    /** Whether the host can act on `requestApiKey`. */
    canSetApiKey: boolean;
    expressions: DesmosExpression[];
    settings: CalculatorOptions | undefined;
    status: string | null;
    /** `connected` for a transport that does not report one. */
    connection: ConnectionState;
    /**
     * Whether the connection has ever been up. Distinguishes a first load,
     * where `connecting` is just the page starting and worth saying nothing
     * about, from a reconnection, where it means the graph has gone stale.
     */
    hasConnected: boolean;
}

const INITIAL: ViewerState = {
    apiKey: null,
    canSetApiKey: false,
    expressions: [],
    settings: undefined,
    status: null,
    connection: 'connecting',
    hasConnected: false,
};

/**
 * Everything the viewer displays, assembled from the host's messages. This is
 * the viewer's only input: the extension and the playground differ in which
 * transport they hand it, not in how the state gets built.
 */
export function useViewerState(transport: ViewerTransport): ViewerState {
    const [state, setState] = useState<ViewerState>(INITIAL);

    useEffect(() => {
        const unsubscribe = transport.onMessage(message => {
            switch (message.command) {
                case 'init':
                    setState(current => ({
                        ...current,
                        apiKey: message.data.desmosApiKey,
                        canSetApiKey: message.data.canSetApiKey ?? false,
                    }));
                    break;
                case 'setExpressions':
                    setState(current => ({
                        ...current,
                        expressions: message.data.expressions,
                        settings: message.data.settings,
                    }));
                    break;
                case 'setStatus':
                    setState(current => ({ ...current, status: message.data.status }));
                    break;
            }
        });

        // Subscribed before announcing readiness, so a host that answers
        // synchronously — the in-process channel does — is never missed.
        transport.send({ command: 'ready' });

        return unsubscribe;
    }, [transport]);

    useEffect(() => {
        // A transport with no wire cannot lose one, so it reports nothing and
        // is taken to be connected for as long as it exists.
        if (!transport.onConnectionChange) {
            setState(current => ({ ...current, connection: 'connected', hasConnected: true }));
            return;
        }

        return transport.onConnectionChange(connection =>
            setState(current => ({
                ...current,
                connection,
                hasConnected: current.hasConnected || connection === 'connected',
            })),
        );
    }, [transport]);

    return state;
}
