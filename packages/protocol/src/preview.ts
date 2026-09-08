// ═════════════════════════════════════════════════════════════════════════════
// The preview server's HTTP surface
// ═════════════════════════════════════════════════════════════════════════════
//
// The extension serves the viewer over loopback HTTP and the page talks back
// over the same origin. Both ends are in this repo but neither can see the
// other at runtime, so the paths and query keys live here - the one place both
// already depend on - rather than as strings duplicated on each side.

export const PREVIEW_PATHS = {
    /** The page itself. */
    page: '/preview',
    /** The viewer bundle the page loads. */
    bundle: '/viewer.js',
    /** Server → page, as Server-Sent Events carrying `ViewerMessage`s. */
    events: '/events',
    /** Page → server, one POSTed `HostMessage` per request. */
    host: '/host',
} as const;

export const PREVIEW_QUERY = {
    /**
     * Per-session secret. Any process on the machine can reach a loopback port,
     * so every route requires it: without it the server would hand the contents
     * of whatever file it is asked for to anything that asked.
     */
    token: 'token',
    /** Which file this page is bound to, as a serialized URI. */
    file: 'file',
    /**
     * Whether the page shows the viewer's tabs and status line. Absent is off,
     * which is the plain graph — the extension only sets it when the user has
     * asked for the JSON.
     */
    debug: 'debug',
} as const;
