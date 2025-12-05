// ═════════════════════════════════════════════════════════════════════════════
// The VSCode webview transport
// ═════════════════════════════════════════════════════════════════════════════

import type { HostMessage, ViewerMessage } from './messages';
import type { ViewerTransport } from './transport';

interface VsCodeApi {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
}

declare global {
    interface Window {
        acquireVsCodeApi?: () => VsCodeApi;
        /** Cache of the acquired API — acquiring twice throws. */
        __axisVsCodeApi?: VsCodeApi;
    }
}

/**
 * True only inside a VSCode webview. VSCode injects `acquireVsCodeApi` into
 * every webview and nothing else does, so it doubles as the environment probe
 * the viewer uses to decide whether the `--vscode-*` theme variables exist.
 */
export function isVsCodeWebview(): boolean {
    return typeof window !== 'undefined' && typeof window.acquireVsCodeApi === 'function';
}

/** Carries the protocol over VSCode's webview postMessage bridge. */
export function createVsCodeTransport(): ViewerTransport {
    let api: VsCodeApi | undefined;
    if (typeof window.acquireVsCodeApi === 'function') {
        try {
            api = window.__axisVsCodeApi ??= window.acquireVsCodeApi();
        } catch (error) {
            console.warn('Failed to acquire the VSCode API:', error);
        }
    }

    return {
        onMessage(listener: (message: ViewerMessage) => void) {
            const handler = (event: MessageEvent) => listener(event.data as ViewerMessage);
            window.addEventListener('message', handler);
            return () => window.removeEventListener('message', handler);
        },
        send(message: HostMessage) {
            if (api) {
                api.postMessage(message);
            } else if (window.parent !== window) {
                window.parent.postMessage(message, '*');
            }
        },
    };
}
