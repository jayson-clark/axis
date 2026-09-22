// ═════════════════════════════════════════════════════════════════════════════
// Hover
// ═════════════════════════════════════════════════════════════════════════════
//
// The manifest's documentation for what it defines - builtins, properties,
// enum values, the palette - and the keywords' own; for a name the script
// defines, the definition itself, printed.

import { AXIS_PALETTE_HEX, isTrivia, type Keyword, type Token } from '@axis-dsl/syntax';
import { builtinDescription, definitionText, propertyDocumentation } from './describe';
import {
    offsetAt,
    spanToRange,
    toTree,
    touches,
    type DocumentInput,
    type Position,
    type Range,
} from './document';
import { KEYWORD_INFO } from './keywords';
import { occurrenceAt, type Occurrence, type SymbolDefinition } from './symbols';
import type { SyntaxTree } from '@axis-dsl/syntax';

export interface Hover {
    /** Markdown. */
    contents: string;
    /** What the hover is about: the word under the cursor. */
    range: Range;
}

const code = (text: string) => '```axis\n' + text + '\n```';

const KIND_TEXT: Readonly<Record<SymbolDefinition['kind'], string>> = {
    variable: 'variable',
    function: 'function',
    macro: 'macro',
    style: 'style',
    parameter: 'parameter',
    binding: 'local',
};

export function getHover(input: DocumentInput, position: Position): Hover | undefined {
    const tree = toTree(input);
    const offset = offsetAt(tree, position);

    const keyword = keywordAt(tree, offset);
    if (keyword) {
        const info = KEYWORD_INFO[keyword.text as Keyword | 'min' | 'max'];
        return {
            contents: `**${keyword.text}** - ${info.detail}\n\n${info.documentation}`,
            range: spanToRange(tree, keyword.span),
        };
    }

    const occurrence = occurrenceAt(tree, offset);
    if (!occurrence) return undefined;
    const contents = describe(tree, occurrence);
    return contents === undefined
        ? undefined
        : { contents, range: spanToRange(tree, occurrence.identifier.span) };
}

/** A keyword under the cursor, or the `min`/`max` that follows `soft` in a range. */
function keywordAt(tree: SyntaxTree, offset: number): Token | undefined {
    let previous: Token | undefined;
    for (const token of tree.tokens) {
        if (token.span.start > offset) break;
        if (touches(token.span, offset) && token.span.end > token.span.start) {
            if (token.kind === 'keyword') return token;
            if (
                token.kind === 'identifier' &&
                (token.text === 'min' || token.text === 'max') &&
                previous?.kind === 'keyword' &&
                previous.text === 'soft'
            ) {
                return token;
            }
        }
        if (!isTrivia(token)) previous = token;
    }
    return undefined;
}

function describe(tree: SyntaxTree, occurrence: Occurrence): string | undefined {
    const name = occurrence.identifier.name;
    switch (occurrence.role) {
        case 'property':
            return occurrence.property
                ? `**${name}** (property)\n\n${propertyDocumentation(occurrence.property)}`
                : undefined;
        case 'enumValue':
            return `**${name}** - a value of \`${occurrence.property!.name}\`\n\n${occurrence.property!.detail}`;
        case 'palette':
            return `**${name}** - Desmos palette colour \`${AXIS_PALETTE_HEX.get(name)}\``;
        case 'styleName':
            return occurrence.symbol ? symbolText(tree, occurrence.symbol) : undefined;
        case 'member':
            if (name === 'x' || name === 'y')
                return `**.${name}** - the point's ${name} coordinate`;
            return builtinText(name, occurrence);
        case 'name':
            if (occurrence.symbol) return symbolText(tree, occurrence.symbol);
            return builtinText(name, occurrence);
    }
}

function symbolText(tree: SyntaxTree, symbol: SymbolDefinition): string {
    const text = definitionText(tree, symbol);
    // A parameter has no statement of its own to show, only the one it belongs to.
    return symbol.kind === 'parameter' || symbol.kind === 'binding'
        ? `(${KIND_TEXT[symbol.kind]}) ${text}`
        : `(${KIND_TEXT[symbol.kind]})\n\n${code(text)}`;
}

function builtinText(name: string, occurrence: Occurrence): string | undefined {
    if (!occurrence.builtin) return undefined;
    const builtin = builtinDescription(name, occurrence.builtin);
    if (!builtin) return undefined;
    return `${code(builtin.signature)}\n\n${builtin.detail}\n\nBuiltin ${builtin.category} ${occurrence.builtin}.`;
}
