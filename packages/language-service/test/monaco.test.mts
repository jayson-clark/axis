import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    AXIS_DARK_THEME,
    AXIS_FILE_EXTENSION,
    AXIS_LANGUAGE_ID,
    AXIS_LIGHT_THEME,
    registerAxisLanguage,
} from '../dist/monaco/index.js';
import type { MonacoApi } from '../dist/monaco/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// A stand-in for Monaco
// ─────────────────────────────────────────────────────────────────────────────
//
// The adapter imports nothing of Monaco's but its types, and is handed the
// namespace to register on - so a namespace that records what it was given is
// enough to drive every provider as Monaco would, without a browser. The
// playground's own check (`examples/web`) is what runs the real thing.

type Listener<T> = (value: T) => void;

function emitter<T>() {
    const listeners = new Set<Listener<T>>();
    return {
        event: (listener: Listener<T>) => {
            listeners.add(listener);
            return { dispose: () => listeners.delete(listener) };
        },
        fire: (value: T) => listeners.forEach(listener => listener(value)),
        get size() {
            return listeners.size;
        },
    };
}

/** An enum Monaco would give: every member its own name, so assertions read. */
const names = new Proxy({}, { get: (_, key) => key }) as Record<string, string>;

function fakeModel(value: string, uri = 'inmemory://model/1') {
    const changes = emitter<void>();
    return {
        uri: { toString: () => uri, path: uri },
        value,
        version: 1,
        getValue() {
            return this.value;
        },
        getVersionId() {
            return this.version;
        },
        getLanguageId: () => AXIS_LANGUAGE_ID,
        isDisposed: () => false,
        getWordUntilPosition: (position: { column: number }) => ({
            startColumn: position.column,
            endColumn: position.column,
            word: '',
        }),
        onDidChangeContent: changes.event,
        onDidChangeLanguage: emitter<void>().event,
        edit(text: string) {
            this.value = text;
            this.version++;
            changes.fire();
        },
    };
}

function fakeMonaco() {
    const providers = new Map<string, unknown[]>();
    const languages: { id: string }[] = [];
    const markers = new Map<string, unknown[]>();
    const themes = new Map<string, unknown>();
    const created = emitter<unknown>();
    const models: ReturnType<typeof fakeModel>[] = [];
    const editorOptions: unknown[] = [];

    const register = (kind: string) => (language: string, provider: unknown) => {
        assert.equal(language, AXIS_LANGUAGE_ID);
        providers.set(kind, [...(providers.get(kind) ?? []), provider]);
        return {
            dispose: () =>
                providers.set(
                    kind,
                    providers.get(kind)!.filter(other => other !== provider),
                ),
        };
    };

    const api = {
        languages: {
            register: (language: { id: string }) => languages.push(language),
            getLanguages: () => languages,
            setMonarchTokensProvider: register('monarch'),
            setLanguageConfiguration: register('configuration'),
            registerCompletionItemProvider: register('completion'),
            registerHoverProvider: register('hover'),
            registerDocumentFormattingEditProvider: register('formatting'),
            registerDocumentRangeFormattingEditProvider: register('rangeFormatting'),
            registerDocumentSemanticTokensProvider: register('semanticTokens'),
            registerDefinitionProvider: register('definition'),
            registerReferenceProvider: register('references'),
            registerDocumentHighlightProvider: register('highlights'),
            registerDocumentSymbolProvider: register('symbols'),
            registerFoldingRangeProvider: register('folding'),
            CompletionItemKind: names,
            CompletionItemInsertTextRule: names,
            DocumentHighlightKind: names,
            SymbolKind: names,
            FoldingRangeKind: { Comment: 'Comment' },
        },
        editor: {
            defineTheme: (name: string, theme: unknown) => themes.set(name, theme),
            getModels: () => models,
            onDidCreateModel: emitter<unknown>().event,
            onWillDisposeModel: emitter<unknown>().event,
            setModelMarkers: (
                model: { uri: { toString(): string } },
                owner: string,
                list: unknown[],
            ) => {
                assert.equal(owner, 'axis');
                markers.set(model.uri.toString(), list);
            },
            getEditors: () => [],
            onDidCreateEditor: created.event,
        },
        MarkerSeverity: { Error: 8, Warning: 4, Info: 2 },
        Uri: { parse: (uri: string) => ({ toString: () => uri }) },
    };

    return {
        api: api as unknown as MonacoApi,
        providers,
        languages,
        markers,
        themes,
        models,
        editorOptions,
        createEditor() {
            created.fire({ updateOptions: (options: unknown) => editorOptions.push(options) });
        },
        /** The one provider of a kind. */
        provider<T>(kind: string): T {
            const list = providers.get(kind) ?? [];
            assert.equal(list.length, 1, `one ${kind} provider`);
            return list[0] as T;
        },
    };
}

