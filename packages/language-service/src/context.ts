// ═════════════════════════════════════════════════════════════════════════════
// Cursor context - what could be written where the cursor is
// ═════════════════════════════════════════════════════════════════════════════
//
// Completion is asked for in the middle of typing, which is exactly when the
// tree is least use: `y = x @ ` has an empty metadata clause the parser has
// already given up on, and `config {` with no `}` yet is a block whose span
// ends at its brace. So the context is read from the tokens instead - which
// the lexer produces for any text at all - by replaying the statement grammar
// of spec §3 over them up to the cursor: which block the cursor is in, which
// statement it is in and how far along, whether an `@` has opened metadata and
// whether the cursor is at a key or after one's colon.
//
// The replay only has to be as precise as a completion needs. It tracks the
// frames that change what may be written - a statement list, a table's
// columns, a block of properties, an expression bracket - and within a
// statement just enough to tell a key from a value and a ticker from a
// definition.

import type { PropertyPlacement, Span, SyntaxTree, Token } from '@axis-dsl/syntax';
import { isTrivia } from '@axis-dsl/syntax';

/** Where a statement list is: the file, a folder's body, or a table's columns. */
export type StatementOwner = 'file' | 'folder' | 'table';

export type CursorContext =
    /** Nothing is worth offering: inside a comment, a note, a name being given. */
    | { kind: 'none' }
    /** Inside the quotes of an `import` or `image`. */
    | { kind: 'path'; statement: 'import' | 'image'; string: Token }
    /** Where a statement starts, so a keyword may be written as well as an expression. */
    | { kind: 'statement'; owner: StatementOwner }
    /** Inside an expression. */
    | {
          kind: 'expression';
          /** In a ticker's handler, where `dt` means something. */
          ticker: boolean;
          /** The parameters of the function or macro whose body this is. */
          parameters: string[];
          /** Straight after a `.`: `P.x`, `L.count`. */
          member: boolean;
      }
    /** Where a property's name goes. */
    | { kind: 'propertyKey'; placement: PropertyPlacement; written: string[] }
    /** After a property's `:`. */
    | { kind: 'propertyValue'; placement: PropertyPlacement; key: string };

export interface CursorInfo {
    context: CursorContext;
    /** The partial word the cursor ends, which a completion replaces. Empty at a fresh position. */
    word: Span;
}

type Stage =
    /** Waiting for a property name. */
    | 'key'
    /** A name has been read; `:` or the next entry is due. */
    | 'afterKey'
    /** After the `:`. */
    | 'value'
    /** Inline, after a comma that may start a property or may continue the value. */
    | 'afterComma'
    /** Inline, a name read after such a comma, not yet known to be a key. */
    | 'pending'
    /** Something unreadable; nothing more is offered for this entry. */
    | 'lost';

interface PropertyState {
    placement: PropertyPlacement;
    stage: Stage;
    key: string;
    /** The key a `pending` name would fall back to continuing, if it turns out not to be one. */
    previous: string;
    pending: string;
    /** The keys this clause has already given. */
    written: string[];
}

interface StatementState {
    /** The statement's own tokens, outside every bracket and block. */
    tokens: Token[];
    /** Every token of it so far, brackets and all, for reading a definition's parameters. */
    all: Token[];
    /** The metadata clause the statement's `@` opened. */
    metadata: PropertyState | null;
    /** A block of its own it has opened and closed, or a `@{ … }`: it is over. */
    finished: boolean;
    /** Whether it has opened its block yet: only the first `{` after a block keyword opens one. */
    opened: boolean;
}

type Frame =
    | {
          kind: 'statements';
          owner: StatementOwner;
          /** Straight after the `{`, where the block's own metadata may go. */
          fresh: boolean;
          statement: StatementState;
      }
    | { kind: 'properties'; state: PropertyState }
    | { kind: 'bracket'; close: string; closed: boolean };

const OPENERS: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}' };

const BLOCK_KEYWORDS: ReadonlySet<string> = new Set(['folder', 'table', 'config', 'style']);

const newStatement = (): StatementState => ({
    tokens: [],
    all: [],
    metadata: null,
    finished: false,
    opened: false,
});

const newProperties = (placement: PropertyPlacement): PropertyState => ({
    placement,
    stage: 'key',
    key: '',
    previous: '',
    pending: '',
    written: [],
});

const isPunctuation = (token: Token, text: string) =>
    token.kind === 'punctuation' && token.text === text;

