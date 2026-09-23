// ═════════════════════════════════════════════════════════════════════════════
// Describing things - the text hover and completions show for a name
// ═════════════════════════════════════════════════════════════════════════════
//
// A user definition is described by itself: its statement, printed by the
// same printer `format` uses, so what a hover shows is what the file would say
// once formatted rather than whatever spacing it was typed with. A builtin or
// a property is described by the manifest.

import {
    AXIS_MANIFEST,
    AXIS_PALETTE_HEX,
    placementsOf,
    printStatement,
    type PropertyDefinition,
    type PropertyPlacement,
    type Statement,
    type SyntaxTree,
} from '@axis-dsl/syntax';
import type { ImportedSymbol } from './program';
import type { BuiltinKind, SymbolDefinition } from './symbols';

/** A definition as Axis source: the statement that makes it, metadata left off. */
export function definitionText(tree: SyntaxTree, definition: SymbolDefinition): string {
    switch (definition.kind) {
        case 'parameter': {
            const owner = definition.owner;
            const signature = owner
                ? `${owner.kind === 'macro' ? 'macro ' : ''}${owner.name}(${owner.parameters?.join(', ') ?? ''})`
                : undefined;
            return signature
                ? `${definition.name} (parameter of ${signature})`
                : `${definition.name} (parameter)`;
        }
        case 'binding':
            return `${definition.name} (bound by with / for)`;
    }
    if (definition.column) {
        return tree.source.slice(definition.column.span.start, definition.column.span.end);
    }
    return printDefinition(definition.statement, tree.source);
}

/**
 * A defining statement, printed. With the source it was read from, so a style
 * written on one line is shown on one line; an expression's metadata is left
 * off, since it says nothing about what the name means.
 */
function printDefinition(statement: Statement, source: string): string {
    if (statement.kind === 'ExpressionStatement') {
        return printStatement({ ...statement, metadata: null }, { source });
    }
    return printStatement(statement, { source });
}

/** An imported definition as Axis source, as {@link definitionText} writes a local one. */
export function importedText(symbol: ImportedSymbol): string {
    if (symbol.statement.kind === 'TableStatement') return symbol.name;
    return printDefinition(symbol.statement, symbol.file.source);
}

/** The first line of a definition, cut short enough to sit beside a completion. */
export function definitionSummary(tree: SyntaxTree, definition: SymbolDefinition): string {
    const text = definitionText(tree, definition).split('\n')[0];
    return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

const FUNCTIONS = new Map(AXIS_MANIFEST.functions.map(fn => [fn.name, fn]));
const CONSTANTS = new Map(AXIS_MANIFEST.constants.map(constant => [constant.name, constant]));
const OPERATORS = new Map(AXIS_MANIFEST.operators.map(operator => [operator.name, operator]));

/** What the manifest says about a builtin or a property, beyond its name. */
interface Documented {
    detail: string;
    documentation?: string;
    example?: string;
}

export interface BuiltinDescription extends Documented {
    signature: string;
    category: string;
}

/** A builtin's signature, as a completion's label would show it, and its documentation. */
export function builtinDescription(
    name: string,
    kind: BuiltinKind,
): BuiltinDescription | undefined {
    const entry =
        kind === 'function'
            ? FUNCTIONS.get(name)
            : kind === 'constant'
              ? CONSTANTS.get(name)
              : OPERATORS.get(name);
    if (!entry) return undefined;
    const signature =
        kind === 'function' ? snippetSignature(FUNCTIONS.get(name)!.snippet ?? `${name}()`) : name;
    return { ...entry, signature };
}

/**
 * The `detail`, then any `documentation` and the `example`, in Markdown - the
 * body of a hover and of a completion's documentation.
 */
export function manifestDocumentation(entry: Documented, ...between: string[]): string {
    const parts = [entry.detail];
    if (entry.documentation) parts.push(entry.documentation);
    parts.push(...between);
    if (entry.example) parts.push('```axis\n' + entry.example + '\n```');
    return parts.join('\n\n');
}

/** `sin(${1:x})` as `sin(x)`: a snippet with its placeholders filled by their defaults. */
export function snippetSignature(snippet: string): string {
    return snippet
        .replace(/\$\{\d+\|([^,|]*)[^}]*\|\}/g, '$1')
        .replace(/\$\{\d+:([^}]*)\}/g, '$1')
        .replace(/\$\d+/g, '');
}

const VALUE_TYPE_TEXT: Readonly<Record<PropertyDefinition['valueType'], string>> = {
    expression: 'an expression',
    number: 'a number',
    string: 'a string',
    boolean: '`true`, `false`, or written bare as a flag',
    enum: 'one of the listed values',
    color: 'a `#hex` colour, a palette name, or an expression',
    range: 'a range, `lo..hi step s soft`',
    action: 'an action, or a run of them',
    style: 'the name of a style',
};

const PLACEMENT_TEXT: Readonly<Record<PropertyPlacement, string>> = {
    expression: 'an expression',
    folder: 'a folder',
    table: 'a table',
    column: 'a table column',
    image: 'an image',
    ticker: 'the ticker',
    import: 'an import',
    note: 'a note',
    config: '`config`',
    style: 'a style',
};

/** A property's documentation, in Markdown: what it does, what it takes, where it goes. */
export function propertyDocumentation(property: PropertyDefinition): string {
    const lines = [`Takes ${VALUE_TYPE_TEXT[property.valueType]}.`];
    if (property.valueType === 'enum' && property.values) {
        lines.push('', `Values: ${property.values.map(value => `\`${value}\``).join(', ')}.`);
    }
    if (property.valueType === 'color' && !property.appliesTo.includes('config')) {
        lines.push(
            '',
            `Palette: ${[...AXIS_PALETTE_HEX.keys()].map(name => `\`${name}\``).join(', ')}.`,
        );
    }
    const where = placementsOf(property.name).map(placement => PLACEMENT_TEXT[placement]);
    lines.push('', `Written on ${listOf(where)}.`);
    if (property.repeatable) lines.push('', 'May be given more than once.');
    return manifestDocumentation(property, lines.join('\n'));
}

function listOf(items: string[]): string {
    if (items.length <= 1) return items.join('');
    return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}
