import { useEffect, useState } from 'react';
import { desmosScriptUrl, DesmosNamespace } from '@axis-dsl/desmos';

declare global {
    interface Window {
        Desmos?: DesmosNamespace;
    }
}

export type DesmosLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface DesmosLoadState {
    status: DesmosLoadStatus;
    error: string | null;
}

/**
 * The Desmos script tags the page globally, so a module-level cache keeps a
 * second mount (or a re-render with the same key) from injecting it twice.
 */
const loaders = new Map<string, Promise<void>>();

function loadDesmosScript(apiKey: string): Promise<void> {
    if (window.Desmos) {
        return Promise.resolve();
    }

    const cached = loaders.get(apiKey);
    if (cached) {
        return cached;
    }

    const loading = new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = desmosScriptUrl(apiKey);
        script.async = true;
        script.onload = () => {
            // Desmos answers a bad key with a 403 whose body is not JS, so the
            // script "loads" but never defines window.Desmos.
            if (window.Desmos) {
                resolve();
            } else {
                reject(
                    new Error(
                        `Desmos loaded but did not initialize. The API key ("${apiKey}") is likely invalid.`,
                    ),
                );
            }
        };
        script.onerror = () =>
            reject(
                new Error(
                    `Could not fetch the Desmos API. Check your network connection and that the API key ("${apiKey}") is valid.`,
                ),
            );
        document.body.appendChild(script);
    });

    // A failed load must not be cached, or a corrected key could never retry.
    loading.catch(() => loaders.delete(apiKey));
    loaders.set(apiKey, loading);
    return loading;
}

/** Loads the Desmos calculator script for `apiKey`, once per page. */
export function useDesmos(apiKey: string | null | undefined): DesmosLoadState {
    const [state, setState] = useState<DesmosLoadState>({ status: 'idle', error: null });

    useEffect(() => {
        if (!apiKey) {
            setState({ status: 'idle', error: null });
            return;
        }

        let cancelled = false;
        setState({ status: 'loading', error: null });

        loadDesmosScript(apiKey).then(
            () => {
                if (!cancelled) {
                    setState({ status: 'ready', error: null });
                }
            },
            (error: unknown) => {
                if (!cancelled) {
                    setState({
                        status: 'error',
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            },
        );

        return () => {
            cancelled = true;
        };
    }, [apiKey]);

    return state;
}
