// ═════════════════════════════════════════════════════════════════════════════
// @axis-dsl/protocol - how a host drives the Axis viewer
// ═════════════════════════════════════════════════════════════════════════════

export type { AxisMessage, HostMessage, ViewerMessage } from './messages';
export { createLocalChannel } from './transport';
export type { ConnectionState, HostTransport, LocalChannel, ViewerTransport } from './transport';
export { createHttpTransport } from './http';
export type { HttpTransportOptions } from './http';
export { PREVIEW_PATHS, PREVIEW_QUERY } from './preview';
