import { useEffect, useState } from 'react';
import type { CalculatorOptions, DesmosExpression } from '@axis-dsl/desmos';
import type { ViewerTransport } from '@axis-dsl/protocol';

export interface ViewerState {
    /** null until the host answers our `ready` with a key. */
    apiKey: string | null;
    /** Whether the host can act on `requestApiKey`. */
    canSetApiKey: boolean;
    expressions: DesmosExpression[];
    settings: CalculatorOptions | undefined;
    status: string | null;
}

const INITIAL: ViewerState = {
    apiKey: null,
    canSetApiKey: false,
    expressions: [],
    settings: undefined,
    status: null,
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

    return state;
}
