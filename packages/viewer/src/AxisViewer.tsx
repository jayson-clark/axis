import { CSSProperties, Ref, useImperativeHandle, useRef, useState } from 'react';
import type { AsyncScreenshotOptions } from '@axis-dsl/desmos';
import type { ConnectionState, ViewerTransport } from '@axis-dsl/protocol';
import { DesmosGraph, DesmosGraphHandle } from './DesmosGraph.js';
import { JsonInspector, JsonView } from './JsonInspector.js';
import { useViewerState } from './useViewerState.js';
import { AXIS_COLOR_SCHEME, AXIS_THEME } from './theme.js';

export type AxisViewerTab = 'graph' | 'json';

/**
 * The graph the viewer owns, handed back to the host. What to do with an image
 * - download it, put it on the clipboard, store it as a thumbnail - is the
 * host's to decide; the viewer only takes the picture.
 */
export interface AxisViewerHandle {
    /** The graph pane's own handle, for the rest of {@link DesmosGraphHandle}. */
    getGraph(): DesmosGraphHandle | null;
    /** Shorthand for `getGraph()?.capture(options)`, null before it mounts. */
    capture(options?: AsyncScreenshotOptions): Promise<string | null>;
}

export interface AxisViewerProps {
    /** Exposes {@link AxisViewerHandle}. A plain prop, as React 19 has it. */
    ref?: Ref<AxisViewerHandle>;
    /** The viewer's only input. Everything it shows arrives over this. */
    transport: ViewerTransport;
    className?: string;
    /** Applied after the theme, so a host can override any `--axis-*` token. */
    style?: CSSProperties;
}

const TABS: { id: AxisViewerTab; label: string }[] = [
    { id: 'graph', label: 'Graph' },
    { id: 'json', label: 'JSON' },
];

/**
 * What to say about a connection that is not up, or null to say nothing.
 *
 * A first load is silent: `connecting` before anything has ever arrived is just
 * the page starting, and a banner for it would flash on every open. After that
 * the same state means the graph on screen has stopped tracking the file, which
 * has to be said — a stale graph that still looks live is worse than no graph.
 */
function connectionNotice(
    connection: ConnectionState,
    hasConnected: boolean,
): { text: string; tone: 'warning' | 'error' } | null {
    if (connection === 'connected' || (connection === 'connecting' && !hasConnected)) {
        return null;
    }
    return connection === 'connecting'
        ? { text: 'Reconnecting to the preview server…', tone: 'warning' }
        : {
              text: 'The preview server has stopped. This graph is no longer live.',
              tone: 'error',
          };
}

function tabStyle(isActive: boolean): CSSProperties {
    return {
        padding: '8px 10px',
        background: 'none',
        border: 'none',
        borderBottom: `2px solid ${isActive ? 'var(--axis-accent)' : 'transparent'}`,
        color: isActive ? 'var(--axis-fg)' : 'var(--axis-fg-muted)',
        font: 'inherit',
        cursor: 'pointer',
    };
}

/**
 * The Axis results panel: a live Desmos graph beside the JSON behind it.
 *
 * Every host renders this same component over the same protocol — the preview
 * page over an HTTP event stream, the playground over an in-process channel —
 * and it looks the same in all of them. What differs between hosts is which
 * transport they hand it and nothing else.
 */
export function AxisViewer({ ref, transport, className, style }: AxisViewerProps) {
    const graphRef = useRef<DesmosGraphHandle>(null);
    const [activeTab, setActiveTab] = useState<AxisViewerTab>('graph');
    const { apiKey, canSetApiKey, expressions, settings, status, connection, hasConnected } =
        useViewerState(transport);
    const notice = connectionNotice(connection, hasConnected);

    useImperativeHandle(
        ref,
        () => ({
            getGraph: () => graphRef.current,
            // The graph pane stays mounted on the JSON tab, so this works
            // whichever tab is showing.
            capture: options => graphRef.current?.capture(options) ?? Promise.resolve(null),
        }),
        [],
    );

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
                ...AXIS_THEME,
                colorScheme: AXIS_COLOR_SCHEME,
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                minHeight: 0,
                height: '100%',
                background: 'var(--axis-surface)',
                color: 'var(--axis-fg)',
                fontFamily: 'var(--axis-font)',
                fontSize: 'var(--axis-font-size)',
                ...style,
            }}
        >
            <div
                role="tablist"
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    padding: '0 8px',
                    flex: 'none',
                    borderBottom: '1px solid var(--axis-border)',
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
                            color: 'var(--axis-fg-muted)',
                            fontFamily: 'var(--axis-mono)',
                            fontSize: 'var(--axis-mono-size)',
                            // A long path shortens from the left, keeping the
                            // file name - the part worth reading - on screen.
                            direction: 'rtl',
                            textAlign: 'left',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                        title={status}
                    >
                        {status}
                    </span>
                )}
            </div>

            {notice && (
                <div
                    role="status"
                    style={{
                        flex: 'none',
                        padding: '6px 12px',
                        fontSize: 'var(--axis-mono-size)',
                        fontFamily: 'var(--axis-mono)',
                        color: notice.tone === 'error' ? 'var(--axis-danger)' : 'var(--axis-fg)',
                        background:
                            notice.tone === 'error'
                                ? 'color-mix(in srgb, var(--axis-danger) 16%, var(--axis-surface))'
                                : 'var(--axis-surface-raised)',
                        borderBottom: `1px solid ${
                            notice.tone === 'error' ? 'var(--axis-danger)' : 'var(--axis-border)'
                        }`,
                    }}
                >
                    {notice.text}
                </div>
            )}

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
                                color: 'var(--axis-danger)',
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
                                        border: 'none',
                                        background: 'var(--axis-accent)',
                                        color: 'var(--axis-accent-fg)',
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