const at = (lineNumber: number, column: number) => ({ lineNumber, column });

// ─────────────────────────────────────────────────────────────────────────────

describe('registerAxisLanguage', () => {
    test('registers the language, its grammar, its themes and every provider', () => {
        const monaco = fakeMonaco();
        registerAxisLanguage(monaco.api);

        assert.deepEqual(
            monaco.languages.map(language => language.id),
            [AXIS_LANGUAGE_ID],
        );
        assert.deepEqual((monaco.languages[0] as { extensions?: string[] }).extensions, [
            AXIS_FILE_EXTENSION,
        ]);
        assert.ok(monaco.themes.has(AXIS_DARK_THEME));
        assert.ok(monaco.themes.has(AXIS_LIGHT_THEME));
        for (const kind of [
            'monarch',
            'configuration',
            'completion',
            'hover',
            'formatting',
            'rangeFormatting',
            'semanticTokens',
            'definition',
            'references',
            'highlights',
            'symbols',
            'folding',
        ]) {
            assert.equal(monaco.providers.get(kind)?.length, 1, kind);
        }
    });

    test('is idempotent per instance, and registers afresh once disposed', () => {
        const monaco = fakeMonaco();
        const first = registerAxisLanguage(monaco.api);
        assert.equal(registerAxisLanguage(monaco.api), first);
        assert.equal(monaco.providers.get('completion')!.length, 1);

        first.dispose();
        assert.equal(monaco.providers.get('completion')!.length, 0);
        const second = registerAxisLanguage(monaco.api);
        assert.notEqual(second, first);
        assert.equal(monaco.providers.get('completion')!.length, 1);
        // The language itself is registered once, however often the providers are.
        assert.equal(monaco.languages.length, 1);
    });

    test('keeps separate registrations for separate instances', () => {
        const one = fakeMonaco();
        const other = fakeMonaco();
        assert.notEqual(registerAxisLanguage(one.api), registerAxisLanguage(other.api));
    });

    test('switches semantic highlighting on in the editors it sees created', async () => {
        const monaco = fakeMonaco();
        registerAxisLanguage(monaco.api);
        monaco.createEditor();
        await Promise.resolve();
        assert.deepEqual(monaco.editorOptions, [{ 'semanticHighlighting.enabled': true }]);
    });

    test('leaves semantic highlighting alone when asked to', async () => {
        const monaco = fakeMonaco();
        registerAxisLanguage(monaco.api, { semanticHighlighting: false });
        monaco.createEditor();
        await Promise.resolve();
        assert.deepEqual(monaco.editorOptions, []);
    });
});

