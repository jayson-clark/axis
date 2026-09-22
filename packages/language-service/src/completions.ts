// ═════════════════════════════════════════════════════════════════════════════
// Completions
// ═════════════════════════════════════════════════════════════════════════════
//
// What is offered depends on where the cursor is (`context.ts`): at the start
// of a statement, the keywords that may start one there and everything an
// expression may hold; after an `@` or in a `config` or `style` block, the
// properties legal on *that* statement (the manifest's placements); after a
// property's colon, what that property takes - its enum values, the palette,
// the styles this file defines, `true` and `false`; and in an expression the
// builtins and the names the file defines, plus the parameters of the
// definition being written and `dt` in a ticker's handler.

import {
    AXIS_MANIFEST,
    AXIS_PALETTE,
    findProperty,
    propertiesFor,
    type PropertyPlacement,
    type SyntaxTree,
} from '@axis-dsl/syntax';
import { cursorContext, type CursorContext, type StatementOwner } from './context';
import { definitionSummary, definitionText, importedText, propertyDocumentation } from './describe';
import {
    offsetAt,
    spanToRange,
    toTree,
    touches,
    type DocumentInput,
    type Position,
    type Range,
} from './document';
import { KEYWORD_INFO, STATEMENT_KEYWORDS } from './keywords';
import { pathCompletionsAt, type DirectoryEntry, type PathKind } from './paths';
import { importedSymbols, type ImportedSymbol, type ProgramOptions } from './program';
import { analyze, type SymbolDefinition } from './symbols';

/** Editor-agnostic completion category. Adapters map these to their own enums. */
export type CompletionKind =
    | 'keyword'
    | 'function'
    | 'constant'
    | 'variable'
    | 'parameter'
    | 'property'
    | 'enumMember'
    | 'color'
    | 'macro'
    | 'style'
    | 'file'
    | 'folder';

export interface CompletionItem {
    label: string;
    kind: CompletionKind;
    /** One line, shown beside the label. */
    detail: string;
    /** Markdown, shown when the item is selected. */
    documentation?: string;
    /**
     * TextMate snippet body (`${1:x}`, `${1|a,b|}`, `$0`) inserted instead of
     * the label. Both VSCode and Monaco speak this dialect natively.
     */
    snippet?: string;
    /** The text the item replaces: the partial word before the cursor. */
    range?: Range;
    /** Orders items with equal relevance to the text typed so far. */
    sortText?: string;
    /** Whether accepting the item should ask for completions again: a directory, mid-path. */
    retrigger?: boolean;
}

export interface CompletionOptions extends ProgramOptions {
    /**
     * Lists a directory for path completion inside `import "…"` and `image
     * "…"`: the directory as written, relative to the document, which the host
     * resolves. Without it a path offers nothing; a host that can only list
     * asynchronously calls `getPathContext` and `getPathCompletions` itself.
     */
    listDirectory?: (directory: string, kind: PathKind) => readonly DirectoryEntry[];
}

/** What every item builder needs: the tree, the cursor, and how to reach the imports. */
interface Request {
    tree: SyntaxTree;
    offset: number;
    options: ProgramOptions;
}

// Relevance, most first: what the script itself defines is what is most often
// meant, then what the grammar expects at this point, then the builtins.
const RANK = {
    parameter: '0',
    user: '1',
    property: '1',
    value: '1',
    keyword: '2',
    function: '3',
    constant: '4',
    operator: '5',
} as const;

/** Everything worth offering at `position`. */
export function getCompletions(
    input: DocumentInput,
    position: Position,
    options: CompletionOptions = {},
): CompletionItem[] {
    const tree = toTree(input);
    const paths = pathCompletionsAt(tree, position, options.listDirectory);
    if (paths) return paths;

    const offset = offsetAt(tree, position);
    const { context, word } = cursorContext(tree, offset);
    const range = spanToRange(tree, word);
    return itemsFor({ tree, offset, options }, context)
        .map(item => ({ ...item, range }))
        .sort((a, b) => (a.sortText ?? '').localeCompare(b.sortText ?? ''));
}

function itemsFor(request: Request, context: CursorContext): CompletionItem[] {
    switch (context.kind) {
        case 'none':
        case 'path':
            return [];
        case 'statement':
            return [
                ...keywordItems(context.owner),
                ...expressionItems(request, { ticker: false, parameters: [], locals: [] }),
            ];
        case 'expression':
            return context.member ? memberItems() : expressionItems(request, context);
        case 'propertyKey':
            return propertyKeyItems(context.placement, context.written);
        case 'propertyValue':
            return propertyValueItems(request, context.placement, context.key);
    }
}

