// ═════════════════════════════════════════════════════════════════════════════
// @axis-dsl/protocol - how a host drives the Axis viewer
// ═════════════════════════════════════════════════════════════════════════════

export type { AxisMessage, HostMessage, ViewerMessage } from './messages';
export { createLocalChannel } from './transport';
export type { HostTransport, LocalChannel, ViewerTransport } from './transport';
export { createVsCodeTransport, isVsCodeWebview } from './vscode';
