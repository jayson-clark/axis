import { CSSProperties, useState } from 'react';

export interface JsonView {
    id: string;
    label: string;
    /** Read lazily, so switching views always shows the calculator's live state. */
    get(): unknown;
}

export interface JsonInspectorProps {
    views: JsonView[];
    className?: string;
    style?: CSSProperties;
}

/**
 * Debug panel that shows the JSON behind the graph — what was compiled and
 * sent, and what the calculator reports back.
 *
 * Colours come from `--axis-*` custom properties so each host can theme it: in
 * a VSCode webview `AxisViewer` maps them onto `--vscode-*`, in the browser the
 * surrounding page defines them.
 */
export function JsonInspector({ views, className, style }: JsonInspectorProps) {
    const [activeId, setActiveId] = useState(views[0]?.id);
    const active = views.find(view => view.id === activeId) ?? views[0];

    let json: string;
    try {
        json = JSON.stringify(active?.get() ?? null, null, 2);
    } catch (error) {
        json = `Could not serialize: ${error instanceof Error ? error.message : String(error)}`;
    }

    return (
        <div
            className={className}
            style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                overflow: 'hidden',
                padding: 16,
                boxSizing: 'border-box',
                background: 'var(--axis-surface, transparent)',
                color: 'var(--axis-fg, inherit)',
                ...style,
            }}
        >
            <div
                style={{
                    display: 'flex',
                    gap: 8,
                    marginBottom: 16,
                    paddingBottom: 8,
                    borderBottom: '1px solid var(--axis-border, rgba(127,127,127,0.3))',
                }}
            >
                {views.map(view => {
                    const isActive = view.id === active?.id;
                    return (
                        <button
                            key={view.id}
                            onClick={() => setActiveId(view.id)}
                            style={{
                                padding: '6px 12px',
                                borderRadius: 4,
                                cursor: 'pointer',
                                border: '1px solid var(--axis-border, rgba(127,127,127,0.3))',
                                background: isActive
                                    ? 'var(--axis-accent, #2d70b3)'
                                    : 'var(--axis-surface-raised, transparent)',
                                color: isActive
                                    ? 'var(--axis-accent-fg, #fff)'
                                    : 'var(--axis-fg, inherit)',
                                font: 'inherit',
                            }}
                        >
                            {view.label}
                        </button>
                    );
                })}
            </div>
            <pre
                style={{
                    margin: 0,
                    flex: 1,
                    overflow: 'auto',
                    fontFamily: 'var(--axis-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
                    fontSize: 'var(--axis-mono-size, 12px)',
                }}
            >
                {json}
            </pre>
        </div>
    );
}
