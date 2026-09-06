// ═════════════════════════════════════════════════════════════════════════════
// @axis-dsl/language/vscode - VSCode bindings for the Axis language services
// ═════════════════════════════════════════════════════════════════════════════

export { AxisCompletionProvider } from './completions';
export { AxisFormattingProvider, AxisRangeFormattingProvider } from './formatting';
export { registerAxisDiagnostics } from './diagnostics';
export { registerAxisLanguage } from './register';
export { fileExists, resolveImageUri, resolveImportUri } from './imports';
export { AXIS_LANGUAGE_ID, AXIS_FILE_EXTENSION, withAxisExtension } from '../index';
