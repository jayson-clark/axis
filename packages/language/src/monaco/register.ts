import type * as monaco from 'monaco-editor/editor';
import { AXIS_FILE_EXTENSION, AXIS_LANGUAGE_CONFIGURATION, AXIS_LANGUAGE_ID } from '../index';
import { createAxisMonarchLanguage } from './monarch';
import { registerAxisCompletions } from './completions';
import { registerAxisDiagnostics } from './diagnostics';
import { registerAxisFormatting } from './formatting';
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

/**
 * Teach a Monaco instance about Axis: syntax highlighting, bracket/comment
 * behaviour, completions, formatting, and syntax diagnostics.
 *
 * Safe to call once per Monaco instance; calling it twice would register a
 * second set of providers, so callers should guard (see `useAxisLanguage`).
 *
 * @returns a disposable that unregisters every provider it added.
 */
export function registerAxisLanguage(api: MonacoApi): monaco.IDisposable {
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

    return {
        dispose() {
            disposables.forEach(d => d.dispose());
        },
    };
}
