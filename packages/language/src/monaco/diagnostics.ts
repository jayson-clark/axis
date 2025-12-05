// ═════════════════════════════════════════════════════════════════════════════
// Diagnostics - Monaco markers
// ═════════════════════════════════════════════════════════════════════════════

import type * as monaco from 'monaco-editor/editor';
import { AXIS_LANGUAGE_ID, AxisDiagnostic, createDebouncer, validateAxis } from '../index';
import type { MonacoApi } from './types';

/** Marker owner, so a re-validation replaces its own markers and nothing else. */
const OWNER = 'axis';

/** How long an edit sits before the document is re-checked. */
const DEBOUNCE_MS = 250;

function toMarkers(api: MonacoApi, diagnostics: AxisDiagnostic[]): monaco.editor.IMarkerData[] {
    const { Error, Warning } = api.MarkerSeverity;

    // Monaco lines and columns are 1-based; the core service is 0-based.
    return diagnostics.map(diagnostic => ({
        severity: diagnostic.severity === 'error' ? Error : Warning,
        message: diagnostic.message,
        code: diagnostic.code,
        source: 'axis',
        startLineNumber: diagnostic.line + 1,
        endLineNumber: diagnostic.line + 1,
        startColumn: diagnostic.startCharacter + 1,
        endColumn: diagnostic.endCharacter + 1,
    }));
}

/**
 * Keep Axis markers in step with every Axis model in `api`.
 *
 * Models of other languages are watched too, but only so that a model switched
 * to Axis starts being checked - and one switched away has its markers cleared.
 *
 * @returns a disposable that detaches every listener and clears the markers.
 */
export function registerAxisDiagnostics(api: MonacoApi): monaco.IDisposable {
    const watched = new Map<string, monaco.IDisposable[]>();
    const pending = createDebouncer<string>(DEBOUNCE_MS);

    const validate = (model: monaco.editor.ITextModel) => {
        if (model.isDisposed()) {
            return;
        }
        const markers =
            model.getLanguageId() === AXIS_LANGUAGE_ID
                ? toMarkers(api, validateAxis(model.getValue()))
                : [];
        api.editor.setModelMarkers(model, OWNER, markers);
    };

    const watch = (model: monaco.editor.ITextModel) => {
        const key = model.uri.toString();
        if (watched.has(key)) {
            return;
        }
        watched.set(key, [
            model.onDidChangeContent(() =>
                pending.schedule(model.uri.toString(), () => validate(model)),
            ),
            model.onDidChangeLanguage(() => validate(model)),
        ]);
        validate(model);
    };

    const unwatch = (model: monaco.editor.ITextModel) => {
        const key = model.uri.toString();
        watched.get(key)?.forEach(listener => listener.dispose());
        watched.delete(key);
        pending.cancel(key);
    };

    api.editor.getModels().forEach(watch);
    const onCreate = api.editor.onDidCreateModel(watch);
    const onDispose = api.editor.onWillDisposeModel(unwatch);

    return {
        dispose() {
            onCreate.dispose();
            onDispose.dispose();
            for (const model of api.editor.getModels()) {
                api.editor.setModelMarkers(model, OWNER, []);
            }
            watched.forEach(listeners => listeners.forEach(listener => listener.dispose()));
            watched.clear();
            pending.dispose();
        },
    };
}
