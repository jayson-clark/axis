// ═════════════════════════════════════════════════════════════════════════════
// @axis-dsl/language - platform-neutral Axis language services
// ═════════════════════════════════════════════════════════════════════════════
//
// This entry point has no editor dependency. The editor bindings are subpaths,
// so importing one never pulls in the other:
//   @axis-dsl/language/vscode  - VSCode providers (extension host)
//   @axis-dsl/language/monaco  - Monaco registration (browser)

export * from './core';

export {
    AXIS_ALWAYS_STRING_PROPERTIES,
    AXIS_CONFIG_PROPERTY_NAMES,
    AXIS_CONSTANT_NAMES,
    AXIS_DEFAULT_CONFIG,
    AXIS_FUNCTION_NAMES,
    AXIS_GRAPH_PROPERTY_NAMES,
    AXIS_LATEX_FOR_CONSTANT,
    AXIS_MANIFEST,
    AXIS_METADATA_PROPERTY_NAMES,
    AXIS_OPERATOR_NAMES,
    AXIS_TICKER_PROPERTY_NAMES,
    AXIS_VIEWPORT_PROPERTY_NAMES,
    getFunctionLatex,
} from './language-manifest';
export type {
    ConstantDefinition,
    FunctionDefinition,
    OperatorDefinition,
    PropertyDefinition,
} from './language-manifest';
