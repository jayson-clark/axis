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
 * Colours are the `--axis-*` tokens `AxisViewer` defines, so this looks right
 * mounted inside it and needs a host to have set nothing up.
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
                padding: 12,
                boxSizing: 'border-box',
                background: 'var(--axis-surface)',
                color: 'var(--axis-fg)',
                ...style,
            }}
        >
            <div
                style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                    marginBottom: 12,
                    paddingBottom: 8,
                    borderBottom: '1px solid var(--axis-border)',
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
                                border: '1px solid var(--axis-border)',
                                background: isActive
                                    ? 'var(--axis-accent)'
                                    : 'var(--axis-surface-raised)',
                                color: isActive ? 'var(--axis-accent-fg)' : 'var(--axis-fg)',
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
                    fontFamily: 'var(--axis-mono)',
                    fontSize: 'var(--axis-mono-size)',
                }}
            >
                {json}
            </pre>
        </div>
    );
}