function keywordItems(owner: StatementOwner): CompletionItem[] {
    return STATEMENT_KEYWORDS.filter(keyword =>
        KEYWORD_INFO[keyword].allowedIn?.includes(owner),
    ).map(keyword => ({
        label: keyword,
        kind: 'keyword',
        detail: KEYWORD_INFO[keyword].detail,
        documentation: KEYWORD_INFO[keyword].documentation,
        snippet: KEYWORD_INFO[keyword].snippet,
        sortText: RANK.keyword + keyword,
    }));
}

function builtinItems(ticker: boolean): CompletionItem[] {
    const functions = AXIS_MANIFEST.functions.map((fn): CompletionItem => ({
        label: fn.name,
        kind: 'function',
        detail: fn.detail,
        documentation: `Builtin ${fn.category} function.`,
        snippet: fn.snippet,
        sortText: RANK.function + fn.name,
    }));
    const constants = AXIS_MANIFEST.constants.map((constant): CompletionItem => ({
        label: constant.name,
        kind: 'constant',
        detail: constant.detail,
        sortText: RANK.constant + constant.name,
    }));
    // `dt` is Desmos' in a ticker's handler and an error anywhere else.
    const operators = AXIS_MANIFEST.operators
        .filter(operator => ticker || operator.category !== 'ticker')
        .map((operator): CompletionItem => ({
            label: operator.name,
            kind: operator.name === 'for' || operator.name === 'with' ? 'keyword' : 'constant',
            detail: operator.detail,
            sortText:
                (operator.category === 'ticker' ? RANK.parameter : RANK.operator) + operator.name,
        }));
    return [...functions, ...constants, ...operators];
}

/** The names the file defines that are visible at `offset`. */
function userItems(
    { tree, offset, options }: Request,
    parameters: readonly string[],
    locals: readonly string[],
): CompletionItem[] {
    const analysis = analyze(tree);
    const items: CompletionItem[] = [];
    const seen = new Set<string>();
    const add = (item: CompletionItem) => {
        if (seen.has(item.label)) return;
        seen.add(item.label);
        items.push(item);
    };

    for (const name of parameters) {
        add({
            label: name,
            kind: 'parameter',
            detail: 'Parameter',
            sortText: RANK.parameter + name,
        });
    }
    for (const name of locals) {
        add({
            label: name,
            kind: 'variable',
            detail: 'Bound by with / for',
            sortText: RANK.parameter + name,
        });
    }
    // Parameters and bindings the tree already knows are in scope here - of a
    // definition written in full, which the cursor has come back into.
    for (const definition of analysis.definitions) {
        if (!definition.scope || !touches(definition.scope, offset)) continue;
        add({
            label: definition.name,
            kind: definition.kind === 'parameter' ? 'parameter' : 'variable',
            detail: definitionSummary(tree, definition),
            sortText: RANK.parameter + definition.name,
        });
    }
    for (const definition of [
        ...analysis.globals.macro.values(),
        ...analysis.globals.value.values(),
    ]) {
        add(userItem(tree, definition));
    }
    // Then what the imports define, which the file may use as freely as its own.
    for (const symbol of importedSymbols(tree, options)) {
        if (symbol.kind === 'style') continue;
        add(importedItem(symbol));
    }
    return items;
}

function userItem(tree: SyntaxTree, definition: SymbolDefinition): CompletionItem {
    const callable =
        definition.kind === 'function' || (definition.kind === 'macro' && definition.parameters);
    const parameters = definition.parameters ?? [];
    return {
        label: definition.name,
        kind:
            definition.kind === 'macro'
                ? 'macro'
                : definition.kind === 'function'
                  ? 'function'
                  : 'variable',
        detail: definitionSummary(tree, definition),
        documentation: '```axis\n' + definitionText(tree, definition) + '\n```',
        snippet: callable ? callSnippet(definition.name, parameters) : undefined,
        sortText: RANK.user + definition.name,
    };
}

