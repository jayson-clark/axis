import { CSSProperties, useRef, useState } from 'react';
import { isVsCodeWebview, type ViewerTransport } from '@axis-dsl/protocol';
import { DesmosGraph, DesmosGraphHandle } from './DesmosGraph.js';
import { JsonInspector, JsonView } from './JsonInspector.js';
import { useViewerState } from './useViewerState.js';
import { VSCODE_THEME_VARS } from './theme.js';

export type AxisViewerTab = 'graph' | 'json';

export interface AxisViewerProps {
    /** The viewer's only input. Everything it shows arrives over this. */
    transport: ViewerTransport;
    className?: string;
    style?: CSSProperties;
}

const TABS: { id: AxisViewerTab; label: string }[] = [
    { id: 'graph', label: 'Graph' },
    { id: 'json', label: 'JSON' },
];

const BORDER = '1px solid var(--axis-border, rgba(127,127,127,0.3))';
const MONO = 'var(--axis-mono, ui-monospace, SFMono-Regular, Menlo, monospace)';

function tabStyle(isActive: boolean): CSSProperties {
    return {
        padding: '8px 14px',
        background: 'none',
        border: 'none',
        borderBottom: `2px solid ${isActive ? 'var(--axis-accent, #2d70b3)' : 'transparent'}`,
        color: isActive ? 'var(--axis-fg, inherit)' : 'var(--axis-fg-muted, inherit)',
        font: 'inherit',
        cursor: 'pointer',
    };
}

/**
 * The Axis results panel: a live Desmos graph beside the JSON behind it.
 *
 * Both hosts render this same component over the same protocol — the extension
 * across the webview bridge, the playground over an in-process channel. The one
 * thing it decides for itself is theming: inside a VSCode webview it maps its
 * `--axis-*` hooks onto the `--vscode-*` theme, and anywhere else it inherits
 * whatever the surrounding page defines.
 */
export function AxisViewer({ transport, className, style }: AxisViewerProps) {
    const graphRef = useRef<DesmosGraphHandle>(null);
    const [activeTab, setActiveTab] = useState<AxisViewerTab>('graph');
    const [inVsCode] = useState(isVsCodeWebview);
    const { apiKey, canSetApiKey, expressions, settings, status } = useViewerState(transport);

    const jsonViews: JsonView[] = [
        { id: 'compiled', label: 'Compiled', get: () => expressions },
        { id: 'settings', label: 'Settings', get: () => settings ?? null },
        {
            id: 'getExpressions',
            label: 'getExpressions()',
            get: () => graphRef.current?.getExpressions(),
        },
        { id: 'getState', label: 'getState()', get: () => graphRef.current?.getState() },
    ];

    return (
        <div
            className={className}
            style={{
                ...(inVsCode ? VSCODE_THEME_VARS : null),
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                minHeight: 0,
                height: '100%',
                background: 'var(--axis-surface, transparent)',
                color: 'var(--axis-fg, inherit)',
                ...style,
            }}
        >
            <div
                role="tablist"
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '0 8px',
                    flex: 'none',
                    borderBottom: BORDER,
                }}
            >
                {TABS.map(tab => (
                    <button
                        key={tab.id}
                        role="tab"
                        aria-selected={activeTab === tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        style={tabStyle(activeTab === tab.id)}
                    >
                        {tab.label}
                    </button>
                ))}
                {status !== null && (
                    <span
                        style={{
                            marginLeft: 'auto',
                            paddingRight: 8,
                            color: 'var(--axis-fg-muted, inherit)',
                            fontFamily: MONO,
                            fontSize: 'var(--axis-mono-size, 12px)',
                        }}
                    >
                        {status}
                    </span>
                )}
            </div>

            {/* Both panes stay mounted: unmounting the graph would tear down the
                calculator and lose the user's viewport when switching tabs. */}
            <div
                style={{
                    flex: 1,
                    minHeight: 0,
                    display: activeTab === 'graph' ? 'flex' : 'none',
                    flexDirection: 'column',
                }}
            >
                <DesmosGraph
                    ref={graphRef}
                    apiKey={apiKey}
                    expressions={expressions}
                    settings={settings}
                    renderError={message => (
                        <div
                            style={{
                                padding: 24,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'flex-start',
                                gap: 12,
                                color: 'var(--axis-danger, #e06c6c)',
                            }}
                        >
                            <p style={{ margin: 0 }}>{message}</p>
                            {/* Only the host knows where a key is kept, so this
                                asks rather than opening anything itself — and
                                only when the host said it can answer. */}
                            {canSetApiKey && (
                                <button
                                    onClick={() => transport.send({ command: 'requestApiKey' })}
                                    style={{
                                        padding: '5px 12px',
                                        borderRadius: 4,
                                        cursor: 'pointer',
                                        border: BORDER,
                                        background: 'var(--axis-surface-raised, transparent)',
                                        color: 'var(--axis-fg, inherit)',
                                        font: 'inherit',
                                    }}
                                >
                                    Set an API key
                                </button>
                            )}
                        </div>
                    )}
                />
            </div>

            <div
                style={{
                    flex: 1,
                    minHeight: 0,
                    display: activeTab === 'json' ? 'flex' : 'none',
                    flexDirection: 'column',
                }}
            >
                <JsonInspector views={jsonViews} />
            </div>
        </div>
    );
}
