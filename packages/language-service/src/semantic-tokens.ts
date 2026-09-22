// ═════════════════════════════════════════════════════════════════════════════
// Semantic tokens
// ═════════════════════════════════════════════════════════════════════════════
//
// The grammars colour what can be told from the characters; these colour what
// the tree knows. `amp` is a parameter in one statement and a variable in the
// next, `RED` is a palette colour after `color:` and a variable anywhere else,
// `swatch` after `use:` is a style - none of which a regex can see.
//
// Every token of the source is classified, trivia included where it means
// something (comments): keywords, strings, numbers and operators straight off
// the lexer, identifiers by the symbol analysis. The result is encoded as the
// Language Server Protocol encodes it - five integers a token, each position
// relative to the one before - which Monaco reads as it is.

import type { SyntaxTree, Token } from '@axis-dsl/syntax';
import { linesOf, spanToRange, toTree, type DocumentInput, type Range } from './document';
import { importedSymbols, type ImportedSymbol, type ProgramOptions } from './program';
import { analyze, type Occurrence } from './symbols';

/** The token types, in legend order: a token's type is its index here. */
export const SEMANTIC_TOKEN_TYPES = [
    'keyword',
    'function',
    'variable',
    'parameter',
    'property',
    'enumMember',
    'string',
    'number',
    'comment',
    'operator',
    'macro',
    'type',
] as const;

/**
 * The modifiers, in legend order: bit `1 << i` of a token's modifiers is the
 * `i`th. `defaultLibrary` marks a builtin, `declaration` the name a definition
 * gives, `readonly` a constant.
 */
export const SEMANTIC_TOKEN_MODIFIERS = ['declaration', 'readonly', 'defaultLibrary'] as const;

export type SemanticTokenType = (typeof SEMANTIC_TOKEN_TYPES)[number];
export type SemanticTokenModifier = (typeof SEMANTIC_TOKEN_MODIFIERS)[number];

export const SEMANTIC_TOKEN_LEGEND = {
    tokenTypes: [...SEMANTIC_TOKEN_TYPES],
    tokenModifiers: [...SEMANTIC_TOKEN_MODIFIERS],
};

/** One classified token, before encoding. */
export interface SemanticToken {
    range: Range;
    type: SemanticTokenType;
    modifiers: SemanticTokenModifier[];
}

export interface SemanticTokens {
    /** Five integers a token: line delta, start delta, length, type, modifier bits. */
    data: number[];
}

/**
 * Every token worth colouring, in document order. Given the compiler's
 * `resolveImport`, a name an import defines is coloured as what it is there.
 */
export function getSemanticTokenList(
    input: DocumentInput,
    options: ProgramOptions = {},
): SemanticToken[] {
    const tree = toTree(input);
    const byStart = new Map<number, Occurrence>(
        analyze(tree).occurrences.map(occurrence => [occurrence.identifier.span.start, occurrence]),
    );
    const imported = new Map<string, ImportedSymbol>();
    for (const symbol of importedSymbols(tree, options)) {
        imported.set(`${symbol.kind === 'style' ? 'style' : 'value'}:${symbol.name}`, symbol);
    }

    const result: SemanticToken[] = [];
    let previous: Token | undefined;
    for (const token of tree.tokens) {
        const classified = classify(token, previous, byStart, imported);
        if (classified && token.span.end > token.span.start) {
            result.push({ range: spanToRange(tree, token.span), ...classified });
        }
        if (token.kind !== 'whitespace' && token.kind !== 'comment' && token.kind !== 'newline') {
            previous = token;
        }
    }
    return result;
}

export interface SemanticTokenOptions extends ProgramOptions {
    /**
     * Only the tokens that overlap this range - the lines an editor is
     * showing, as LSP's `semanticTokens/range` and Monaco's viewport provider
     * ask for. The whole document when absent.
     */
    range?: Range;
}

