// ═════════════════════════════════════════════════════════════════════════════
// The tree, written out
// ═════════════════════════════════════════════════════════════════════════════
//
// A syntax tree as a one-line S-expression: `y = 1/2x` is
// `(= y (implicit (/ 1 2) x))`. For tests, which want to say what shape a
// parse has without spelling out every span, and for anybody debugging one.
//
// Spans are left out on purpose - a test asserting a shape should not break
// because a space moved. `_` stands for an absent part.

import type * as ast from './ast';

type Node =
    | ast.File
    | ast.Statement
    | ast.Expression
    | ast.Metadata
    | ast.Property
    | ast.Range
    | ast.TableColumn
    | ast.PiecewiseBranch
    | ast.Binding;

export function debugTree(node: Node | null): string {
    if (node === null) return '_';
    const list = (head: string, ...parts: (string | null | undefined | false)[]) =>
        `(${[head, ...parts.filter((part): part is string => typeof part === 'string')].join(' ')})`;
    const all = (nodes: readonly Node[]) => nodes.map(debugTree);
    const meta = (metadata: ast.Metadata | null) => metadata && debugTree(metadata);

    switch (node.kind) {
        case 'File':
            return list('file', ...all(node.statements));

        // Statements
        case 'ConfigStatement':
            return list('config', ...all(node.entries));
        case 'FolderStatement':
            return list(
                'folder',
                node.title ? debugTree(node.title) : '_',
                meta(node.metadata),
                ...all(node.body),
            );
        case 'TableStatement':
            return list('table', meta(node.metadata), ...all(node.columns));
        case 'TableColumn':
            return list(
                'column',
                debugTree(node.header),
                node.values && `[${all(node.values).join(' ')}]`,
                meta(node.metadata),
            );
        case 'StyleStatement':
            return list('style', node.name.name, ...all(node.entries));
        case 'MacroStatement':
            return list(
                'macro',
                node.name.name,
                node.parameters && `(${node.parameters.map(p => p.name).join(' ')})`,
                debugTree(node.body),
            );
        case 'ImportStatement':
            return list(
                'import',
                debugTree(node.path),
                node.alias && `as ${debugTree(node.alias)}`,
                meta(node.metadata),
            );
        case 'ImageStatement':
            return list('image', debugTree(node.source), meta(node.metadata));
        case 'TickerStatement':
            return list('ticker', debugTree(node.handler), meta(node.metadata));
        case 'NoteStatement':
            return list('note', debugTree(node.text), meta(node.metadata));
        case 'ExpressionStatement':
            return node.metadata
                ? list('statement', debugTree(node.expression), meta(node.metadata))
                : debugTree(node.expression);
        case 'ErrorStatement':
            return '(error-statement)';

        // Properties
        case 'Metadata':
            return list(node.block ? '@{}' : '@', ...all(node.entries));
        case 'Property':
            if (!node.colon) return node.key.name;
            return `${node.key.name}:${debugTree(node.value)}`;
        case 'Range':
            return list(
                'range',
                debugTree(node.min),
                debugTree(node.max),
                node.step && `step ${debugTree(node.step)}`,
                node.soft === 'both' ? 'soft' : node.soft !== 'none' && `soft-${node.soft}`,
            );

        // Expressions
        case 'Number':
            return node.value;
        case 'Identifier':
            return node.name;
        case 'String':
            return JSON.stringify(node.value);
        case 'Color':
            return node.value;
        case 'Paren':
            return list('paren', debugTree(node.expression));
        case 'Tuple':
            return list('tuple', ...all(node.elements));
        case 'List':
            return list('list', ...all(node.elements));
        case 'ListRange':
            return list('...', debugTree(node.from), debugTree(node.to));
        case 'Piecewise':
            return list(
                'piecewise',
                ...all(node.branches),
                node.otherwise && list('else', debugTree(node.otherwise)),
            );
        case 'PiecewiseBranch':
            return node.value
                ? list('if', debugTree(node.condition), debugTree(node.value))
                : list('if', debugTree(node.condition));
        case 'Abs':
            return list('abs', debugTree(node.expression));
        case 'Unary':
            return list(node.operator, debugTree(node.operand));
        case 'Binary':
            return list(node.operator, debugTree(node.left), debugTree(node.right));
        case 'Comparison':
            if (node.operators.length === 1) {
                return list(node.operators[0], ...all(node.operands));
            }
            return list(
                'chain',
                ...node.operands.flatMap((operand, i) =>
                    i === 0 ? [debugTree(operand)] : [node.operators[i - 1], debugTree(operand)],
                ),
            );
        case 'Call':
            return list('call', node.callee.name, ...all(node.arguments));
        case 'Index':
            return list('index', debugTree(node.target), debugTree(node.index));
        case 'Member':
            return list('.', debugTree(node.target), node.name.name);
        case 'Factorial':
            return list('!', debugTree(node.operand));
        case 'Action':
            return list('->', debugTree(node.target), debugTree(node.value));
        case 'Sequence':
            return list('run', ...all(node.elements));
        case 'Binding':
            return list(node.name.name, debugTree(node.value));
        case 'With':
            return list('with', debugTree(node.body), ...all(node.bindings));
        case 'For':
            return list('for', debugTree(node.body), ...all(node.bindings));
        case 'ErrorExpression':
            return '(error)';
    }
}
