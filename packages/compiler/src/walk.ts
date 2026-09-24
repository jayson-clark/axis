// ═════════════════════════════════════════════════════════════════════════════
// Walking the syntax tree
// ═════════════════════════════════════════════════════════════════════════════
//
// The checker, the macro expander and the lowering pass all need to visit every
// expression under a node, and the expander also needs to rebuild one with some
// of its children replaced. Written once here, so that a node kind added to
// `ast.ts` is taught to all three in one place - and so that none of them has
// its own idea of which parts of a node are expressions. A `Call`'s callee, a
// `Member`'s name, a binding's name and the variable of a `sum` or a `d/dx`
// are identifiers, but they are not
// references to anything a macro could stand for, and every pass agrees on that
// because it is decided here.

import type { Expression, Statement } from '@axis-dsl/syntax';

/** Every expression directly under `node`, in source order. */
export function childrenOf(node: Expression): Expression[] {
    switch (node.kind) {
        case 'Number':
        case 'Identifier':
        case 'String':
        case 'Color':
        case 'ErrorExpression':
            return [];
        case 'Paren':
        case 'Abs':
            return [node.expression];
        case 'Tuple':
        case 'List':
        case 'Sequence':
            return node.elements;
        case 'ListRange':
            return [node.from, node.to];
        case 'Piecewise':
            return [
                ...node.branches.flatMap(branch =>
                    branch.value ? [branch.condition, branch.value] : [branch.condition],
                ),
                ...(node.otherwise ? [node.otherwise] : []),
            ];
        case 'Unary':
        case 'Factorial':
            return [node.operand];
        case 'Binary':
            return [node.left, node.right];
        case 'Comparison':
            return node.operands;
        case 'Call':
        case 'Prime':
            return node.arguments;
        case 'BigOperator':
            return [node.from, node.to, node.body];
        case 'Derivative':
            return [node.body];
        case 'Index':
            return [node.target, node.index];
        case 'Member':
            return [node.target, ...(node.arguments ?? [])];
        case 'Action':
            return [node.target, node.value];
        case 'With':
        case 'For':
            return [node.body, ...node.bindings.map(binding => binding.value)];
    }
}

/** Whether `test` holds for `node` or for anything under it. */
export function someNode(node: Expression, test: (node: Expression) => boolean): boolean {
    return test(node) || childrenOf(node).some(child => someNode(child, test));
}

/**
 * `node` with each child replaced by what `map` makes of it, or `node` itself
 * when nothing changed - so a tree with no macro in it comes out of the
 * expander as the very same objects, and a caller can tell by identity.
 */
export function mapChildren(node: Expression, map: (child: Expression) => Expression): Expression {
    const list = (nodes: Expression[]): Expression[] => {
        const mapped = nodes.map(map);
        return mapped.every((child, index) => child === nodes[index]) ? nodes : mapped;
    };

    switch (node.kind) {
        case 'Number':
        case 'Identifier':
        case 'String':
        case 'Color':
        case 'ErrorExpression':
            return node;
        case 'Paren':
        case 'Abs': {
            const expression = map(node.expression);
            return expression === node.expression ? node : { ...node, expression };
        }
        case 'Tuple':
        case 'List':
        case 'Sequence': {
            const elements = list(node.elements);
            return elements === node.elements ? node : { ...node, elements };
        }
        case 'ListRange': {
            const from = map(node.from);
            const to = map(node.to);
            return from === node.from && to === node.to ? node : { ...node, from, to };
        }
        case 'Piecewise': {
            let changed = false;
            const branches = node.branches.map(branch => {
                const condition = map(branch.condition);
                const value = branch.value && map(branch.value);
                if (condition === branch.condition && value === branch.value) {
                    return branch;
                }
                changed = true;
                return { ...branch, condition, value };
            });
            const otherwise = node.otherwise && map(node.otherwise);
            return changed || otherwise !== node.otherwise
                ? { ...node, branches, otherwise }
                : node;
        }
        case 'Unary':
        case 'Factorial': {
            const operand = map(node.operand);
            return operand === node.operand ? node : { ...node, operand };
        }
        case 'Binary': {
            const left = map(node.left);
            const right = map(node.right);
            return left === node.left && right === node.right ? node : { ...node, left, right };
        }
        case 'Comparison': {
            const operands = list(node.operands);
            return operands === node.operands ? node : { ...node, operands };
        }
        case 'Call':
        case 'Prime': {
            const args = list(node.arguments);
            return args === node.arguments ? node : { ...node, arguments: args };
        }
        case 'BigOperator': {
            const from = map(node.from);
            const to = map(node.to);
            const body = map(node.body);
            return from === node.from && to === node.to && body === node.body
                ? node
                : { ...node, from, to, body };
        }
        case 'Derivative': {
            const body = map(node.body);
            return body === node.body ? node : { ...node, body };
        }
        case 'Index': {
            const target = map(node.target);
            const index = map(node.index);
            return target === node.target && index === node.index
                ? node
                : { ...node, target, index };
        }
        case 'Member': {
            const target = map(node.target);
            const args = node.arguments && list(node.arguments);
            return target === node.target && args === node.arguments
                ? node
                : { ...node, target, ...(args && { arguments: args }) };
        }
        case 'Action': {
            const target = map(node.target);
            const value = map(node.value);
            return target === node.target && value === node.value
                ? node
                : { ...node, target, value };
        }
        case 'With':
        case 'For': {
            const body = map(node.body);
            let changed = body !== node.body;
            const bindings = node.bindings.map(binding => {
                const value = map(binding.value);
                if (value === binding.value) {
                    return binding;
                }
                changed = true;
                return { ...binding, value };
            });
            return changed ? { ...node, body, bindings } : node;
        }
    }
}

/**
 * Every statement in a file, folders opened: a folder is visited, then what is
 * inside it. What a statement is nested in is handed along, for the checks
 * that care where a statement stands.
 */
export function forEachStatement(
    statements: readonly Statement[],
    visit: (statement: Statement, folder: Statement | undefined) => void,
    folder?: Statement,
): void {
    for (const statement of statements) {
        visit(statement, folder);
        if (statement.kind === 'FolderStatement') {
            forEachStatement(statement.body, visit, statement);
        }
    }
}
