// ═════════════════════════════════════════════════════════════════════════════
// @axis-dsl/desmos - the Desmos calculator API, typed
// ═════════════════════════════════════════════════════════════════════════════
// Hand-written because Desmos ships no types. Not purely types: the style enums
// and the API constants below are emitted runtime values.

export * from './expressions';
export * from './api';
export * from './calculator';
export {
    AXIS_DESMOS_API_KEY,
    DESMOS_API_VERSION,
    DESMOS_DOCS_URL,
    DESMOS_SCRIPT_ORIGIN,
    desmosScriptUrl,
} from './desmos';
