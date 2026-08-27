// ═════════════════════════════════════════════════════════════════════════════
// Formatting - Monaco document and range formatters
// ═════════════════════════════════════════════════════════════════════════════

import type * as monaco from 'monaco-editor/editor';
import {
    AXIS_LANGUAGE_ID,
    formatAxisCode,
    formatAxisCodeWithIndent,
    indentLevelOf,
} from '../index';
import type { MonacoApi } from './types';

/**
 * Register the Axis document and range formatters on `api`.
 *
 * @returns a disposable that unregisters both.
 */
export function registerAxisFormatting(api: MonacoApi): monaco.IDisposable {
    const documentProvider = api.languages.registerDocumentFormattingEditProvider(
        AXIS_LANGUAGE_ID,
        {
            provideDocumentFormattingEdits(model, options) {
                const text = model.getValue();
                const formatted = formatAxisCode(text, options);
                if (formatted === text) {
                    return [];
                }
                return [{ range: model.getFullModelRange(), text: formatted }];
            },
        },
    );

    const rangeProvider = api.languages.registerDocumentRangeFormattingEditProvider(
        AXIS_LANGUAGE_ID,
        {
            provideDocumentRangeFormattingEdits(model, range, options) {
                // Formatting works line-wise, so widen a partial selection.
                const fullRange: monaco.IRange = {
                    startLineNumber: range.startLineNumber,
                    startColumn: 1,
                    endLineNumber: range.endLineNumber,
                    endColumn: model.getLineMaxColumn(range.endLineNumber),
                };

                const text = model.getValueInRange(fullRange);
                const formatted = formatAxisCodeWithIndent(
                    text,
                    options,
                    indentLevelOf(model.getLineContent(range.startLineNumber), options),
                );

                return formatted === text ? [] : [{ range: fullRange, text: formatted }];
            },
        },
    );

    return {
        dispose() {
            documentProvider.dispose();
            rangeProvider.dispose();
        },
    };
}
