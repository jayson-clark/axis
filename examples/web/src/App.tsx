import { useEffect, useState } from 'react';
import { applySourceEdits, writeBackGraph } from '@axis-dsl/compiler';
import { AXIS_DESMOS_API_KEY } from '@axis-dsl/desmos';
import { AxisEditor } from './AxisEditor';
import { monaco } from './monaco';
import { AxisViewer, useLocalViewerHost } from '@axis-dsl/viewer';
import { SplitPane } from './SplitPane';
import { useCompiledAxis } from './useCompiledAxis';

/**
 * The Axis project's Desmos API key. Put your own here if you deploy a copy of
 * this playground as part of something else - https://www.desmos.com/api
 */
const DESMOS_API_KEY = AXIS_DESMOS_API_KEY;

const STARTER_SOURCE = `// Welcome to Axis — a scripting language for Desmos.
// Edit on the left, watch the graph update on the right -
// or drag something on the right, and watch the left catch up.

config {
    degreeMode: false
    showGrid: true
}

"Getting started"

f(x) = x^2 - 4x + 3 @ color: #c74440

g(x) = sin(x) + cos(2x) @ color: #2d70b3, lineWidth: 2

a = 1.5 @ slider: 0..3

h(x) = a * f(x) @ color: #388c46, lineStyle: DASHED

P = (1, 2) @ dragMode: XY
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

    const { state, options, error, isStale, compiled } = useCompiledAxis(source);
    const count = state?.expressions?.list?.length ?? 0;

    // The playground drives the viewer over the same protocol the extension
    // uses; the only difference is that the channel never leaves the page.
    // No `onRequestApiKey`: the key is fixed here, so the viewer is told not to
    // offer a button that would have nowhere to lead.
    const viewerTransport = useLocalViewerHost({
        apiKey: DESMOS_API_KEY,
        state,
        options,
        status: isStale ? 'Compiling…' : `${count} expression${count === 1 ? '' : 's'}`,
        // Drag a point, move a slider, recolour a curve: the statement that
        // drew it is rewritten in the editor. Only against the compilation the
        // graph on screen came from - one typed over since has spans that no
        // longer point at anything, and the next compile resets the graph
        // anyway.
        onGraphChanged: (before, after) => {
            if (!compiled || isStale || compiled.source !== source) {
                return;
            }
            const { edits, skipped } = writeBackGraph(
                compiled.source,
                { before, after },
                compiled.compilation,
            );
            for (const { reason } of skipped) {
                console.info(`Not written back: ${reason}`);
            }
            if (edits.length > 0) {
                setSource(applySourceEdits(compiled.source, edits));
            }
        },
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
