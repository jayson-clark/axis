// ═════════════════════════════════════════════════════════════════════════════
// Completions - editor-agnostic
// ═════════════════════════════════════════════════════════════════════════════

import { AXIS_MANIFEST } from '../language-manifest';
import { bracketDelta } from './brackets';
import { findMacroDefinitions } from './macros';
import { TICKER_KEYWORD } from './ticker';
import { AxisCompletionItem, AxisPosition } from './types';

/**
 * All completions offered at `position` within `text`.
 *
 * The context rules are deliberately cheap (no parse): inside a `config` block
 * only config properties make sense, inside a `#{ … }` block or after a `#` on
 * the line only metadata properties do - the ticker's own, where the ticker is
 * what carries them - and otherwise everything in scope is offered.
 */
export function getAxisCompletions(text: string, position: AxisPosition): AxisCompletionItem[] {
    const lines = text.split('\n');
    const lineText = lines[position.line] ?? '';
    const linePrefix = lineText.slice(0, position.character);
    const textUpToPosition = [...lines.slice(0, position.line), linePrefix].join('\n');

    // Inside a block the properties are on lines of their own, with no `#` in
    // front of them, so what they belong to comes from the statement the block
    // was opened on rather than from the line being typed.
    const annotated = openMetadataBlock(textUpToPosition);
    if (annotated !== undefined) {
        return TICKER_KEYWORD.test(annotated)
            ? getTickerPropertyCompletions()
            : getMetadataCompletions();
    }

    if (isInConfigBlock(textUpToPosition)) {
        return getConfigPropertyCompletions();
    }

    if (linePrefix.includes('#')) {
        return TICKER_KEYWORD.test(lineText.trim())
            ? getTickerPropertyCompletions()
            : getMetadataCompletions();
    }

    return [
        ...getFunctionCompletions(),
        ...getConstantCompletions(),
        ...getOperatorCompletions(),
        ...getKeywordCompletions(),
        ...getUserDefinedCompletions(text),
    ];
}

/**
 * The statement a still-open `#{ … }` block annotates, or undefined when the
 * text does not end inside one.
 *
 * Brace depth rather than a bare `}`, since a property may be written as a
 * `{min: 0, max: 5}` of its own and closing that one closes nothing.
 */
function openMetadataBlock(textUpToPosition: string): string | undefined {
    let annotated: string | undefined;
    let depth = 0;

    for (const line of textUpToPosition.split('\n')) {
        if (annotated === undefined) {
            const opener = /(^|\s)#\{/.exec(line);
            if (!opener) {
                continue;
            }
            const at = opener.index + opener[1].length;
            annotated = line.slice(0, at).trim();
            depth = 1 + bracketDelta(line.slice(at + 2));
        } else {
            depth += bracketDelta(line);
        }

        if (depth <= 0) {
            annotated = undefined;
        }
    }

    return annotated;
}

/** True when the text ends inside an unclosed `config { ... }` block. */
function isInConfigBlock(textUpToPosition: string): boolean {
    let inConfig = false;

    for (const line of textUpToPosition.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('config')) {
            inConfig = true;
        } else if (trimmed === '}' && inConfig) {
            inConfig = false;
        }
    }

    return inConfig;
}

function getConfigPropertyCompletions(): AxisCompletionItem[] {
    return AXIS_MANIFEST.configProperties.map(prop => ({
        label: prop.name,
        kind: 'property' as const,
        detail: prop.detail,
        snippet: prop.snippet,
    }));
}

function getTickerPropertyCompletions(): AxisCompletionItem[] {
    return AXIS_MANIFEST.tickerProperties.map(prop => ({
        label: prop.name,
        kind: 'property' as const,
        detail: prop.detail,
        snippet: prop.snippet,
    }));
}

function getMetadataCompletions(): AxisCompletionItem[] {
    return AXIS_MANIFEST.metadata.map(prop => ({
        label: prop.name,
        kind: 'property' as const,
        detail: prop.detail,
        snippet: prop.snippet,
    }));
}

function getFunctionCompletions(): AxisCompletionItem[] {
    return AXIS_MANIFEST.functions.map(func => ({
        label: func.name,
        kind: 'function' as const,
        detail: func.detail,
        snippet: func.snippet,
    }));
}

function getConstantCompletions(): AxisCompletionItem[] {
    return AXIS_MANIFEST.constants.map(constant => ({
        label: constant.name,
        kind: 'constant' as const,
        detail: constant.detail,
    }));
}

function getOperatorCompletions(): AxisCompletionItem[] {
    return AXIS_MANIFEST.operators.map(operator => ({
        label: operator.name,
        kind: 'constant' as const,
        detail: operator.detail,
    }));
}

function getKeywordCompletions(): AxisCompletionItem[] {
    return [
        {
            label: 'folder',
            kind: 'keyword',
            detail: 'Create a folder',
            snippet: 'folder "${1:name}" {\n\t$0\n}',
        },
        {
            label: 'table',
            kind: 'keyword',
            detail: 'Create a table',
            snippet: 'table {\n\t${1:x} = [${2:1, 2, 3}],\n\t${3:y} = [${4:1, 4, 9}]\n}',
        },
        {
            label: 'import',
            kind: 'keyword',
            detail: 'Drop another script in, flattened into a folder',
            snippet: 'import "${1:./file.axis}"',
        },
        {
            label: 'config',
            kind: 'keyword',
            detail: 'Configure calculator settings',
            snippet: 'config {\n\t${1:degreeMode}: ${2|true,false|}$0\n}',
        },
        {
            label: 'ticker',
            kind: 'keyword',
            detail: 'Run an action over and over while the graph is open',
            snippet: 'ticker ${1:a} -> ${2:a + 1} # minStep: ${3:50}, playing: true',
        },
        {
            label: 'macro',
            kind: 'keyword',
            detail: 'Substitute a piece of source wherever its name appears',
            snippet: 'macro ${1:NAME}(${2:a}) ${3:a * 2}',
        },
    ];
}

/** Macros, functions and variables the document itself defines. */
function getUserDefinedCompletions(text: string): AxisCompletionItem[] {
    const completions: AxisCompletionItem[] = [];
    const seen = new Set<string>();

    // Macros first: a name is only ever one of these, and a macro is the one
    // that expands, whatever else in the document happens to share its name.
    for (const macro of findMacroDefinitions(text)) {
        if (seen.has(macro.name)) {
            continue;
        }
        seen.add(macro.name);
        completions.push({
            label: macro.name,
            kind: macro.parameters ? 'function' : 'constant',
            detail: `Macro: ${macro.body}`,
            ...(macro.parameters?.length && {
                snippet: `${macro.name}(${macro.parameters
                    .map((parameter, at) => `\${${at + 1}:${parameter}}`)
                    .join(', ')})`,
            }),
        });
    }

    // Function definitions: name(x) = ...
    const functionRegex = /([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)\s*=/g;
    let match: RegExpExecArray | null;
    while ((match = functionRegex.exec(text)) !== null) {
        const funcName = match[1];
        if (!seen.has(funcName)) {
            seen.add(funcName);
            completions.push({
                label: funcName,
                kind: 'function',
                detail: 'User-defined function',
            });
        }
    }

    // Variable definitions: name = ...
    const variableRegex = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=/gm;
    while ((match = variableRegex.exec(text)) !== null) {
        const varName = match[1];
        if (!seen.has(varName)) {
            seen.add(varName);
            completions.push({
                label: varName,
                kind: 'variable',
                detail: 'User-defined variable',
            });
        }
    }

    return completions;
}
