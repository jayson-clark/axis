import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';

export interface SplitPaneProps {
    left: ReactNode;
    right: ReactNode;
    /** Initial width of the left pane, as a fraction of the container. */
    defaultRatio?: number;
    minRatio?: number;
    maxRatio?: number;
}

/** Horizontal split with a draggable divider. */
export function SplitPane({
    left,
    right,
    defaultRatio = 0.45,
    minRatio = 0.2,
    maxRatio = 0.8,
}: SplitPaneProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [ratio, setRatio] = useState(defaultRatio);
    const [isDragging, setIsDragging] = useState(false);

    const applyClientX = useCallback(
        (clientX: number) => {
            const container = containerRef.current;
            if (!container) {
                return;
            }
            const bounds = container.getBoundingClientRect();
            const next = (clientX - bounds.left) / bounds.width;
            setRatio(Math.min(maxRatio, Math.max(minRatio, next)));
        },
        [minRatio, maxRatio],
    );

    useEffect(() => {
        if (!isDragging) {
            return;
        }

        const onMove = (event: PointerEvent) => applyClientX(event.clientX);
        const onUp = () => setIsDragging(false);

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        // Keeps the drag from selecting the editor text it passes over.
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';

        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
        };
    }, [isDragging, applyClientX]);

    return (
        <div className="split" ref={containerRef}>
            <div className="split__pane" style={{ flexBasis: `${ratio * 100}%` }}>
                {left}
            </div>
            <div
                className={`split__divider${isDragging ? ' split__divider--active' : ''}`}
                onPointerDown={() => setIsDragging(true)}
                onDoubleClick={() => setRatio(defaultRatio)}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize editor"
                tabIndex={0}
                onKeyDown={event => {
                    if (event.key === 'ArrowLeft') {
                        setRatio(r => Math.max(minRatio, r - 0.02));
                    } else if (event.key === 'ArrowRight') {
                        setRatio(r => Math.min(maxRatio, r + 0.02));
                    }
                }}
            />
            <div className="split__pane" style={{ flexBasis: `${(1 - ratio) * 100}%` }}>
                {right}
            </div>
        </div>
    );
}
