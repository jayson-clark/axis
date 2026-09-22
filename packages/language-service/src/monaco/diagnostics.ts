// ═════════════════════════════════════════════════════════════════════════════
// Diagnostics - Monaco markers
// ═════════════════════════════════════════════════════════════════════════════

import type * as monaco from 'monaco-editor/editor';
import { getDiagnostics, type Diagnostic, type SemanticChecker } from '../diagnostics';
import { AXIS_LANGUAGE_ID } from '../language';
import { toMonacoRange, treeOf } from './convert';
import type { MonacoApi } from './themes';

/** Marker owner, so a re-validation replaces its own markers and nothing else. */
const OWNER = 'axis';

/** How long an edit sits before the document is re-checked. */
const DEBOUNCE_MS = 250;

export interface AxisDiagnosticsOptions {
    /** The compiler's checker, for the diagnostics the syntax alone cannot give. */
    semantic?: SemanticChecker;
}

function toMarkers(api: MonacoApi, diagnostics: Diagnostic[]): monaco.editor.IMarkerData[] {
    const severities = {
        error: api.MarkerSeverity.Error,
        warning: api.MarkerSeverity.Warning,
        info: api.MarkerSeverity.Info,
    };
    return diagnostics.map(diagnostic => {
        const range = toMonacoRange(diagnostic.range);
        // An empty range - a value missing at the end of a line - would draw
        // nothing at all, so it is widened to the character it sits before.
        const empty =
            range.startLineNumber === range.endLineNumber && range.startColumn === range.endColumn;
        return {
            severity: severities[diagnostic.severity],
            message: diagnostic.message,
            code: diagnostic.code,
            source: 'axis',
            ...range,
            endColumn: empty ? range.endColumn + 1 : range.endColumn,
        };
    });
}

/**
 * Keep Axis markers in step with every Axis model in `api`.
 *
 * Models of other languages are watched too, but only so that a model switched
 * to Axis starts being checked - and one switched away has its markers cleared.
 *
 * @returns a disposable that detaches every listener and clears the markers.
 */
export function registerAxisDiagnostics(
    api: MonacoApi,
    options: AxisDiagnosticsOptions = {},
): monaco.IDisposable {
    const watched = new Map<string, monaco.IDisposable[]>();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    const validate = (model: monaco.editor.ITextModel) => {
        if (model.isDisposed()) return;
        const markers =
            model.getLanguageId() === AXIS_LANGUAGE_ID
                ? toMarkers(api, getDiagnostics(treeOf(model), { semantic: options.semantic }))
                : [];
        api.editor.setModelMarkers(model, OWNER, markers);
    };

    const cancel = (key: string) => {
        clearTimeout(timers.get(key));
        timers.delete(key);
    };

    const schedule = (model: monaco.editor.ITextModel) => {
        const key = model.uri.toString();
        cancel(key);
        timers.set(
            key,
            setTimeout(() => {
                timers.delete(key);
                validate(model);
            }, DEBOUNCE_MS),
        );
    };

    const watch = (model: monaco.editor.ITextModel) => {
        const key = model.uri.toString();
        if (watched.has(key)) return;
        watched.set(key, [
            model.onDidChangeContent(() => schedule(model)),
            model.onDidChangeLanguage(() => validate(model)),
        ]);
        validate(model);
    };

    const unwatch = (model: monaco.editor.ITextModel) => {
        const key = model.uri.toString();
        watched.get(key)?.forEach(listener => listener.dispose());
        watched.delete(key);
        cancel(key);
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
            [...timers.keys()].forEach(cancel);
        },
    };
}
