// ═════════════════════════════════════════════════════════════════════════════
// @axis-dsl/compiler - .axis source to a Desmos graph
// ═════════════════════════════════════════════════════════════════════════════

export { compileAxis } from './compile';
export type { CompilationResult, CompileOptions, StatementOrigin } from './compile';

// The passes `compileAxis` is made of, for a tool that wants one of them on its
// own - an editor checking a script without lowering it, say.
export { loadProgram } from './program';
export type { ImportResolution, LoadProgramOptions, Program, SourceFile } from './program';
export { collectSymbols, definitionOf } from './symbols';
export type { Definition, MacroDefinition, StyleDefinition, Symbols } from './symbols';
export { checkProgram } from './check';
export type { CheckResult } from './check';
export { expandMacros } from './macros';
export type { Expansion } from './macros';
export { resolveProperties } from './styles';

export { convertToLatex } from './latex';
export { convertFromLatex } from './unlatex';
export { emitLatex, identifierLatex, LatexParseError, parseLatex } from './latex/index';
export {
    decompileAxis,
    decompileExpression,
    decompileSettings,
    graphActionNames,
} from './decompile';
export type { DecompileExpressionOptions, DecompileInput, DecompileOptions } from './decompile';
export { applySourceEdits, diffGraphs, writeBackGraph } from './writeback';
export { applyPropertyWrites, mergeExpression, propertyWrites, statementFor } from './readback';
export type { PropertyWrite, ReadbackPlacement } from './readback';
export type {
    ChangeKind,
    GraphChange,
    GraphSnapshot,
    SkippedChange,
    SourceEdit,
    WriteBackOptions,
    WriteBackResult,
} from './writeback';
export { createImportResolver, findImports, loadImports } from './imports';
export type { ImportHost, ResolvedImport, ResolveImport } from './imports';
export { createImageResolver, findImageFiles, loadImages } from './images';
export type { ImageHost, ResolvedImage, ResolveImage } from './images';
