// ═════════════════════════════════════════════════════════════════════════════
// Per-document debouncing - editor-agnostic
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Coalesces repeated work per key, so re-validating a document waits for the
 * typing to pause. Each key keeps its own timer: editing one file never delays
 * the check of another.
 */
export interface Debouncer<K> {
    /** Run `work` once `delayMs` has passed with no further call for `key`. */
    schedule(key: K, work: () => void): void;
    /** Drop any pending work for `key`. */
    cancel(key: K): void;
    /** Drop everything pending. */
    dispose(): void;
}

export function createDebouncer<K>(delayMs: number): Debouncer<K> {
    const timers = new Map<K, ReturnType<typeof setTimeout>>();

    const cancel = (key: K) => {
        const timer = timers.get(key);
        if (timer !== undefined) {
            clearTimeout(timer);
            timers.delete(key);
        }
    };

    return {
        schedule(key, work) {
            cancel(key);
            timers.set(
                key,
                setTimeout(() => {
                    timers.delete(key);
                    work();
                }, delayMs),
            );
        },
        cancel,
        dispose() {
            timers.forEach(timer => clearTimeout(timer));
            timers.clear();
        },
    };
}
