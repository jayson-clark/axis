import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    CompletionRequest,
    DefinitionRequest,
    DocumentFormattingRequest,
    DocumentHighlightRequest,
    DocumentLinkRequest,
    DocumentRangeFormattingRequest,
    DocumentSymbolRequest,
    FileChangeType,
    FoldingRangeRequest,
    HoverRequest,
    InsertTextFormat,
    ReferencesRequest,
    SemanticTokensRangeRequest,
    SemanticTokensRequest,
    type CompletionItem,
    type CompletionList,
    type Diagnostic,
    type MarkupContent,
} from 'vscode-languageserver';
import { SEMANTIC_TOKEN_LEGEND } from '@axis-dsl/language-service';
import { positionOf, startClient, tempWorkspace, type Client } from './support.mts';

const items = (result: CompletionItem[] | CompletionList | null) =>
    Array.isArray(result) ? result : (result?.items ?? []);

const codes = (diagnostics: Diagnostic[]) => diagnostics.map(diagnostic => diagnostic.code);

describe('the language server', () => {
    const workspace = tempWorkspace({
        'main.axis': 'import "./lib/waves"\ny = wave(x)\n',
        'lib/waves.axis': 'wave(x) = sin(x)\n',
        'lib/notes.txt': 'not a script',
        'lib/more/ripples.axis': '',
        'pictures/beach.png': '',
    });
    let client: Client;

    before(async () => {
        client = await startClient({
            root: workspace.root,
            initializationOptions: { retriggerCommand: 'editor.action.triggerSuggest' },
        });
    });
    after(async () => {
        await client.close();
        workspace.dispose();
    });

    test('says what it can do', () => {
        const { capabilities, serverInfo } = client.initialize;
        assert.equal(serverInfo?.name, 'axis-language-server');
        assert.deepEqual(capabilities.semanticTokensProvider?.legend, SEMANTIC_TOKEN_LEGEND);
        assert.equal(capabilities.semanticTokensProvider?.range, true);
        assert.equal(capabilities.semanticTokensProvider?.full, true);
        for (const provider of [
            'hoverProvider',
            'documentFormattingProvider',
            'documentRangeFormattingProvider',
            'definitionProvider',
            'referencesProvider',
            'documentHighlightProvider',
            'documentSymbolProvider',
            'foldingRangeProvider',
        ] as const) {
            assert.equal(capabilities[provider], true, provider);
        }
        assert.ok(capabilities.completionProvider?.triggerCharacters?.includes('@'));
        assert.ok(capabilities.documentLinkProvider);
    });

    test('asks the client to watch scripts and pictures', async () => {
        await client.registered;
        assert.equal(client.watchers.length, 1);
        assert.match(client.watchers[0], /axis/);
        assert.match(client.watchers[0], /png/);
    });

    test('publishes the compiler’s diagnostics when a document opens', async () => {
        const uri = workspace.uri('builtin.axis');
        const published = client.diagnostics(uri);
        await client.open(uri, 'mean = 3\n');
        const diagnostics = await published;
        assert.deepEqual(codes(diagnostics), ['assign-to-builtin']);
        assert.equal(diagnostics[0].source, 'axis');
        assert.deepEqual(diagnostics[0].range.start, { line: 0, character: 0 });
    });

    test('checks a document again as it is edited', async () => {
        const uri = workspace.uri('edited.axis');
        const opened = client.diagnostics(uri);
        await client.open(uri, 'y = x\n');
        assert.deepEqual(await opened, []);

        const edited = client.diagnostics(uri);
        await client.change(uri, 2, 'mean = 3\n');
        assert.deepEqual(codes(await edited), ['assign-to-builtin']);
    });

    test('reports an import or an image whose file is not there', async () => {
        const uri = workspace.uri('missing.axis');
        const published = client.diagnostics(uri);
        await client.open(
            uri,
            'import "./nowhere"\nimage "./pictures/beach.png"\nimage "./pictures/gone.png"\n',
        );
        const diagnostics = await published;
        assert.deepEqual(codes(diagnostics), ['import-not-found', 'image-not-found']);
        assert.equal(diagnostics[0].message, 'Cannot find "./nowhere".');
        // On the path, inside its quotes.
        assert.deepEqual(diagnostics[0].range, {
            start: { line: 0, character: 8 },
            end: { line: 0, character: 17 },
        });
        assert.equal(diagnostics[1].range.start.line, 2);
    });

    test('resolves imports from disk, so what they define is known', async () => {
        const uri = workspace.uri('main.axis');
        const published = client.diagnostics(uri);
        await client.open(uri, 'import "./lib/waves"\ny = wave(x)\n');
        assert.deepEqual(await published, []);
    });

    test('resolves a leading `/` against the workspace folder', async () => {
        const uri = workspace.uri('lib/deep.axis');
        const published = client.diagnostics(uri);
        await client.open(uri, 'import "/lib/waves"\nimage "/pictures/beach.png"\ny = wave(x)\n');
        assert.deepEqual(await published, []);
    });

    test('completes properties in metadata', async () => {
        const uri = workspace.uri('complete.axis');
        const text = 'y = x @ \n';
        await client.open(uri, text);
        const offered = items(
            await client.connection.sendRequest(CompletionRequest.type, {
                textDocument: { uri },
                position: { line: 0, character: 8 },
            }),
        );
        const labels = offered.map(item => item.label);
        assert.ok(labels.includes('color'), labels.join());
        assert.ok(labels.includes('lineWidth'), labels.join());
        assert.ok(!labels.includes('sin'), 'a function is not a property');
    });

    test('completes a path from the file system', async () => {
        const uri = workspace.uri('paths.axis');
        const text = 'import "./lib/"\nimage "./pictures/"\n';
        await client.open(uri, text);

        const imports = items(
            await client.connection.sendRequest(CompletionRequest.type, {
                textDocument: { uri },
                position: positionOf(text, '/"', 1),
            }),
        );
        // The folder first, reopening the list; then only what an import can name.
        assert.deepEqual(
            imports.map(item => item.label),
            ['more/', 'waves.axis'],
        );
        assert.equal(imports[0].command?.command, 'editor.action.triggerSuggest');

        const images = items(
            await client.connection.sendRequest(CompletionRequest.type, {
                textDocument: { uri },
                position: { line: 1, character: 'image "./pictures/'.length },
            }),
        );
        assert.deepEqual(
            images.map(item => item.label),
            ['beach.png'],
        );
        // Replacing the segment being typed, not the word the client finds.
        const edit = images[0].textEdit as { range: { start: { character: number } } };
        assert.equal(edit.range.start.character, 'image "./pictures/'.length);
    });

    test('sends a snippet as a snippet', async () => {
        const uri = workspace.uri('snippet.axis');
        await client.open(uri, '\n');
        const offered = items(
            await client.connection.sendRequest(CompletionRequest.type, {
                textDocument: { uri },
                position: { line: 0, character: 0 },
            }),
        );
        const snippet = offered.find(item => item.insertTextFormat === InsertTextFormat.Snippet);
        assert.ok(snippet, 'some keyword or function is offered as a snippet');
    });

    test('hovers a builtin with its documentation', async () => {
        const uri = workspace.uri('hover.axis');
        const text = 'y = sin(x)\n';
        await client.open(uri, text);
        const hover = await client.connection.sendRequest(HoverRequest.type, {
            textDocument: { uri },
            position: positionOf(text, 'sin', 1),
        });
        assert.ok(hover);
        const contents = hover.contents as MarkupContent;
        assert.equal(contents.kind, 'markdown');
        assert.match(contents.value, /sin/);
        assert.deepEqual(hover.range, {
            start: { line: 0, character: 4 },
            end: { line: 0, character: 7 },
        });
    });

    test('formats a document, and a range of one', async () => {
        const uri = workspace.uri('format.axis');
        await client.open(uri, 'y=x+1\nz=2*x\n');
        const whole = await client.connection.sendRequest(DocumentFormattingRequest.type, {
            textDocument: { uri },
            options: { tabSize: 4, insertSpaces: true },
        });
        assert.equal(whole?.length, 1);
        assert.equal(whole![0].newText, 'y = x + 1\nz = 2 * x\n');

        const range = await client.connection.sendRequest(DocumentRangeFormattingRequest.type, {
            textDocument: { uri },
            range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
            options: { tabSize: 4, insertSpaces: true },
        });
        assert.equal(range?.length, 1);
        assert.equal(range![0].newText, 'z = 2 * x');
        assert.equal(range![0].range.start.line, 1);
    });

    test('gives semantic tokens for the document and for a range of it', async () => {
        const uri = workspace.uri('tokens.axis');
        await client.open(uri, 'f(a) = a^2\ny = f(x)\n');
        const full = await client.connection.sendRequest(SemanticTokensRequest.type, {
            textDocument: { uri },
        });
        assert.ok(full && full.data.length > 0 && full.data.length % 5 === 0);
        const { tokenTypes } = SEMANTIC_TOKEN_LEGEND;
        // The first token is `f`, declared as a function at 0:0.
        assert.deepEqual(full.data.slice(0, 4), [0, 0, 1, tokenTypes.indexOf('function')]);

        const range = await client.connection.sendRequest(SemanticTokensRangeRequest.type, {
            textDocument: { uri },
            range: { start: { line: 1, character: 0 }, end: { line: 2, character: 0 } },
        });
        assert.ok(range && range.data.length > 0 && range.data.length < full.data.length);
        // Encoded from the start of the document, so the first is on line 1.
        assert.equal(range.data[0], 1);
    });

    test('follows a name into the file that imports it', async () => {
        const uri = workspace.uri('main.axis');
        const locations = await client.connection.sendRequest(DefinitionRequest.type, {
            textDocument: { uri },
            position: { line: 1, character: 5 },
        });
        assert.ok(Array.isArray(locations));
        assert.deepEqual(locations, [
            {
                uri: workspace.uri('lib/waves.axis'),
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
            },
        ]);
    });

    test('links an import and an image to their files', async () => {
        const uri = workspace.uri('main.axis');
        const links = await client.connection.sendRequest(DocumentLinkRequest.type, {
            textDocument: { uri },
        });
        assert.deepEqual(
            links?.map(link => link.target),
            [workspace.uri('lib/waves.axis')],
        );
    });

    test('finds references, highlights, symbols and folds', async () => {
        const uri = workspace.uri('navigate.axis');
        const text = 'amp = 2\nfolder "Curves" {\n    y = amp * x\n}\n';
        await client.open(uri, text);
        const position = positionOf(text, 'amp');

        const references = await client.connection.sendRequest(ReferencesRequest.type, {
            textDocument: { uri },
            position,
            context: { includeDeclaration: true },
        });
        assert.deepEqual(
            references?.map(location => [location.uri, location.range.start.line]),
            [
                [uri, 0],
                [uri, 2],
            ],
        );

        const highlights = await client.connection.sendRequest(DocumentHighlightRequest.type, {
            textDocument: { uri },
            position,
        });
        assert.deepEqual(
            highlights?.map(highlight => highlight.kind),
            [3, 2],
        );

        const symbols = await client.connection.sendRequest(DocumentSymbolRequest.type, {
            textDocument: { uri },
        });
        assert.deepEqual(
            symbols?.map(symbol => symbol.name),
            ['amp', 'Curves'],
        );

        const folds = await client.connection.sendRequest(FoldingRangeRequest.type, {
            textDocument: { uri },
        });
        assert.deepEqual(
            folds?.map(fold => [fold.startLine, fold.endLine]),
            [[1, 2]],
        );
    });

    test('checks a document again when a file it imports changes on disk', async () => {
        const uri = workspace.uri('dependent.axis');
        const opened = client.diagnostics(uri);
        await client.open(uri, 'import "./lib/styles"\ny = x @ use: loud\n');
        assert.deepEqual(codes(await opened), ['import-not-found', 'unknown-style']);

        // Created: the import resolves, and the style with it.
        workspace.write('lib/styles.axis', 'style loud { color: RED }\n');
        const created = client.diagnostics(uri);
        await client.filesChanged([
            { uri: workspace.uri('lib/styles.axis'), type: FileChangeType.Created },
        ]);
        assert.deepEqual(await created, []);

        // Changed: the style is gone again.
        workspace.write('lib/styles.axis', 'style quiet { color: BLUE }\n');
        const changed = client.diagnostics(uri);
        await client.filesChanged([
            { uri: workspace.uri('lib/styles.axis'), type: FileChangeType.Changed },
        ]);
        assert.deepEqual(codes(await changed), ['unknown-style']);
    });

    test('reads an open document in place of its file', async () => {
        const library = workspace.uri('lib/open.axis');
        workspace.write('lib/open.axis', 'style loud { color: RED }\n');
        const uri = workspace.uri('uses-open.axis');
        const opened = client.diagnostics(uri);
        await client.open(uri, 'import "./lib/open"\ny = x @ use: loud\n');
        assert.deepEqual(await opened, []);

        // Edited but not saved: the document importing it hears about it anyway.
        await client.open(library, 'style loud { color: RED }\n');
        const refreshed = client.diagnostics(uri, diagnostics => diagnostics.length > 0);
        await client.change(library, 2, 'style quiet { color: RED }\n');
        assert.deepEqual(codes(await refreshed), ['unknown-style']);
    });
});

describe('the language server without a workspace', () => {
    test('still starts, and checks a document on its own', async () => {
        const client = await startClient();
        try {
            const uri = 'untitled:Untitled-1';
            const published = client.diagnostics(uri);
            await client.open(uri, 'mean = 3\n');
            assert.deepEqual(codes(await published), ['assign-to-builtin']);
        } finally {
            await client.close();
        }
    });
});
