import type { HostMessage, ViewerMessage } from './messages';

/** The viewer's end of a connection to its host. */
export interface ViewerTransport {
    /** Subscribes to messages from the host. Returns an unsubscribe. */
    onMessage(listener: (message: ViewerMessage) => void): () => void;
    send(message: HostMessage): void;
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
 * across a webview boundary. Delivery is synchronous — there is no wire.
 */
export function createLocalChannel(): LocalChannel {
    const toViewer = listenerSet<ViewerMessage>();
    const toHost = listenerSet<HostMessage>();

    return {
        viewer: { onMessage: toViewer.add, send: toHost.emit },
        host: { onMessage: toHost.add, send: toViewer.emit },
    };
}