/** Whether a string token runs to the end of its line without its closing quote. */
function unterminated(tree: SyntaxTree, token: Token): boolean {
    return tree.diagnostics.some(
        diagnostic =>
            diagnostic.code === 'unterminated-string' && diagnostic.span.start === token.span.start,
    );
}

/** The context at an offset of the tree's source. */
export function cursorContext(tree: SyntaxTree, offset: number): CursorInfo {
    const tokens = tree.tokens;
    const none = (word: Span = { start: offset, end: offset }): CursorInfo => ({
        context: { kind: 'none' },
        word,
    });

    // The token the cursor is in or at the end of decides first whether there
    // is anything to complete at all, and what the word being typed is.
    let word: Span = { start: offset, end: offset };
    let limit = tokens.length;
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.span.start >= offset) {
            limit = i;
            break;
        }
        if (token.span.end < offset) continue;
        // The cursor is inside this token, or just past its end.
        const inside = offset < token.span.end;
        if (token.kind === 'comment') return none();
        if (token.kind === 'string') {
            if (!inside && !unterminated(tree, token)) continue;
            const before = previousMeaningful(tokens, i);
            if (
                before?.kind === 'keyword' &&
                (before.text === 'import' || before.text === 'image')
            ) {
                return {
                    context: { kind: 'path', statement: before.text, string: token },
                    word: { start: token.span.start + 1, end: offset },
                };
            }
            return none();
        }
        if (token.kind === 'identifier' || token.kind === 'keyword') {
            word = { start: token.span.start, end: offset };
            limit = i;
            break;
        }
        if (token.kind === 'number' || token.kind === 'color') return none();
        // Between the characters of `->` or `@{` there is nothing to offer;
        // between two spaces there is everything.
        if (inside && token.kind !== 'whitespace' && token.kind !== 'newline') return none();
    }

    const closers = matchBrackets(tokens);
    const frames: Frame[] = [
        { kind: 'statements', owner: 'file', fresh: false, statement: newStatement() },
    ];
    let last: Token | null = null;

    for (let i = 0; i < limit; i++) {
        const token = tokens[i];
        if (isTrivia(token) || token.kind === 'eof') continue;
        if (token.kind !== 'newline') nearestStatement(frames)?.all.push(token);
        step(frames, token, closers[i] >= 0);
        last = token.kind === 'newline' ? last : token;
    }

    return { context: contextOf(frames, last, word), word };
}

function previousMeaningful(tokens: readonly Token[], index: number): Token | undefined {
    for (let i = index - 1; i >= 0; i--) {
        if (!isTrivia(tokens[i])) return tokens[i];
    }
    return undefined;
}

/**
 * For each opening bracket, whether anything closes it - which is what decides
 * whether a newline inside it ends the statement after all (spec §8: an
 * unclosed bracket costs one line rather than the file). -2 for other tokens.
 */
function matchBrackets(tokens: readonly Token[]): number[] {
    const result = tokens.map(() => -2);
    const open: number[] = [];
    tokens.forEach((token, i) => {
        if (token.kind !== 'punctuation') return;
        if (token.text in OPENERS || token.text === '@{') {
            result[i] = -1;
            open.push(i);
        } else if (token.text === ')' || token.text === ']' || token.text === '}') {
            for (let k = open.length - 1; k >= 0; k--) {
                const opener = tokens[open[k]].text;
                const closes = opener === '@{' ? '}' : OPENERS[opener];
                if (closes === token.text) {
                    result[open[k]] = i;
                    open.length = k;
                    break;
                }
            }
        }
    });
    return result;
}

/** Where the metadata of the statement in a frame goes, or null when it takes none. */
function placementOf(
    frame: Extract<Frame, { kind: 'statements' }>,
    statement: StatementState,
): PropertyPlacement | null {
    if (frame.fresh && statement.tokens.length === 0) {
        return frame.owner === 'folder' ? 'folder' : frame.owner === 'table' ? 'table' : null;
    }
    if (frame.owner === 'table') return 'column';
    const first = statement.tokens[0];
    if (!first) return null;
    if (first.kind === 'keyword') {
        switch (first.text) {
            case 'import':
                return 'import';
            case 'image':
                return 'image';
            case 'ticker':
                return 'ticker';
            default:
                return null;
        }
    }
    if (first.kind === 'string' && statement.tokens.length === 1) return 'note';
    return 'expression';
}

