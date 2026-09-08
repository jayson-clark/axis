import { useEffect, useState } from 'react';
import { DESMOS_DEMO_API_KEY } from '@axis-dsl/desmos';
import { AxisEditor } from './AxisEditor';
import { monaco } from './monaco';
import { AxisViewer, useLocalViewerHost } from '@axis-dsl/viewer';
import { SplitPane } from './SplitPane';
import { useCompiledAxis } from './useCompiledAxis';

/**
 * Put your own Desmos API key here. It defaults to Desmos' public demo key so
 * the example runs with no setup — that key logs a console warning and is not
 * licensed for distribution, so replace it before deploying this anywhere.
 */
const DESMOS_API_KEY = DESMOS_DEMO_API_KEY;

const STARTER_SOURCE = `// Welcome to Axis — a scripting language for Desmos.
// Edit on the left, watch the graph update on the right.

config {
    degreeMode: false,
    showGrid: true
}

"Getting started"

f(x) = x^2 - 4x + 3 # color: #c74440

g(x) = sin(x) + cos(2x) # color: #2d70b3, lineWidth: 2

a = 1.5 # playing: true

h(x) = a * f(x) # color: #388c46, lineStyle: DASHED
`;

/** Follows the OS setting. There is no in-app toggle to keep in sync with it. */
function useSystemTheme(): 'dark' | 'light' {
    const query = window.matchMedia?.('(prefers-color-scheme: light)');
    const [theme, setTheme] = useState<'dark' | 'light'>(query?.matches ? 'light' : 'dark');

    useEffect(() => {
        if (!query) {
            return;
        }
        const update = () => setTheme(query.matches ? 'light' : 'dark');
        query.addEventListener('change', update);
        return () => query.removeEventListener('change', update);
    }, [query]);

    return theme;
}

export function App() {
    const [source, setSource] = useState(STARTER_SOURCE);
    const theme = useSystemTheme();

    const { expressions, settings, graph, ticker, error, isStale } = useCompiledAxis(source);

    // The playground drives the viewer over the same protocol the extension
    // uses; the only difference is that the channel never leaves the page.
    // No `onRequestApiKey`: the key is fixed here, so the viewer is told not to
    // offer a button that would have nowhere to lead.
    const viewerTransport = useLocalViewerHost({
        apiKey: DESMOS_API_KEY,
        expressions,
        settings,
        graph,
        ticker,
        status: isStale
            ? 'Compiling…'
            : `${expressions.length} expression${expressions.length === 1 ? '' : 's'}`,
    });

    return (
        <div className="app">
            <SplitPane
                left={
                    <div className="pane">
                        <AxisEditor
                            monaco={monaco}
                            value={source}
                            onChange={setSource}
                            theme={theme}
                        />
                        {error && (
                            <div className="error-bar" role="alert">
                                <strong>Compile error</strong> {error}
                            </div>
                        )}
                    </div>
                }
                // `debug`: this is a workbench next to an editor, so the JSON
                // the compiler produced is half of what there is to look at -
                // and the status line is where the expression count above goes.
                right={<AxisViewer transport={viewerTransport} debug />}
            />
        </div>
    );
}
