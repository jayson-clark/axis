// ═════════════════════════════════════════════════════════════════════════════
// Registering Axis on a Monaco instance
// ═════════════════════════════════════════════════════════════════════════════

import type * as monaco from 'monaco-editor/editor';
import {
    AXIS_FILE_EXTENSION,
    AXIS_LANGUAGE_CONFIGURATION,
    AXIS_LANGUAGE_ID,
    AXIS_WORD_PATTERN,
} from '../language';
import { registerAxisDiagnostics } from './diagnostics';
import { createAxisMonarchLanguage } from './monarch';
import {
    registerAxisCompletions,
    registerAxisFormatting,
    registerAxisHover,
    registerAxisNavigation,
    registerAxisSemanticTokens,
} from './providers';
import { defineAxisThemes, type MonacoApi } from './themes';
import type { AxisProgramOptions } from './providers';
import type { SemanticChecker } from '../diagnostics';

/**
 * Everything is optional. With nothing, the markers are what `compileAxis`
 * reports for each model on its own - an import is unresolved, as in a compile
 * given no resolver. With `resolveImport` (and `pathOf`, if the resolver names
 * files), imports resolve and what they define is completed, hovered and
 * followed like the model's own names.
 */
export interface RegisterAxisOptions extends AxisProgramOptions {
    /** A checker to use instead of the compiler's, or `false` for syntax errors alone. */
    semantic?: SemanticChecker | false;
    /**
     * Switch semantic highlighting on in every editor the instance creates.
     * Monaco's standalone themes leave it off, and without it the semantic
     * tokens - a parameter told from a global, a palette colour from a
     * variable - are computed and never drawn. True by default.
     */
    semanticHighlighting?: boolean;
}

function toMonacoLanguageConfiguration(): monaco.languages.LanguageConfiguration {
    const config = AXIS_LANGUAGE_CONFIGURATION;
    return {
        comments: config.comments,
        brackets: config.brackets,
        autoClosingPairs: config.autoClosingPairs,
        surroundingPairs: config.surroundingPairs,
        wordPattern: new RegExp(AXIS_WORD_PATTERN.source, 'g'),
    };
}

/** Instances already registered, so a second call hands back the first result. */
const registered = new WeakMap<MonacoApi, monaco.IDisposable>();

/**
 * Teach a Monaco instance about Axis: syntax and semantic highlighting,
 * bracket and comment behaviour, completions, hover, formatting, diagnostics,
 * go to definition, references, highlights, the outline, folding, and the
 * `axis-dark` and `axis-light` themes.
 *
 * Idempotent per instance - a repeat call returns the first registration's
 * disposable rather than adding a second set of providers, so an app that
 * creates several editors can call it freely.
 *
 * @returns a disposable that unregisters every provider it added. Disposing it
 * releases the guard, so a later call registers afresh.
 */
export function registerAxisLanguage(
    api: MonacoApi,
    options: RegisterAxisOptions = {},
): monaco.IDisposable {
    const existing = registered.get(api);
    if (existing) return existing;

    // Registering the id twice would list the language twice; an app that
    // registered it itself keeps its registration.
    if (!api.languages.getLanguages().some(language => language.id === AXIS_LANGUAGE_ID)) {
        api.languages.register({
            id: AXIS_LANGUAGE_ID,
            extensions: [AXIS_FILE_EXTENSION],
            aliases: ['Axis', 'axis'],
        });
    }

    const disposables: monaco.IDisposable[] = [
        api.languages.setMonarchTokensProvider(AXIS_LANGUAGE_ID, createAxisMonarchLanguage()),
        api.languages.setLanguageConfiguration(AXIS_LANGUAGE_ID, toMonacoLanguageConfiguration()),
        registerAxisCompletions(api, options),
        registerAxisHover(api, options),
        registerAxisFormatting(api),
        registerAxisSemanticTokens(api, options),
        registerAxisNavigation(api, options),
        registerAxisDiagnostics(api, options),
    ];

    if (options.semanticHighlighting !== false) {
        // The setting is global to the instance, and only reachable through an
        // editor's options. `onDidCreateEditor` fires from inside the editor's
        // constructor, before a standalone editor can take global options, so
        // it is set a moment later.
        const enable = (editor: monaco.editor.ICodeEditor) =>
            queueMicrotask(() => {
                try {
                    (editor as monaco.editor.IStandaloneCodeEditor).updateOptions({
                        'semanticHighlighting.enabled': true,
                    });
                } catch {
                    // Disposed in the meantime: nothing to switch on.
                }
            });
        api.editor.getEditors().forEach(enable);
        disposables.push(api.editor.onDidCreateEditor(enable));
    }

    defineAxisThemes(api);

    const disposable: monaco.IDisposable = {
        dispose() {
            registered.delete(api);
            disposables.forEach(d => d.dispose());
        },
    };
    registered.set(api, disposable);
    return disposable;
}