/** Advance the frames past one meaningful token. */
function step(frames: Frame[], token: Token, closed: boolean): void {
    const frame = frames[frames.length - 1];

    if (frame.kind === 'bracket') {
        if (token.kind === 'newline') {
            // Inside a bracket nothing closes, a newline ends the statement.
            if (!frame.closed) {
                while (frames[frames.length - 1].kind === 'bracket') frames.pop();
                step(frames, token, closed);
            }
            return;
        }
        if (token.kind === 'punctuation' && token.text in OPENERS) {
            frames.push({ kind: 'bracket', close: OPENERS[token.text], closed });
        } else if (token.kind === 'punctuation' && token.text === frame.close) {
            frames.pop();
        } else if (isPunctuation(token, '}')) {
            // A `}` closing no bracket closes the block the brackets are in.
            while (frames[frames.length - 1].kind === 'bracket') frames.pop();
            step(frames, token, closed);
        }
        return;
    }

    if (frame.kind === 'properties') {
        const state = frame.state;
        if (token.kind === 'newline' || isPunctuation(token, ';')) {
            finishEntry(state);
            return;
        }
        if (isPunctuation(token, '}')) {
            frames.pop();
            const parent = frames[frames.length - 1];
            if (parent.kind === 'statements') parent.statement.finished = true;
            return;
        }
        // In a block a comma is part of the value, or - between two entries -
        // the separator somebody meant a `;` to be.
        if (isPunctuation(token, ',') && state.stage !== 'value') {
            finishEntry(state);
            return;
        }
        property(frames, state, token, closed, false);
        return;
    }

    const statement = frame.statement;
    if (token.kind === 'newline' || isPunctuation(token, ';')) {
        frame.statement = newStatement();
        frame.fresh = false;
        return;
    }
    if (isPunctuation(token, '}')) {
        if (frames.length > 1) {
            frames.pop();
            const parent = frames[frames.length - 1];
            if (parent.kind === 'statements') parent.statement.finished = true;
        }
        return;
    }
    if (statement.metadata) {
        property(frames, statement.metadata, token, closed, true);
        return;
    }
    if (isPunctuation(token, '@')) {
        const placement = placementOf(frame, statement);
        statement.metadata = newProperties(placement ?? 'expression');
        if (!placement) statement.metadata.stage = 'lost';
        return;
    }
    if (isPunctuation(token, '@{')) {
        const placement = placementOf(frame, statement);
        const state = newProperties(placement ?? 'expression');
        if (!placement) state.stage = 'lost';
        frames.push({ kind: 'properties', state });
        return;
    }
    if (isPunctuation(token, '{')) {
        const first = statement.tokens[0];
        if (first?.kind === 'keyword' && BLOCK_KEYWORDS.has(first.text) && !statement.opened) {
            statement.opened = true;
            switch (first.text) {
                case 'folder':
                case 'table':
                    frames.push({
                        kind: 'statements',
                        owner: first.text,
                        fresh: true,
                        statement: newStatement(),
                    });
                    return;
                default:
                    frames.push({
                        kind: 'properties',
                        state: newProperties(first.text === 'config' ? 'config' : 'style'),
                    });
                    return;
            }
        }
    }
    if (token.kind === 'punctuation' && token.text in OPENERS) {
        statement.tokens.push(token);
        frames.push({ kind: 'bracket', close: OPENERS[token.text], closed });
        return;
    }
    statement.tokens.push(token);
}

/** A separator between entries: whatever the entry was, the next starts at its key. */
function finishEntry(state: PropertyState): void {
    if (state.stage === 'afterKey' || state.stage === 'pending') {
        state.written.push(state.stage === 'pending' ? state.pending : state.key);
    }
    state.stage = 'key';
}

/**
 * One token of a property entry, inline (`@ …`, with the comma rule of spec
 * §4.1) or in a block.
 */
