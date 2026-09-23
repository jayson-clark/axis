// Runs inside the extension host `run.mjs` starts: the extension activates on
// an Axis file, its language server answers, and its commands are there.
// CommonJS, because the extension host loads a test module with `require`.

const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const vscode = require('vscode');

/** Poll until `read` returns something truthy, or fail after `timeout` ms. */
async function eventually(read, timeout = 20_000) {
    const until = Date.now() + timeout;
    for (;;) {
        const value = await read();
        if (value) return value;
        if (Date.now() > until) throw new Error('timed out');
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

async function check(name, body) {
    try {
        await body();
        console.log(`  ok  ${name}`);
    } catch (error) {
        console.log(`  not ok  ${name}`);
        throw error;
    }
}

exports.run = async function run() {
    const workspace = process.env.AXIS_TEST_WORKSPACE;
    const path = join(workspace, 'main.axis');
    writeFileSync(path, 'import "./lib"\nmean = 3\ny = x @ use: loud\n');

    const document = await vscode.workspace.openTextDocument(path);
    await vscode.window.showTextDocument(document);

    await check('recognises a .axis file as Axis', () => {
        assert.equal(document.languageId, 'axis');
    });

    await check('publishes the language server’s diagnostics, imports resolved', async () => {
        const diagnostics = await eventually(() => {
            const found = vscode.languages.getDiagnostics(document.uri);
            return found.length > 0 && found;
        });
        assert.deepEqual(
            diagnostics.map(diagnostic => diagnostic.code),
            ['assign-to-builtin'],
        );
    });

    await check('completes properties in metadata', async () => {
        const list = await vscode.commands.executeCommand(
            'vscode.executeCompletionItemProvider',
            document.uri,
            new vscode.Position(2, 8),
        );
        const labels = list.items.map(item =>
            typeof item.label === 'string' ? item.label : item.label.label,
        );
        assert.ok(labels.includes('color'), labels.join());
    });

    await check('goes to a definition in an imported file', async () => {
        const locations = await vscode.commands.executeCommand(
            'vscode.executeDefinitionProvider',
            document.uri,
            new vscode.Position(2, 15),
        );
        const [location] = locations;
        const uri = 'targetUri' in location ? location.targetUri : location.uri;
        assert.equal(uri.fsPath, join(workspace, 'lib.axis'));
    });

    await check('formats a document', async () => {
        const untidy = await vscode.workspace.openTextDocument({
            language: 'axis',
            content: 'y=x+1\n',
        });
        const edits = await eventually(() =>
            vscode.commands.executeCommand('vscode.executeFormatDocumentProvider', untidy.uri, {
                tabSize: 4,
                insertSpaces: true,
            }),
        );
        // VSCode may hand the edit back split into the smallest changes, so
        // it is the text they make that is compared.
        const edit = new vscode.WorkspaceEdit();
        edit.set(untidy.uri, edits);
        assert.ok(await vscode.workspace.applyEdit(edit));
        assert.equal(untidy.getText(), 'y = x + 1\n');
    });

    await check('hovers a builtin', async () => {
        const [hover] = await vscode.commands.executeCommand(
            'vscode.executeHoverProvider',
            document.uri,
            new vscode.Position(1, 1),
        );
        assert.match(hover.contents.map(part => part.value ?? part).join(), /mean/);
    });

    await check('colours the document with semantic tokens', async () => {
        const tokens = await vscode.commands.executeCommand(
            'vscode.provideDocumentSemanticTokens',
            document.uri,
        );
        assert.ok(tokens.data.length > 0 && tokens.data.length % 5 === 0);
    });

    await check('registers the preview commands', async () => {
        const commands = await vscode.commands.getCommands(true);
        for (const command of ['axis.preview', 'axis.previewStatus', 'axis.stopPreviewServer']) {
            assert.ok(commands.includes(command), command);
        }
    });
};
