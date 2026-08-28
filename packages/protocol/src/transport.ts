import type { HostMessage, ViewerMessage } from './messages';

/**
 * Whether a transport with a wire currently has one.
 *
 * `connecting` covers both the first attempt and every reconnection after a
 * drop, because to the viewer they are the same thing: no data is arriving and
 * it may yet. `disconnected` is the claim that it will not — nothing on screen
 * can be trusted as current from then on.
 */
export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

/** The viewer's end of a connection to its host. */
export interface ViewerTransport {
    /** Subscribes to messages from the host. Returns an unsubscribe. */
    onMessage(listener: (message: ViewerMessage) => void): () => void;
    send(message: HostMessage): void;
    /**
     * Subscribes to the state of the connection, for a transport that has one
     * to lose. A transport with no wire — the in-process channel — leaves this
     * out, and the viewer takes its absence to mean permanently connected.
     */
    onConnectionChange?(listener: (state: ConnectionState) => void): () => void;
}

/** The host's end of the same connection. */
export interface HostTransport {
    onMessage(listener: (message: HostMessage) => void): () => void;
    send(message: ViewerMessage): void;
}

export interface LocalChannel {
    viewer: ViewerTransport;
    host: HostTransport;
}

function listenerSet<T>() {
    let listeners: ((message: T) => void)[] = [];
    return {
        add(listener: (message: T) => void) {
            listeners.push(listener);
            return () => {
                listeners = listeners.filter(candidate => candidate !== listener);
            };
        },
        emit(message: T) {
            // Copied first: a listener that unsubscribes mid-dispatch would
            // otherwise shift the array out from under the loop.
            [...listeners].forEach(listener => listener(message));
        },
    };
}

/**
 * An in-process channel, for a host that renders the viewer itself rather than
 * reaching it across a wire. Delivery is synchronous — there is no wire.
 */
export function createLocalChannel(): LocalChannel {
    const toViewer = listenerSet<ViewerMessage>();
    const toHost = listenerSet<HostMessage>();

    return {
        viewer: { onMessage: toViewer.add, send: toHost.emit },
        host: { onMessage: toHost.add, send: toViewer.emit },
    };
}
