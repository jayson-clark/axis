// ═════════════════════════════════════════════════════════════════════════════
// @axis-dsl/language-service/monaco - Monaco bindings for Axis
// ═════════════════════════════════════════════════════════════════════════════
//
// The grammar, the themes, and thin providers over the language service.
// `registerAxisLanguage` is the one call an app needs; the pieces are exported
// for an app that wants some of them and not others. The names are those of
// v1's `@axis-dsl/language/monaco`, so switching is a change of import.

export { registerAxisLanguage, type RegisterAxisOptions } from './register';
export { createAxisMonarchLanguage, AXIS_PALETTE_NAMES } from './monarch';
export {
    registerAxisCompletions,
    registerAxisFormatting,
    registerAxisHover,
    registerAxisNavigation,
    registerAxisSemanticTokens,
    type AxisProgramOptions,
} from './providers';
export { registerAxisDiagnostics, type AxisDiagnosticsOptions } from './diagnostics';
export { defineAxisThemes, AXIS_DARK_THEME, AXIS_LIGHT_THEME } from './themes';
export type { MonacoApi } from './themes';
export { AXIS_LANGUAGE_ID, AXIS_FILE_EXTENSION, AXIS_LANGUAGE_CONFIGURATION } from '../language';
