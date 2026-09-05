// ═════════════════════════════════════════════════════════════════════════════
// The `ticker` statement
// ═════════════════════════════════════════════════════════════════════════════
//
//     ticker a -> a + 1 # minStep: 50, playing: true
//
// A graph has one ticker, and it is not an expression: Desmos keeps it beside
// the expression list rather than in it. So the statement is read here rather
// than by the expression path - the compiler, the diagnostics and the formatter
// each need to know where the keyword ends and the action begins, and they
// should all draw the line in the same place.

/** `ticker`, opening a statement rather than naming a variable. */
export const TICKER_KEYWORD = /^ticker\b(?!\s*=)/;

/** The action a `ticker` statement runs, as written. */
export interface TickerStatement {
    /** The handler, with the keyword taken off. Empty for a bare `ticker`. */
    handler: string;
}

/**
 * Read `ticker <action>`, or undefined when the line is not one.
 *
 * `ticker = 3` is a variable somebody named, not a statement, and neither is
 * `tickerRate`; both are left to compile as the expressions they are.
 */
export function parseTickerStatement(code: string): TickerStatement | undefined {
    if (!TICKER_KEYWORD.test(code)) {
        return undefined;
    }

    return { handler: code.slice('ticker'.length).trim() };
}
