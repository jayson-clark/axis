import { CSSProperties, Ref, useEffect, useImperativeHandle, useRef } from 'react';
import type * as monacoTypes from 'monaco-editor/editor';
import { AXIS_LANGUAGE_ID } from '@axis-dsl/language/monaco';
import { AXIS_DARK_THEME, AXIS_LIGHT_THEME, setupAxis, type MonacoApi } from './monaco.js';

export interface AxisEditorHandle {
    format(): void;
    focus(): void;
    /** The underlying Monaco editor, or null before it is created. */
    getEditor(): monacoTypes.editor.IStandaloneCodeEditor | null;
}

export interface AxisEditorProps {
    /** Exposes {@link AxisEditorHandle}. A plain prop, as React 19 has it. */
    ref?: Ref<AxisEditorHandle>;
    /**
     * The Monaco namespace, loaded and worker-configured by the app — see the
     * package README. Passing it in rather than importing it keeps this package
     * bundler-agnostic and the Monaco instance shared.
     */
    monaco: MonacoApi;
    value: string;
    onChange: (value: string) => void;
    /** The Axis themes are this package's own; apps pick a side, not a name. */
    theme?: 'dark' | 'light';
    /** Merged over the defaults, and re-applied when it changes. */
    options?: monacoTypes.editor.IStandaloneEditorConstructionOptions;
    className?: string;
    style?: CSSProperties;
}

const DEFAULT_OPTIONS: monacoTypes.editor.IStandaloneEditorConstructionOptions = {
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    fontLigatures: true,
    tabSize: 4,
    insertSpaces: true,
    scrollBeyondLastLine: false,
    renderWhitespace: 'selection',
    padding: { top: 12, bottom: 12 },
    smoothScrolling: true,
    formatOnPaste: true,
};

function themeName(theme: 'dark' | 'light'): string {
    return theme === 'dark' ? AXIS_DARK_THEME : AXIS_LIGHT_THEME;
}

/**
 * Monaco bound to the Axis language. The editor is created once and updated in
 * place, so undo history and cursor position survive re-renders.
 */
export function AxisEditor({
    ref,
    monaco,
    value,
    onChange,
    theme = 'dark',
    options,
    className,
    style,
}: AxisEditorProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<monacoTypes.editor.IStandaloneCodeEditor | null>(null);

    // Held in refs so the mount effect never re-runs when the parent hands us a
    // new callback identity or a fresh options object.
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const latestRef = useRef({ value, theme, options });
    latestRef.current = { value, theme, options };

    useImperativeHandle(
        ref,
        () => ({
            format: () => {
                void editorRef.current?.getAction('editor.action.formatDocument')?.run();
            },
            focus: () => editorRef.current?.focus(),
            getEditor: () => editorRef.current,
        }),
        [],
    );

    useEffect(() => {
        const container = containerRef.current;
        if (!container) {
            return;
        }

        setupAxis(monaco);

        const initial = latestRef.current;
        const editor = monaco.editor.create(container, {
            ...DEFAULT_OPTIONS,
            ...initial.options,
            value: initial.value,
            language: AXIS_LANGUAGE_ID,
            theme: themeName(initial.theme ?? 'dark'),
        });
        editorRef.current = editor;

        const subscription = editor.onDidChangeModelContent(() => {
            onChangeRef.current(editor.getValue());
        });

        return () => {
            subscription.dispose();
            editor.getModel()?.dispose();
            editor.dispose();
            editorRef.current = null;
        };
        // Recreated only if the app swaps the Monaco instance; the effects below
        // keep everything else in step.
    }, [monaco]);

    // Only write back when the value truly diverges — echoing the user's own
    // keystrokes through setValue would reset the cursor on every character.
    useEffect(() => {
        const editor = editorRef.current;
        if (editor && editor.getValue() !== value) {
            editor.setValue(value);
        }
    }, [value]);

    // Themes are defined on the Monaco instance, so setting one is global to it.
    useEffect(() => {
        if (editorRef.current) {
            monaco.editor.setTheme(themeName(theme));
        }
    }, [monaco, theme]);

    useEffect(() => {
        if (options) {
            editorRef.current?.updateOptions(options);
        }
    }, [options]);

    return (
        <div
            ref={containerRef}
            className={className}
            style={{ width: '100%', height: '100%', ...style }}
        />
    );
}