function importedItem(symbol: ImportedSymbol): CompletionItem {
    const text = importedText(symbol);
    const callable = symbol.kind === 'function' || (symbol.kind === 'macro' && symbol.parameters);
    return {
        label: symbol.name,
        kind: symbol.kind === 'variable' ? 'variable' : symbol.kind,
        detail: `${firstLine(text)}  (${symbol.file.path.split(/[\\/]/).pop()})`,
        documentation: '```axis\n' + text + '\n```\n\nFrom `' + symbol.file.path + '`.',
        snippet: callable ? callSnippet(symbol.name, symbol.parameters ?? []) : undefined,
        sortText: RANK.user + symbol.name,
    };
}

const callSnippet = (name: string, parameters: readonly string[]) =>
    `${name}(${parameters.map((parameter, at) => `\${${at + 1}:${parameter}}`).join(', ')})`;

const firstLine = (text: string) => {
    const line = text.split('\n')[0];
    return line.length > 60 ? `${line.slice(0, 59)}…` : line;
};

function expressionItems(
    request: Request,
    context: { ticker: boolean; parameters: readonly string[]; locals: readonly string[] },
): CompletionItem[] {
    const user = userItems(request, context.parameters, context.locals);
    const taken = new Set(user.map(item => item.label));
    return [...user, ...builtinItems(context.ticker).filter(item => !taken.has(item.label))];
}

/** After a `.`: a point's coordinates, and the list functions written postfix (spec §5.4). */
function memberItems(): CompletionItem[] {
    const coordinates: CompletionItem[] = ['x', 'y'].map(name => ({
        label: name,
        kind: 'property',
        detail: `The point's ${name} coordinate`,
        sortText: RANK.property + name,
    }));
    const functions = AXIS_MANIFEST.functions
        .filter(fn => fn.category === 'list' || fn.category === 'statistics')
        .map((fn): CompletionItem => ({
            label: fn.name,
            kind: 'function',
            detail: fn.detail,
            sortText: RANK.function + fn.name,
        }));
    return [...coordinates, ...functions];
}

function propertyKeyItems(
    placement: PropertyPlacement,
    written: readonly string[],
): CompletionItem[] {
    const given = new Set(written);
    return propertiesFor(placement)
        .filter(property => property.repeatable || !given.has(property.name))
        .map(property => ({
            label: property.name,
            kind: 'property',
            detail: property.detail,
            documentation: propertyDocumentation(property),
            snippet: property.snippet,
            sortText: RANK.property + property.name,
        }));
}

function propertyValueItems(
    request: Request,
    placement: PropertyPlacement,
    key: string,
): CompletionItem[] {
    const { tree } = request;
    const property = findProperty(key, placement) ?? findProperty(key);
    const expressions = () =>
        expressionItems(request, { ticker: false, parameters: [], locals: [] });
    if (!property) return expressions();

    const value = (
        label: string,
        kind: CompletionItem['kind'],
        detail: string,
    ): CompletionItem => ({
        label,
        kind,
        detail,
        sortText: RANK.value + label,
    });

    switch (property.valueType) {
        case 'enum':
            return (property.values ?? []).map(name =>
                value(name, 'enumMember', `${property.name}: ${name}`),
            );
        case 'boolean':
            return ['true', 'false'].map(name =>
                value(name, 'constant', `${property.name}: ${name}`),
            );
        case 'color': {
            const palette = AXIS_PALETTE.map(color => value(color.name, 'color', color.hex));
            // A config colour is a hex string to Desmos, so only the palette
            // and a literal will do there (spec §4.3).
            return placement === 'config' ? palette : [...palette, ...expressions()];
        }
        case 'style': {
            const local = [...analyze(tree).globals.style.values()].map(style => ({
                ...value(style.name, 'style', definitionSummary(tree, style)),
                documentation: '```axis\n' + definitionText(tree, style) + '\n```',
            }));
            const taken = new Set(local.map(item => item.label));
            const imported = importedSymbols(tree, request.options)
                .filter(symbol => symbol.kind === 'style' && !taken.has(symbol.name))
                .map(symbol => ({ ...importedItem(symbol), sortText: RANK.value + symbol.name }));
            return [...local, ...imported];
        }
        case 'string':
        case 'number':
            return [];
        case 'range':
            // The words a range goes on with, once its ends are written.
            return [
                ...(['step', 'soft'] as const).map(keyword => ({
                    ...value(keyword, 'keyword', KEYWORD_INFO[keyword].detail),
                    documentation: KEYWORD_INFO[keyword].documentation,
                    sortText: RANK.keyword + keyword,
                })),
                ...expressions(),
            ];
        default:
            return expressions();
    }
}
