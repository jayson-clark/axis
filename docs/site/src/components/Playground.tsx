// ═════════════════════════════════════════════════════════════════════════════
// The playground: an Axis editor beside the graph it compiles to
// ═════════════════════════════════════════════════════════════════════════════
//
// Built from the same pieces as the standalone playground in `examples/web` -
// its Monaco wrapper, its Monaco loader and its compile hook are that app's,
// imported rather than copied - with the viewer drawing the graph over the
// same protocol the VSCode preview uses. Dragging something in the graph
// writes the change back into the script, as it does there.
//
// The script to open with comes from the page's fragment, `#code=…`, which is
// what every "Open in playground" link under an example on the site carries.

import { useEffect, useMemo, useState } from 'react';
import { applySourceEdits, writeBackGraph } from '@axis-dsl/compiler';
import { AXIS_DESMOS_API_KEY } from '@axis-dsl/desmos';
import { registerAxisLanguage } from '@axis-dsl/language-service/monaco';
import { AxisViewer, useLocalViewerHost } from '@axis-dsl/viewer';
import { AxisEditor } from '../../../../examples/web/src/AxisEditor';
import { monaco } from '../../../../examples/web/src/monaco';
import { useCompiledAxis } from '../../../../examples/web/src/useCompiledAxis';
import { PLAYGROUND_OPTIONS } from './files';
import { decodeSource } from './share';

// Registered here, before the editor's own registration - the first one on a
// Monaco instance is the one that holds - so completions, hover and the
// editor's diagnostics can follow an import into the bundled files as the
// compile does.
registerAxisLanguage(monaco, {
    pathOf: () => PLAYGROUND_OPTIONS.path,
    resolveImport: PLAYGROUND_OPTIONS.resolveImport,
    resolveImage: PLAYGROUND_OPTIONS.resolveImage,
});

const STARTER = `// Edit on the left, watch the graph update on the right -
// or drag something on the right, and watch the left catch up.

f(x) = x ^ 2 - 4x + 3 @ color: RED

a = 1.5 @ slider: 0..3
g(x) = a sin(x) @ color: BLUE, lineStyle: DASHED

P = (1, 2) @ dragMode: XY, label: "drag me", showLabel
`;

/** Starlight's theme, which follows its own toggle rather than only the OS. */
function useStarlightTheme(): 'dark' | 'light' {
    const read = () =>
        document.documentElement.dataset.theme === 'light' ? ('light' as const) : ('dark' as const);
    const [theme, setTheme] = useState(read);
    useEffect(() => {
        const observer = new MutationObserver(() => setTheme(read()));
        observer.observe(document.documentElement, { attributeFilter: ['data-theme'] });
        return () => observer.disconnect();
    }, []);
    return theme;
}

/** The script the page was opened with, or the starter. */
function initialSource(): string {
    return decodeSource(window.location.hash) ?? STARTER;
}

export default function Playground() {
    const [source, setSource] = useState(initialSource);
    const theme = useStarlightTheme();

    // A link to another example, followed while this page is open, changes
    // only the fragment.
    useEffect(() => {
        const update = () => {
            const next = decodeSource(window.location.hash);
            if (next !== undefined) setSource(next);
        };
        window.addEventListener('hashchange', update);
        return () => window.removeEventListener('hashchange', update);
    }, []);

    const { state, options, error, isStale, compiled } = useCompiledAxis(
        source,
        PLAYGROUND_OPTIONS,
    );
    const count = state?.expressions?.list?.length ?? 0;

    const transport = useLocalViewerHost({
        apiKey: AXIS_DESMOS_API_KEY,
        state,
        options,
        status: isStale ? 'Compiling…' : `${count} expression${count === 1 ? '' : 's'}`,
        // Only against the compilation the graph on screen came from: a script
        // typed over since has spans that no longer point at anything.
        onGraphChanged: (before, after) => {
            if (!compiled || isStale || compiled.source !== source) return;
            const { edits } = writeBackGraph(
                compiled.source,
                { before, after },
                compiled.compilation,
            );
            if (edits.length > 0) setSource(applySourceEdits(compiled.source, edits));
        },
    });

    const editorOptions = useMemo(() => ({ fontSize: 14 }), []);

    return (
        // `not-content`: Starlight styles the elements of a page's prose, and
        // Monaco's and Desmos' own are not prose.
        <div className="axis-playground not-content">
            <div className="axis-playground__editor">
                <AxisEditor
                    monaco={monaco}
                    value={source}
                    onChange={setSource}
                    theme={theme}
                    options={editorOptions}
                />
                {error && (
                    <div className="axis-playground__error" role="alert">
                        {error}
                    </div>
                )}
            </div>
            <div className="axis-playground__graph">
                <AxisViewer transport={transport} />
            </div>
        </div>
    );
}
