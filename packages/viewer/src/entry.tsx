// Standalone entry for the preview page: the extension's server serves the
// bundle this produces, and drives it over the page's own event stream.
import { createRoot } from 'react-dom/client';
import { createHttpTransport, PREVIEW_QUERY } from '@axis-dsl/protocol';
import { AxisViewer } from './AxisViewer.js';

// The tabs are the extension's `axis.preview.debug` setting, carried here in
// the URL the preview was opened at: the page has no other channel to the
// settings, and the server knows the answer when it hands the link over.
const debug = new URLSearchParams(location.search).has(PREVIEW_QUERY.debug);

createRoot(document.getElementById('root')!).render(
    <AxisViewer transport={createHttpTransport()} debug={debug} />,
);
