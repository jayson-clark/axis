import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    AXIS_CONSTANT_NAMES,
    AXIS_FUNCTION_NAMES,
    AXIS_OPERATOR_NAMES,
    KEYWORDS,
} from '@axis-dsl/syntax';
import { AXIS_PALETTE_NAMES, createAxisMonarchLanguage } from '../dist/monaco/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// The TextMate grammar
// ─────────────────────────────────────────────────────────────────────────────
//
// VSCode reads it through Oniguruma, which this suite does not load, so what is
// checked here is what can be checked with JavaScript's own regexes: that the
// file is sound, that its word lists are the manifest's, and that the patterns
// carrying the v2 syntax pick out what they should. The grammar is kept to
// regexes JavaScript and Oniguruma read alike, which is what makes that work.

interface Pattern {
    name?: string;
    match?: string;
    begin?: string;
    end?: string;
    include?: string;
    patterns?: Pattern[];
    captures?: Record<string, Pattern>;
    beginCaptures?: Record<string, Pattern>;
    endCaptures?: Record<string, Pattern>;
}

interface Grammar {
    scopeName: string;
    patterns: Pattern[];
    repository: Record<string, Pattern>;
}

const grammar: Grammar = JSON.parse(
    readFileSync(new URL('../syntaxes/axis.tmLanguage.json', import.meta.url), 'utf8'),
);

/** Every pattern in the grammar, however deeply nested. */
function* walk(patterns: Pattern[]): Generator<Pattern> {
    for (const pattern of patterns) {
        yield pattern;
        yield* walk(pattern.patterns ?? []);
        for (const captures of [pattern.captures, pattern.beginCaptures, pattern.endCaptures]) {
            yield* walk(Object.values(captures ?? {}));
        }
    }
}

const allPatterns = [...walk([...grammar.patterns, ...Object.values(grammar.repository)])];

/** Every scope name the grammar assigns, split where one pattern gives two. */
const scopes = new Set(allPatterns.flatMap(p => p.name?.split(' ') ?? []));

/** The one pattern assigning `scope`, by its match. */
function patternFor(scope: string): RegExp {
    const found = allPatterns.find(p => p.name === scope && p.match);
    assert.ok(found, `no match pattern is named ${scope}`);
    return new RegExp(found.match!, 'g');
}

/** The words a `\b(?:a|b|c)\b` pattern lists. */
const wordsOf = (pattern: Pattern): string[] =>
    /\(\?:([^)]*)\)/.exec(pattern.match ?? '')?.[1]?.split('|') ?? [];

