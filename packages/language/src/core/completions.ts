// ═════════════════════════════════════════════════════════════════════════════
// Completions - editor-agnostic
// ═════════════════════════════════════════════════════════════════════════════

import { AXIS_MANIFEST } from '../language-manifest';
import { AxisCompletionItem, AxisPosition } from './types';

/**
 * All completions offered at `position` within `text`.
 *
 * The context rules are deliberately cheap (no parse): inside a `config` block
 * only config properties make sense, after a `#` on the line only metadata
 * properties do, and otherwise everything in scope is offered.
 */
export function getAxisCompletions(text: string, position: AxisPosition): AxisCompletionItem[] {
    const lines = text.split('\n');
    const lineText = lines[position.line] ?? '';
    const linePrefix = lineText.slice(0, position.character);
    const textUpToPosition = [...lines.slice(0, position.line), linePrefix].join('\n');

    if (isInConfigBlock(textUpToPosition)) {
        return getConfigPropertyCompletions();
    }

    if (linePrefix.includes('#')) {
        return getMetadataCompletions();
    }

    return [
        ...getFunctionCompletions(),
        ...getConstantCompletions(),
        ...getKeywordCompletions(),
        ...getUserDefinedCompletions(text),
    ];
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
    ];
}

/** Functions and variables the document itself defines. */
function getUserDefinedCompletions(text: string): AxisCompletionItem[] {
    const completions: AxisCompletionItem[] = [];
    const seen = new Set<string>();

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
