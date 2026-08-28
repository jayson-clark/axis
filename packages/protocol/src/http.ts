// ═════════════════════════════════════════════════════════════════════════════
// The preview-server transport
// ═════════════════════════════════════════════════════════════════════════════

import type { HostMessage, ViewerMessage } from './messages';
import type { ConnectionState, ViewerTransport } from './transport';
import { PREVIEW_PATHS, PREVIEW_QUERY } from './preview';

export interface HttpTransportOptions {
    /** All default to the values in the page's own URL. */
    token?: string;
    file?: string;
    origin?: string;
    /**
     * How long a broken stream may spend reconnecting before it is called
     * disconnected. `EventSource` retries on its own and a blip recovers in
     * well under this, so the delay is what keeps a momentary drop from
     * announcing itself as a dead server.
     */
    reconnectGraceMs?: number;
}

const DEFAULT_RECONNECT_GRACE_MS = 3_000;

function listenerSet<T>() {
    let listeners: ((value: T) => void)[] = [];
    return {
        add(listener: (value: T) => void) {
            listeners.push(listener);
            return () => {
                listeners = listeners.filter(candidate => candidate !== listener);
            };
        },
        emit(value: T) {
            // Copied first: a listener that unsubscribes mid-dispatch would
            // otherwise shift the array out from under the loop.
            [...listeners].forEach(listener => listener(value));
        },
    };
}

/**
 * Carries the protocol between a preview page and the extension's server:
 * Server-Sent Events downstream, a POST per message upstream.
 *
 * SSE rather than a WebSocket because the traffic is almost entirely one-way -
 * the viewer sends two messages in its life - and this needs no dependency on
 * either end. It also reconnects on its own, so a dropped connection recovers
 * without the viewer having to do anything about it.
 *
 * Note that `ready` is not what starts the conversation here. The viewer sends
 * it on mount, which can be before the event stream has finished connecting, so
 * a host that answered it would be answering into nothing. The server instead
 * treats the stream opening as the signal and pushes the current state then.
 */
export function createHttpTransport(options: HttpTransportOptions = {}): ViewerTransport {
    const params = new URLSearchParams(window.location.search);
    const token = options.token ?? params.get(PREVIEW_QUERY.token) ?? '';
    const file = options.file ?? params.get(PREVIEW_QUERY.file) ?? '';
    const origin = options.origin ?? window.location.origin;
    const graceMs = options.reconnectGraceMs ?? DEFAULT_RECONNECT_GRACE_MS;

    const url = (path: string) => {
        const target = new URL(path, origin);
        target.searchParams.set(PREVIEW_QUERY.token, token);
        target.searchParams.set(PREVIEW_QUERY.file, file);
        return target.toString();
    };

    const messages = listenerSet<ViewerMessage>();
    const states = listenerSet<ConnectionState>();

    let source: EventSource | undefined;
    let state: ConnectionState = 'connecting';
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    // Messages and connection state are two subscriptions onto one stream, so
    // the stream is opened for the first of them and closed after the last.
    let subscribers = 0;

    const setState = (next: ConnectionState) => {
        if (next !== state) {
            state = next;
            states.emit(next);
        }
    };

    const open = () => {
        const stream = new EventSource(url(PREVIEW_PATHS.events));
        source = stream;

        stream.onopen = () => {
            clearTimeout(graceTimer);
            graceTimer = undefined;
            setState('connected');
        };
        stream.onmessage = event => {
            try {
                messages.emit(JSON.parse(event.data as string) as ViewerMessage);
            } catch (error) {
                console.warn('Discarding an unreadable message from the host:', error);
            }
        };
        stream.onerror = () => {
            // EventSource is already retrying by the time this runs, so the
            // stream is only declared dead once the grace period has passed
            // without an `onopen`. If the server comes back later the retry
            // that succeeds reports `connected` again on its own.
            setState('connecting');
            graceTimer ??= setTimeout(() => {
                graceTimer = undefined;
                setState('disconnected');
            }, graceMs);
        };
    };

    const close = () => {
        clearTimeout(graceTimer);
        graceTimer = undefined;
        source?.close();
        source = undefined;
        state = 'connecting';
    };

    const retain = () => {
        subscribers += 1;
        if (subscribers === 1) {
            open();
        }
        return () => {
            subscribers -= 1;
            if (subscribers === 0) {
                close();
            }
        };
    };

    return {
        onMessage(listener: (message: ViewerMessage) => void) {
            const remove = messages.add(listener);
            const release = retain();
            return () => {
                remove();
                release();
            };
        },
        onConnectionChange(listener: (next: ConnectionState) => void) {
            const remove = states.add(listener);
            const release = retain();
            // The stream may already be up, in which case there is no further
            // event coming and this listener would otherwise never hear one.
            listener(state);
            return () => {
                remove();
                release();
            };
        },
        send(message: HostMessage) {
            // `keepalive` so a message sent as the page unloads still leaves.
            void fetch(url(PREVIEW_PATHS.host), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(message),
                keepalive: true,
            }).catch(() => {
                // The host going away is normal - the window it lives in gets
                // closed. The event stream is what notices and reports it.
            });
        },
    };
}