describe('the TextMate grammar', () => {
    test('is the Axis grammar', () => {
        assert.equal(grammar.scopeName, 'source.axis');
    });

    test('includes only what its repository defines', () => {
        for (const pattern of allPatterns) {
            if (pattern.include?.startsWith('#')) {
                assert.ok(pattern.include.slice(1) in grammar.repository, pattern.include);
            }
        }
    });

    test('has only patterns a JavaScript regex can read', () => {
        for (const pattern of allPatterns) {
            for (const source of [pattern.match, pattern.begin, pattern.end]) {
                if (source !== undefined) {
                    assert.doesNotThrow(() => new RegExp(source), source);
                }
            }
        }
    });

    test('names a scope for every part of the v2 syntax', () => {
        for (const scope of [
            'comment.line.double-slash.axis',
            'string.quoted.double.axis',
            'constant.character.escape.axis',
            'constant.other.color.rgb-value.axis',
            'constant.numeric.axis',
            'keyword.other.metadata.axis',
            'variable.other.property.axis',
            'keyword.operator.range.axis',
            'keyword.operator.range.list.axis',
            'keyword.other.step.axis',
            'keyword.other.soft.axis',
            'keyword.operator.arrow.axis',
            'support.constant.color.axis',
            'keyword.control.folder.axis',
            'keyword.control.table.axis',
            'keyword.control.config.axis',
            'keyword.control.style.axis',
            'keyword.control.macro.axis',
            'entity.name.type.style.axis',
            'entity.name.function.macro.axis',
            'entity.name.section.folder.axis',
            'punctuation.terminator.statement.axis',
        ]) {
            assert.ok(scopes.has(scope), scope);
        }
    });

    test('knows every keyword, and min and max only after soft', () => {
        // Named for a keyword itself, or opening with one it names by capture.
        const keywords = allPatterns.filter(
            p =>
                p.match &&
                (p.name?.startsWith('keyword') || p.captures?.['1']?.name?.startsWith('keyword')),
        );
        for (const word of KEYWORDS) {
            assert.ok(
                keywords.some(p => new RegExp(`^(?:${p.match})$`).test(word)),
                `${word} is not a keyword`,
            );
        }

        const soft = allPatterns.find(p => p.captures?.['1']?.name === 'keyword.other.soft.axis');
        assert.deepEqual(new RegExp(soft!.match!).exec('soft max')?.slice(1), ['soft', 'max']);
        assert.ok(!keywords.some(p => new RegExp(`^(?:${p.match})$`).test('min')));
    });

    test('lists exactly the manifest functions and constants', () => {
        const functions = allPatterns
            .filter(p => p.name?.startsWith('support.function.'))
            .flatMap(wordsOf);
        assert.deepEqual(functions.sort(), [...AXIS_FUNCTION_NAMES].sort());

        const constants = allPatterns
            .filter(p => p.name?.startsWith('constant.language.'))
            .flatMap(wordsOf);
        assert.deepEqual(constants.sort(), [...AXIS_CONSTANT_NAMES].sort());
    });

    test('lists the palette names', () => {
        const palette = allPatterns.find(p => p.name === 'support.constant.color.axis')!;
        assert.deepEqual(wordsOf(palette), [...AXIS_PALETTE_NAMES]);
    });

    test('reads a colour literal of three or six digits and nothing else', () => {
        const color = patternFor('constant.other.color.rgb-value.axis');
        assert.deepEqual('#c74440 #fff #abcd'.match(color), ['#c74440', '#fff']);
    });

    test('keeps a range apart from the numbers around it', () => {
        const numbers = patternFor('constant.numeric.axis');
        assert.deepEqual('-5..5 step 0.5'.match(numbers), ['5', '5', '0.5']);
        assert.deepEqual('[1...10] .5 1e-3'.match(numbers), ['1', '10', '.5', '1e-3']);
        assert.deepEqual('0..2pi'.match(patternFor('keyword.operator.range.axis')), ['..']);
    });

    test('takes a comma as a new property only where the comma rule says', () => {
        const inline = grammar.repository.metadataInline!.patterns![0]!;
        const key = new RegExp(inline.patterns![0]!.match!, 'g');
        const keys = (source: string) => [...source.matchAll(key)].map(m => m[1]);

        assert.deepEqual(keys('@ onClick: a -> 1, b -> 2, color: RED'), ['onClick', 'color']);
        assert.deepEqual(keys('@ slider: 0..2pi soft max, playing'), ['slider', 'playing']);
        assert.deepEqual(keys('@ hidden, fill'), ['hidden', 'fill']);
        assert.deepEqual(keys('@ color: rgb(1, 2, 3), lines'), ['color', 'lines']);
    });

    test('ends inline metadata at the end of its statement', () => {
        const end = new RegExp(grammar.repository.metadataInline!.patterns![0]!.end!);
        assert.equal('lines; y = 2'.search(end), 5);
        assert.equal('lines }'.search(end), 6);
    });

    test('reads the block headers', () => {
        const folder = new RegExp(grammar.repository.folder!.patterns![0]!.match!);
        assert.deepEqual(folder.exec('folder "Waves" { @ collapsed')?.slice(1), [
            'folder',
            '"Waves"',
            '{',
        ]);
        assert.deepEqual(folder.exec('folder {')?.slice(1), ['folder', undefined, '{']);

        const style = new RegExp(grammar.repository.style!.patterns![0]!.begin!);
        assert.deepEqual(style.exec('style loud { use: swatch }')?.slice(1), [
            'style',
            'loud',
            '{',
        ]);

        const macro = new RegExp(grammar.repository.macro!.patterns![0]!.match!);
        assert.deepEqual(macro.exec('macro wave(k, phase) = sin(k * x)')?.slice(1), [
            'macro',
            'wave',
            '(',
            'k, phase',
            ')',
        ]);
        assert.deepEqual(macro.exec('macro TAU2 = 2tau')?.slice(1, 3), ['macro', 'TAU2']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The Monarch grammar
// ─────────────────────────────────────────────────────────────────────────────
//
// Run through Monaco's own Monarch tokenizer. It is internal to monaco-editor
// and has no types, so it is imported by a specifier TypeScript does not
// follow, and handed stubs for the services it only needs for embedded
// languages and settings.

interface MonarchToken {
    offset: number;
    type: string;
}

interface MonarchTokenizer {
    getInitialState(): unknown;
    tokenize(
        line: string,
        hasEOL: boolean,
        state: unknown,
    ): { tokens: MonarchToken[]; endState: unknown };
}

const MONARCH = 'monaco-editor/editor/standalone/common/monarch/';

async function createTokenizer(): Promise<MonarchTokenizer> {
    const { compile } = await import(`${MONARCH}monarchCompile`);
    const { MonarchTokenizer } = await import(`${MONARCH}monarchLexer`);
    const configuration = {
        getValue: () => 20_000,
        onDidChangeConfiguration: () => ({ dispose() {} }),
    };
    return new MonarchTokenizer(
        {},
        {},
        'axis',
        compile('axis', createAxisMonarchLanguage()),
        configuration,
    );
}

/** `[text, token type]` for every non-blank token of every line. */
async function tokenize(source: string): Promise<[string, string][][]> {
    const tokenizer = await createTokenizer();
    let state = tokenizer.getInitialState();
    return source.split('\n').map(line => {
        const { tokens, endState } = tokenizer.tokenize(line, true, state);
        state = endState;
        return tokens
            .map((token, i): [string, string] => [
                line.slice(token.offset, tokens[i + 1]?.offset ?? line.length),
                token.type.replace(/\.axis$/, ''),
            ])
            .filter(([text]) => text.trim() !== '');
    });
}

/** The type of the first token spelled `text` on a tokenized line. */
const typeOf = (line: [string, string][], text: string): string | undefined =>
    line.find(([t]) => t === text)?.[1];

describe('the Monarch grammar', () => {
    test('draws its word lists from the manifest', () => {
        const language = createAxisMonarchLanguage() as unknown as Record<string, string[]>;
        assert.deepEqual(language.keywords, [...KEYWORDS]);
        assert.deepEqual(language.functions, [...AXIS_FUNCTION_NAMES]);
        assert.deepEqual(language.palette, [...AXIS_PALETTE_NAMES]);
        for (const name of [...AXIS_CONSTANT_NAMES, ...AXIS_OPERATOR_NAMES, 'dt']) {
            assert.ok(language.constants!.includes(name), name);
        }
    });

    test('colours inline metadata by the comma rule, and ends it with the line', async () => {
        const [first, second] = await tokenize(
            '(1, 2) @ onClick: a -> 1, b -> 2, color: RED\nb = 1',
        );
        assert.equal(typeOf(first!, '@'), 'keyword.metadata');
        assert.equal(typeOf(first!, 'onClick'), 'variable.parameter');
        assert.equal(typeOf(first!, 'b'), 'identifier');
        assert.equal(typeOf(first!, 'color'), 'variable.parameter');
        assert.equal(typeOf(first!, 'RED'), 'constant.color');
        assert.equal(typeOf(second!, 'b'), 'identifier');
    });

    test('ends inline metadata at a ; and at the brace closing its block', async () => {
        const [line] = await tokenize('folder { y = 1 @ hidden; lines = 2 @ lines }');
        assert.equal(typeOf(line!, 'folder'), 'keyword');
        assert.equal(typeOf(line!, 'hidden'), 'variable.parameter');
        assert.deepEqual(
            line!.filter(([text]) => text === 'lines').map(([, type]) => type),
            ['identifier', 'variable.parameter'],
        );
    });

    test('colours a range', async () => {
        const [line] = await tokenize('t = 0 @ slider: 0..2pi step 0.02 soft max, playing');
        assert.equal(typeOf(line!, '..'), 'operator.range');
        assert.equal(typeOf(line!, 'step'), 'keyword');
        assert.equal(typeOf(line!, 'soft'), 'keyword');
        assert.equal(typeOf(line!, 'max'), 'keyword');
        assert.equal(typeOf(line!, 'playing'), 'variable.parameter');
        assert.equal(typeOf((await tokenize('m = max(L)'))[0]!, 'max'), 'predefined');
    });

    test('colours the keys of config, style and @{ } blocks', async () => {
        const lines = await tokenize(
            [
                'config { showGrid: true; xmin: -7 }',
                'style loud { use: swatch; showLabel }',
                'y = x @{',
                '    color: rgb(1, 2, 3)',
                '    hidden',
                '}',
                'hidden = 1',
            ].join('\n'),
        );
        assert.equal(typeOf(lines[0]!, 'showGrid'), 'variable.parameter');
        assert.equal(typeOf(lines[0]!, 'xmin'), 'variable.parameter');
        assert.equal(typeOf(lines[1]!, 'loud'), 'type');
        assert.equal(typeOf(lines[1]!, 'use'), 'variable.parameter');
        assert.equal(typeOf(lines[1]!, 'swatch'), 'identifier');
        assert.equal(typeOf(lines[1]!, 'showLabel'), 'variable.parameter');
        assert.equal(typeOf(lines[2]!, '@{'), 'keyword.metadata');
        assert.equal(typeOf(lines[3]!, 'color'), 'variable.parameter');
        assert.equal(typeOf(lines[3]!, 'rgb'), 'predefined');
        assert.equal(typeOf(lines[4]!, 'hidden'), 'variable.parameter');
        assert.equal(typeOf(lines[6]!, 'hidden'), 'identifier');
    });

    test('colours literals, macros and the rest of an expression', async () => {
        const [macro, colors] = await tokenize(
            'macro wave(k, phase) = sin(k * x + phase)\nc = #c74440 // #nope',
        );
        assert.equal(typeOf(macro!, 'macro'), 'keyword');
        assert.equal(typeOf(macro!, 'wave'), 'function');
        assert.equal(typeOf(macro!, 'sin'), 'predefined');
        assert.equal(typeOf(colors!, '#c74440'), 'string.color');
        assert.equal(typeOf(colors!, '// #nope'), 'comment');
    });
});