/** The document's semantic tokens, encoded against {@link SEMANTIC_TOKEN_LEGEND}. */
export function getSemanticTokens(
    input: DocumentInput,
    options: SemanticTokenOptions = {},
): SemanticTokens {
    const tree = toTree(input);
    let list = getSemanticTokenList(tree, options);
    const { range } = options;
    if (range) {
        const before = (a: Range['start'], b: Range['start']) =>
            a.line < b.line || (a.line === b.line && a.character < b.character);
        list = list.filter(
            token => before(token.range.start, range.end) && before(range.start, token.range.end),
        );
    }
    return { data: encode(tree, list) };
}

const OPERATORS: ReadonlySet<string> = new Set([
    '=',
    '<',
    '<=',
    '>',
    '>=',
    '+',
    '-',
    '*',
    '/',
    '^',
    '!',
    '|',
    '->',
    '..',
    '...',
    '@',
    '@{',
]);

type Classified = { type: SemanticTokenType; modifiers: SemanticTokenModifier[] };

function classify(
    token: Token,
    previous: Token | undefined,
    byStart: ReadonlyMap<number, Occurrence>,
    imported: ReadonlyMap<string, ImportedSymbol>,
): Classified | undefined {
    const plain = (type: SemanticTokenType): Classified => ({ type, modifiers: [] });
    switch (token.kind) {
        case 'keyword':
            return plain('keyword');
        case 'comment':
            return plain('comment');
        case 'string':
        case 'color':
            return plain('string');
        case 'number':
            return plain('number');
        case 'punctuation':
            return OPERATORS.has(token.text) ? plain('operator') : undefined;
        case 'identifier': {
            const occurrence = byStart.get(token.span.start);
            if (occurrence) return classifyOccurrence(occurrence, imported);
            // `soft min` and `soft max`: words only there, so not in the tree.
            if (previous?.kind === 'keyword' && previous.text === 'soft') return plain('keyword');
            return undefined;
        }
        default:
            return undefined;
    }
}

function classifyOccurrence(
    occurrence: Occurrence,
    imported: ReadonlyMap<string, ImportedSymbol>,
): Classified {
    const modifiers: SemanticTokenModifier[] = [];
    if (occurrence.declaration) modifiers.push('declaration');
    const tokenOf = (type: SemanticTokenType): Classified => ({ type, modifiers });

    switch (occurrence.role) {
        case 'property':
            return tokenOf('property');
        case 'enumValue':
        case 'palette':
            modifiers.push('readonly');
            return tokenOf('enumMember');
        case 'styleName':
            return tokenOf('type');
        case 'member':
            if (occurrence.builtin === 'function') {
                modifiers.push('defaultLibrary');
                return tokenOf('function');
            }
            return tokenOf('property');
        case 'name':
            break;
    }

    const name = occurrence.identifier.name;
    const symbol =
        occurrence.symbol ?? (occurrence.builtin ? undefined : imported.get(`value:${name}`));
    if (symbol) {
        switch (symbol.kind) {
            case 'style':
                return tokenOf('type');
            case 'macro':
                return tokenOf('macro');
            case 'function':
                return tokenOf('function');
            case 'parameter':
                return tokenOf('parameter');
            default:
                return tokenOf('variable');
        }
    }
    switch (occurrence.builtin) {
        case 'function':
            modifiers.push('defaultLibrary');
            return tokenOf('function');
        case 'constant':
            modifiers.push('readonly', 'defaultLibrary');
            return tokenOf('variable');
        case 'operator':
            // `width`, `index`, `dt`: Desmos' own, but they change.
            modifiers.push('defaultLibrary');
            return tokenOf('variable');
    }
    return tokenOf('variable');
}

function encode(tree: SyntaxTree, tokens: readonly SemanticToken[]): number[] {
    const lines = linesOf(tree);
    const data: number[] = [];
    let line = 0;
    let character = 0;
    for (const token of tokens) {
        const { start } = token.range;
        const length = lines.offsetAt(token.range.end) - lines.offsetAt(start);
        const lineDelta = start.line - line;
        data.push(
            lineDelta,
            lineDelta === 0 ? start.character - character : start.character,
            length,
            SEMANTIC_TOKEN_TYPES.indexOf(token.type),
            token.modifiers.reduce(
                (bits, modifier) => bits | (1 << SEMANTIC_TOKEN_MODIFIERS.indexOf(modifier)),
                0,
            ),
        );
        line = start.line;
        character = start.character;
    }
    return data;
}
