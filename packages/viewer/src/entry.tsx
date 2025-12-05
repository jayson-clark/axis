// Standalone entry for the VSCode webview: the extension loads the bundle this
// produces and drives it over the webview postMessage bridge.
import { createRoot } from 'react-dom/client';
import { createVsCodeTransport } from '@axis-dsl/protocol';
import { AxisViewer } from './AxisViewer.js';

createRoot(document.getElementById('root')!).render(
    <AxisViewer transport={createVsCodeTransport()} />,
);
