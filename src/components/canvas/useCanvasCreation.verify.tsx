/**
 * Dropping palette items onto the canvas (useCanvasCreation's onDrop).
 *
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/canvas/useCanvasCreation.verify.tsx
 */
import React, {type DragEvent} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {useCanvasCreation} from './useCanvasCreation';
import {FRAGMENT_DRAG_MIME_TYPE} from './Palette';

let failures = 0;

function assert(condition: boolean, message: string) {
    if (condition) {
        console.log(`ok: ${message}`);
    } else {
        failures++;
        console.error(`FAIL: ${message}`);
    }
}

function dropOf(isPresenting: boolean) {
    const calls: string[] = [];
    let onDrop: ((event: DragEvent) => void) | null = null;

    function Probe() {
        ({onDrop} = useCanvasCreation({
            screenToFlowPosition: (p) => p,
            isPresenting,
            onAddNode: () => calls.push('node'),
            onAddGroup: () => calls.push('group'),
            onAddShape: () => calls.push('shape'),
            onAddCode: () => {
                calls.push('code');
                return 'code-1';
            },
            onAddText: () => {
                calls.push('text');
                return 'text-1';
            },
            onInsertFragment: (id, at) => calls.push(`fragment:${id}@${at.x},${at.y}`),
            setEditingLabelNodeId: () => {
            },
        }));
        return null;
    }

    renderToStaticMarkup(React.createElement(Probe));
    const event = {
        preventDefault: () => {
        },
        clientX: 10,
        clientY: 20,
        dataTransfer: {getData: (type: string) => (type === FRAGMENT_DRAG_MIME_TYPE ? 'frag-1' : '')},
    } as unknown as DragEvent;
    onDrop!(event);
    return calls;
}

assert(
    dropOf(false).join() === 'fragment:frag-1@10,20',
    'dropping a fragment while editing inserts it where it was dropped',
);
assert(dropOf(true).length === 0, 'dropping a fragment while presenting does nothing at all');

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) {
    (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
}
