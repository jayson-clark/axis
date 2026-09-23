// The playground, loaded only once the page is in a browser. Prerendering a
// page imports its islands' modules even when they render client-side only,
// and Monaco's modules import CSS that Node cannot load - so the page imports
// this, and this imports the playground when it first renders.

import { lazy, Suspense } from 'react';

const Playground = lazy(() => import('./Playground'));

export default function PlaygroundIsland() {
    return (
        <Suspense fallback={<div className="axis-playground" aria-busy="true" />}>
            <Playground />
        </Suspense>
    );
}