function property(
    frames: Frame[],
    state: PropertyState,
    token: Token,
    closed: boolean,
    inline: boolean,
): void {
    const opens = token.kind === 'punctuation' && token.text in OPENERS;
    switch (state.stage) {
        case 'key':
        case 'afterComma':
            if (token.kind === 'identifier') {
                if (state.stage === 'key') {
                    state.key = token.text;
                    state.stage = 'afterKey';
                } else {
                    state.pending = token.text;
                    state.stage = 'pending';
                }
                return;
            }
            if (state.stage === 'afterComma') {
                // Not a name: the comma belonged to the value before it.
                state.stage = 'value';
                state.key = state.previous;
                property(frames, state, token, closed, inline);
                return;
            }
            state.stage = 'lost';
            return;
        case 'afterKey':
            if (isPunctuation(token, ':')) {
                state.written.push(state.key);
                state.stage = 'value';
            } else if (isPunctuation(token, ',')) {
                state.written.push(state.key);
                state.stage = 'key';
            } else {
                state.stage = 'lost';
            }
            return;
        case 'pending':
            if (isPunctuation(token, ':')) {
                state.key = state.pending;
                state.written.push(state.key);
                state.stage = 'value';
            } else if (isPunctuation(token, ',')) {
                // A bare flag: `@ color: RED, hidden, fill`.
                state.written.push(state.pending);
                state.stage = 'afterComma';
                state.previous = state.pending;
            } else {
                state.stage = 'value';
                state.key = state.previous;
                if (opens) frames.push({ kind: 'bracket', close: OPENERS[token.text], closed });
            }
            return;
        case 'value':
            if (inline && isPunctuation(token, ',')) {
                state.previous = state.key;
                state.stage = 'afterComma';
                return;
            }
            if (opens) frames.push({ kind: 'bracket', close: OPENERS[token.text], closed });
            return;
        case 'lost':
            if (inline && isPunctuation(token, ',')) {
                state.previous = '';
                state.stage = 'key';
            }
            return;
    }
}

function nearestStatement(frames: readonly Frame[]): StatementState | undefined {
    for (let i = frames.length - 1; i >= 0; i--) {
        const frame = frames[i];
        if (frame.kind === 'statements') return frame.statement;
    }
    return undefined;
}

/**
 * The parameters in scope in a statement being written, `f(a, b) = …` or
 * `macro m(a, b) = …`, read off its tokens: the tree has nothing to say about a
 * definition whose body is half typed.
 */
function parametersOf(tokens: readonly Token[]): string[] {
    let i = tokens[0]?.kind === 'keyword' && tokens[0].text === 'macro' ? 1 : 0;
    if (tokens[i]?.kind !== 'identifier' || !tokens[i + 1] || !isPunctuation(tokens[i + 1], '(')) {
        return [];
    }
    const names: string[] = [];
    i += 2;
    while (tokens[i] && !isPunctuation(tokens[i], ')')) {
        if (tokens[i].kind !== 'identifier') return [];
        names.push(tokens[i].text);
        i++;
        if (tokens[i] && isPunctuation(tokens[i], ',')) i++;
    }
    return tokens[i + 1] && isPunctuation(tokens[i + 1], '=') ? names : [];
}

function contextOf(frames: Frame[], last: Token | null, word: Span): CursorContext {
    // In a bracket, the statement or property around it decides what else is
    // in scope; the bracket itself only ever holds an expression.
    let depth = frames.length - 1;
    while (frames[depth].kind === 'bracket') depth--;
    const holder = frames[depth];
    const inBracket = depth !== frames.length - 1;
    const member = last !== null && isPunctuation(last, '.') && word.start >= last.span.end;

    if (holder.kind === 'properties') {
        if (inBracket) return expressionContext(null, member);
        return propertyContext(holder.state);
    }

    const statement = (holder as Extract<Frame, { kind: 'statements' }>).statement;
    if (statement.metadata && !inBracket) return propertyContext(statement.metadata);
    if (statement.metadata) return expressionContext(null, member);
    if (statement.finished) return { kind: 'none' };
    if (statement.tokens.length === 0) {
        return { kind: 'statement', owner: (holder as { owner: StatementOwner }).owner };
    }

    const first = statement.tokens[0];
    if (first.kind === 'keyword') {
        switch (first.text) {
            case 'ticker':
                return { ...expressionContext(statement, member), ticker: true };
            case 'macro':
                return statement.tokens.some(token => isPunctuation(token, '='))
                    ? expressionContext(statement, member)
                    : { kind: 'none' };
            default:
                return { kind: 'none' };
        }
    }
    if (first.kind === 'string' && statement.tokens.length === 1 && !inBracket) {
        return { kind: 'none' };
    }
    return expressionContext(statement, member);
}

function propertyContext(state: PropertyState): CursorContext {
    switch (state.stage) {
        case 'key':
        case 'afterComma':
            return { kind: 'propertyKey', placement: state.placement, written: state.written };
        case 'value':
            return { kind: 'propertyValue', placement: state.placement, key: state.key };
        default:
            return { kind: 'none' };
    }
}

function expressionContext(
    statement: StatementState | null,
    member: boolean,
): Extract<CursorContext, { kind: 'expression' }> {
    return {
        kind: 'expression',
        ticker: false,
        parameters: statement ? parametersOf(statement.all) : [],
        member,
    };
}