describe('the providers', () => {
    test('complete in Monaco’s one-based positions', () => {
        const monaco = fakeMonaco();
        registerAxisLanguage(monaco.api);
        const model = fakeModel('y = x @ lineStyle: ');
        const { suggestions } = monaco
            .provider<{ provideCompletionItems: Function }>('completion')
            .provideCompletionItems(model, at(1, 20));
        assert.deepEqual(
            suggestions.map((item: { label: string }) => item.label),
            ['DASHED', 'DOTTED', 'SOLID'],
        );
        assert.equal(suggestions[0].kind, 'EnumMember');
        assert.deepEqual(suggestions[0].range, {
            startLineNumber: 1,
            startColumn: 20,
            endLineNumber: 1,
            endColumn: 20,
        });
    });

    test('insert a snippet as a snippet', () => {
        const monaco = fakeMonaco();
        registerAxisLanguage(monaco.api);
        const { suggestions } = monaco
            .provider<{ provideCompletionItems: Function }>('completion')
            .provideCompletionItems(fakeModel('y = x @ '), at(1, 9));
        const lineStyle = suggestions.find((item: { label: string }) => item.label === 'lineStyle');
        assert.equal(lineStyle.insertTextRules, 'InsertAsSnippet');
        assert.match(lineStyle.insertText, /\$\{1\|SOLID/);
        assert.ok(lineStyle.documentation.value.length > 0);
    });

    test('hover with markdown and a range', () => {
        const monaco = fakeMonaco();
        registerAxisLanguage(monaco.api);
        const hover = monaco
            .provider<{ provideHover: Function }>('hover')
            .provideHover(fakeModel('y = sin(x)'), at(1, 6));
        assert.match(hover.contents[0].value, /Sine/);
        assert.deepEqual(hover.range, {
            startLineNumber: 1,
            startColumn: 5,
            endLineNumber: 1,
            endColumn: 8,
        });
    });

    test('mark what the compiler reports, and keep up with edits', async () => {
        const monaco = fakeMonaco();
        const model = fakeModel('mean = 3\ny = x @ color: red');
        monaco.models.push(model);
        registerAxisLanguage(monaco.api);

        const markers = monaco.markers.get(model.uri.toString()) as {
            code: string;
            severity: number;
            startLineNumber: number;
        }[];
        assert.deepEqual(
            markers.map(marker => [marker.code, marker.severity, marker.startLineNumber]),
            [
                ['assign-to-builtin', 8, 1],
                ['invalid-color', 8, 2],
            ],
        );

        model.edit('a = 3');
        await new Promise(resolve => setTimeout(resolve, 300));
        assert.deepEqual(monaco.markers.get(model.uri.toString()), []);
    });

    test('clear their markers when disposed', () => {
        const monaco = fakeMonaco();
        const model = fakeModel('mean = 3');
        monaco.models.push(model);
        registerAxisLanguage(monaco.api).dispose();
        assert.deepEqual(monaco.markers.get(model.uri.toString()), []);
    });

    test('give semantic tokens against the legend', () => {
        const monaco = fakeMonaco();
        registerAxisLanguage(monaco.api);
        const provider = monaco.provider<{
            getLegend(): { tokenTypes: string[] };
            provideDocumentSemanticTokens: Function;
        }>('semanticTokens');
        const { data } = provider.provideDocumentSemanticTokens(fakeModel('y = sin(x)'));
        assert.ok(data instanceof Uint32Array);
        // `sin`, after `y` and `=`: a builtin function.
        assert.equal(provider.getLegend().tokenTypes[data[2 * 5 + 3]], 'function');
    });

    test('go to a definition in the same model', () => {
        const monaco = fakeMonaco();
        registerAxisLanguage(monaco.api);
        const model = fakeModel('a = 1\ny = a');
        const [location] = monaco
            .provider<{ provideDefinition: Function }>('definition')
            .provideDefinition(model, at(2, 5));
        assert.equal(location.uri, model.uri);
        assert.deepEqual(location.range, {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 1,
            endColumn: 2,
        });
    });

    test('format a document and a range', () => {
        const monaco = fakeMonaco();
        registerAxisLanguage(monaco.api);
        const model = fakeModel('a=1\nb=2');
        const options = { tabSize: 4, insertSpaces: true };
        const [whole] = monaco
            .provider<{ provideDocumentFormattingEdits: Function }>('formatting')
            .provideDocumentFormattingEdits(model, options);
        assert.equal(whole.text, 'a = 1\nb = 2');
        const [part] = monaco
            .provider<{ provideDocumentRangeFormattingEdits: Function }>('rangeFormatting')
            .provideDocumentRangeFormattingEdits(
                model,
                { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 2 },
                options,
            );
        assert.equal(part.text, 'b = 2');
        assert.equal(part.range.startLineNumber, 2);
    });

    test('outline and fold a model', () => {
        const monaco = fakeMonaco();
        registerAxisLanguage(monaco.api);
        const model = fakeModel('folder "A" {\n    a = 1\n    b = 2\n}');
        const [folder] = monaco
            .provider<{ provideDocumentSymbols: Function }>('symbols')
            .provideDocumentSymbols(model);
        assert.equal(folder.kind, 'Namespace');
        assert.deepEqual(
            folder.children.map((child: { name: string }) => child.name),
            ['a', 'b'],
        );
        assert.deepEqual(
            monaco
                .provider<{ provideFoldingRanges: Function }>('folding')
                .provideFoldingRanges(model),
            [{ start: 1, end: 3, kind: undefined }],
        );
    });

    test('resolve imports through the host’s resolver', () => {
        const monaco = fakeMonaco();
        const model = fakeModel('import "./lib"\ny = wave(x)', '/main.axis');
        monaco.models.push(model);
        registerAxisLanguage(monaco.api, {
            pathOf: current => current.uri.toString(),
            resolveImport: specifier =>
                specifier === './lib'
                    ? { path: '/lib.axis', source: 'wave(x) = sin(x)' }
                    : undefined,
        });
        assert.deepEqual(monaco.markers.get('/main.axis'), []);
        const [location] = monaco
            .provider<{ provideDefinition: Function }>('definition')
            .provideDefinition(model, at(2, 6));
        assert.equal(location.uri.toString(), '/lib.axis');
    });
});
