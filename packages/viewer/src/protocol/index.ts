// ═════════════════════════════════════════════════════════════════════════════
// @axis-dsl/viewer/protocol - how a host drives the Axis viewer
// ═════════════════════════════════════════════════════════════════════════════
//
// A subpath of its own rather than part of the package root, because the other
// end of the wire is not a browser. The extension's preview server imports this
// in the VSCode extension host, which is Node with no DOM and no React, so
// nothing under protocol/ may import either - the root of the package pulls in
// both the moment it is loaded.

export type {
    AxisMessage,
    GraphReading,
    HostMessage,
    ViewerGraph,
    ViewerMessage,
} from './messages.js';
export { createLocalChannel } from './transport.js';
export type { ConnectionState, HostTransport, LocalChannel, ViewerTransport } from './transport.js';
export { createHttpTransport } from './http.js';
export type { HttpTransportOptions } from './http.js';
export { PREVIEW_PATHS, PREVIEW_QUERY } from './preview.js';
