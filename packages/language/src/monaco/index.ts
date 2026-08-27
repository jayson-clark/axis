// ═════════════════════════════════════════════════════════════════════════════
// @axis-dsl/language/monaco - Monaco bindings for the Axis language services
// ═════════════════════════════════════════════════════════════════════════════

export { registerAxisLanguage } from './register';
export { createAxisMonarchLanguage } from './monarch';
export { registerAxisCompletions } from './completions';
export { registerAxisDiagnostics } from './diagnostics';
export { registerAxisFormatting } from './formatting';
export type { MonacoApi } from './types';
export { AXIS_LANGUAGE_ID, AXIS_FILE_EXTENSION } from '../index';
