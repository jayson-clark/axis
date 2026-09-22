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
    type SyntaxTree,
} from '@axis-dsl/syntax';
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
    const statement = definition.statement;
    if (statement.kind === 'ExpressionStatement') {
        return printStatement({ ...statement, metadata: null });
    }
    return printStatement(statement);
}

/** The first line of a definition, cut short enough to sit beside a completion. */
export function definitionSummary(tree: SyntaxTree, definition: SymbolDefinition): string {
    const text = definitionText(tree, definition).split('\n')[0];
    return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

const FUNCTIONS = new Map(AXIS_MANIFEST.functions.map(fn => [fn.name, fn]));
const CONSTANTS = new Map(AXIS_MANIFEST.constants.map(constant => [constant.name, constant]));
const OPERATORS = new Map(AXIS_MANIFEST.operators.map(operator => [operator.name, operator]));

/** A builtin's signature, as a completion's label would show it, and its doc line. */
export function builtinDescription(
    name: string,
    kind: BuiltinKind,
): { signature: string; detail: string; category: string } | undefined {
    if (kind === 'function') {
        const fn = FUNCTIONS.get(name);
        if (!fn) return undefined;
        return {
            signature: snippetSignature(fn.snippet ?? `${name}()`),
            detail: fn.detail,
            category: fn.category,
        };
    }
    if (kind === 'constant') {
        const constant = CONSTANTS.get(name);
        return (
            constant && { signature: name, detail: constant.detail, category: constant.category }
        );
    }
    const operator = OPERATORS.get(name);
    return operator && { signature: name, detail: operator.detail, category: operator.category };
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
    const lines = [property.detail, '', `Takes ${VALUE_TYPE_TEXT[property.valueType]}.`];
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
    return lines.join('\n');
}

function listOf(items: string[]): string {
    if (items.length <= 1) return items.join('');
    return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}
