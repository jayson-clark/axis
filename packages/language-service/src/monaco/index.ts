// ═════════════════════════════════════════════════════════════════════════════
// @axis-dsl/language-service/monaco - Monaco bindings for Axis
// ═════════════════════════════════════════════════════════════════════════════
//
// For now the grammar and the themes coloured by it; the adapters for the
// language service itself join them in #25.

export { createAxisMonarchLanguage, AXIS_PALETTE_NAMES } from './monarch';
export { defineAxisThemes, AXIS_DARK_THEME, AXIS_LIGHT_THEME } from './themes';
export type { MonacoApi } from './themes';
