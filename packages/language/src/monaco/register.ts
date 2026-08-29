import type * as monaco from 'monaco-editor/editor';
import { AXIS_FILE_EXTENSION, AXIS_LANGUAGE_CONFIGURATION, AXIS_LANGUAGE_ID } from '../index';
import { createAxisMonarchLanguage } from './monarch';
import { registerAxisCompletions } from './completions';
import { registerAxisDiagnostics } from './diagnostics';
import { registerAxisFormatting } from './formatting';
import { defineAxisThemes } from './themes';
import type { MonacoApi } from './types';

export type { MonacoApi };

function toMonacoLanguageConfiguration(): monaco.languages.LanguageConfiguration {
    const config = AXIS_LANGUAGE_CONFIGURATION;
    // The pairs widen to string[] coming out of JSON; Monaco wants tuples.
    const pairs = (list: string[][]) => list as monaco.languages.CharacterPair[];

    return {
        comments: { lineComment: config.comments.lineComment },
        brackets: pairs(config.brackets),
        autoClosingPairs: config.autoClosingPairs,
        surroundingPairs: pairs(config.surroundingPairs).map(([open, close]) => ({ open, close })),
        folding: {
            markers: {
                start: new RegExp(config.folding.markers.start),
                end: new RegExp(config.folding.markers.end),
            },
        },
    };
}

/** Instances already registered, so a second call hands back the first result. */
const registered = new WeakMap<MonacoApi, monaco.IDisposable>();

/**
 * Teach a Monaco instance about Axis: syntax highlighting, bracket/comment
 * behaviour, completions, formatting, syntax diagnostics, and the `axis-dark`
 * and `axis-light` themes.
 *
 * Idempotent per instance — a repeat call returns the first registration's
 * disposable rather than adding a second set of providers, so an app that
 * creates several editors can call it freely.
 *
 * @returns a disposable that unregisters every provider it added. Disposing it
 * releases the guard, so a later call registers afresh.
 */
export function registerAxisLanguage(api: MonacoApi): monaco.IDisposable {
    const existing = registered.get(api);
    if (existing) {
        return existing;
    }

    api.languages.register({
        id: AXIS_LANGUAGE_ID,
        extensions: [AXIS_FILE_EXTENSION],
        aliases: ['Axis', 'axis'],
    });

    const disposables: monaco.IDisposable[] = [
        api.languages.setMonarchTokensProvider(AXIS_LANGUAGE_ID, createAxisMonarchLanguage()),
        api.languages.setLanguageConfiguration(AXIS_LANGUAGE_ID, toMonacoLanguageConfiguration()),
        registerAxisCompletions(api),
        registerAxisFormatting(api),
        registerAxisDiagnostics(api),
    ];

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
