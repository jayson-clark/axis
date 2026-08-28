// Standalone entry for the preview page: the extension's server serves the
// bundle this produces, and drives it over the page's own event stream.
import { createRoot } from 'react-dom/client';
import { createHttpTransport } from '@axis-dsl/protocol';
import { AxisViewer } from './AxisViewer.js';

createRoot(document.getElementById('root')!).render(
    <AxisViewer transport={createHttpTransport()} />,
);
