/**
 * Reconnecting or deleting is ONE edit: the change, the boundary-port wires
 * it orphans, and (for a boundary) its children being handed to its parent
 * all land in a single transaction. So peers receive one update, and one
 * undo puts everything back - even with no capture window to merge separate
 * transactions after the fact.
 *
 * The hook's real callbacks are driven against a real Yjs document. A server
 * render runs the hook once (no effects), which is all its callbacks need.
 *
 * Run with: npx tsx --tsconfig tsconfig.app.json src/app/hooks/useCanvasEditing.undo.verify.tsx
 */
import 'fake-indexeddb/auto';
import {renderToStaticMarkup} from 'react-dom/server';
import type {Edge, Node} from '@xyflow/react';
import {openDocument} from '../../collab/sync/localDocument';
import {createUndoController, undoableStore} from '../../collab/stores/undoManager';
import type {DiagramStore} from '../../collab/stores/diagramStore';
import {portId} from '../../domain/canvas/boundaryPorts';
import type {ArchEdgeData, ArchNodeData} from '../../domain/canvas/types';
import type {DiagramFile} from '../../domain/canvas/serialization';
import {SCHEMA_VERSION} from '../../domain/canvas/serialization';
import {EMPTY_REQUIREMENTS_DOCUMENT} from '../../domain/requirements/requirementsTypes';
import {BUILT_IN_ITEM_TYPES, BUILT_IN_RELATIONSHIP_TYPES,} from '../../domain/requirements/requirementsRegistry';
import {EMPTY_TEAM_DOCUMENT} from '../../domain/timeline/teamTypes';
import {useCanvasEditing} from './useCanvasEditing';

let failures = 0;

function assert(condition: boolean, message: string) {
    if (condition) console.log(`  ✓ ${message}`);
    else {
        failures++;
        console.error(`  FAIL: ${message}`);
    }
}

const edgeData = {edgeType: 'blank-solid', label: '', direction: 'forward', properties: {}};

/**
 * Root: X -e1-> P, where P's sub-diagram wires e1's inbound port to Y (w1);
 * and a boundary G at (100, 100) holding C at (10, 20).
 */
function makeFile(): DiagramFile {
    return {
        schemaVersion: SCHEMA_VERSION,
        title: 'Undo grouping',
        nodes: [
            {
                id: 'X',
                type: 'typed',
                position: {x: 0, y: 0},
                data: {nodeType: 'service', label: 'X'},
            },
            {
                id: 'P',
                type: 'typed',
                position: {x: 400, y: 0},
                data: {
                    nodeType: 'service',
                    label: 'P',
                    subDiagram: {
                        nodes: [
                            {
                                id: 'Y',
                                type: 'typed',
                                position: {x: 50, y: 50},
                                data: {nodeType: 'service', label: 'Y'},
                            },
                        ],
                        edges: [
                            {id: 'w1', source: portId('e1', 'in'), target: 'Y', type: 'typed', data: edgeData},
                        ],
                    },
                },
            },
            {
                id: 'G',
                type: 'group',
                position: {x: 100, y: 100},
                width: 400,
                height: 300,
                data: {nodeType: 'boundary', label: 'G'},
            },
            {
                id: 'C',
                type: 'typed',
                parentId: 'G',
                position: {x: 10, y: 20},
                data: {nodeType: 'service', label: 'C'},
            },
        ],
        edges: [{id: 'e1', source: 'X', target: 'P', type: 'typed', data: edgeData}],
        scenarios: [],
        requirements: {
            ...EMPTY_REQUIREMENTS_DOCUMENT,
            itemTypes: BUILT_IN_ITEM_TYPES,
            relationshipTypes: BUILT_IN_RELATIONSHIP_TYPES,
        },
        programIncrements: [],
        team: EMPTY_TEAM_DOCUMENT,
        milestones: [],
        metadata: {updatedAt: '2026-01-01T00:00:00.000Z'},
    } as unknown as DiagramFile;
}

type Editing = ReturnType<typeof useCanvasEditing>;

/** A fresh document, undo controller and hook for each case. */
async function setup(name: string) {
    const opened = await openDocument({
        docId: `undo-grouping-${name}`,
        initial: makeFile(),
        persist: false,
    });
    // No capture window: separate transactions can never be merged into one
    // undo step after the fact, so only a real single transaction passes.
    const undo = createUndoController(opened.doc, {captureTimeout: 0});
    const store = undoableStore(opened.stores.diagram, undo) as DiagramStore;
    let editing: Editing | undefined;

    function Harness() {
        editing = useCanvasEditing({
            diagramStore: store,
            diagramSnapshot: store.getSnapshot() as {
                nodes: Node<ArchNodeData>[];
                edges: Edge<ArchEdgeData>[];
            },
            undo,
            activeSession: null,
            presencePeers: [],
            broadcastPresence: () => {
            },
            path: [],
            setPath: () => {
            },
            selectedNodeIds: [],
            setSelectedNodeIds: () => {
            },
            selectedEdgeIds: [],
            setSelectedEdgeIds: () => {
            },
            isPresenting: false,
            setActiveStepId: () => {
            },
        });
        return null;
    }

    renderToStaticMarkup(<Harness/>);
    let transactions = 0;
    opened.doc.on('afterTransaction', () => transactions++);
    return {
        editing: editing!,
        undo,
        snapshot: () => store.getSnapshot(),
        transactions: () => transactions,
    };
}

const ids = (items: { id: string }[]) =>
    items
        .map((i) => i.id)
        .sort()
        .join(',');

// onDeleteNode asks before deleting a node with a populated sub-diagram.
(globalThis as unknown as { window: { confirm: () => boolean } }).window = {confirm: () => true};

async function run() {
    console.log('=== Deleting an edge takes its orphaned port wires in the same edit ===');
    {
        const t = await setup('delete-edge');
        const before = t.snapshot();
        t.editing.onDeleteEdge('e1');
        const after = t.snapshot();
        assert(
            !after.edges.some((e) => e.id === 'e1' || e.id === 'w1'),
            'the edge and its wire are gone',
        );
        assert(t.transactions() === 1, `one transaction (${t.transactions()})`);
        t.undo.undo();
        assert(
            ids(t.snapshot().edges) === ids(before.edges),
            'one undo restores the edge and its wire',
        );
        assert(!t.undo.canUndo(), 'and that was the only undo step');
    }

    console.log('=== Reconnecting an edge takes its orphaned port wires in the same edit ===');
    {
        const t = await setup('reconnect');
        t.editing.onReconnectEdge('e1', {source: 'X', target: 'G'});
        const after = t.snapshot();
        assert(after.edges.find((e) => e.id === 'e1')?.target === 'G', 'the edge is reconnected');
        assert(!after.edges.some((e) => e.id === 'w1'), 'the wire to its old port is gone');
        assert(t.transactions() === 1, `one transaction (${t.transactions()})`);
        t.undo.undo();
        const restored = t.snapshot();
        assert(
            restored.edges.find((e) => e.id === 'e1')?.target === 'P' &&
            restored.edges.some((e) => e.id === 'w1'),
            'one undo restores the old endpoint and the wire',
        );
        assert(!t.undo.canUndo(), 'and that was the only undo step');
    }

    console.log('=== Deleting a boundary hands its children on in the same edit ===');
    {
        const t = await setup('delete-group');
        t.editing.onDeleteNode('G');
        const after = t.snapshot();
        const child = after.nodes.find((n) => n.id === 'C');
        assert(!after.nodes.some((n) => n.id === 'G'), 'the boundary is gone');
        assert(
            child !== undefined &&
            !child.parentId &&
            child.position.x === 110 &&
            child.position.y === 120,
            `its child stays where it was, now at the top level (${JSON.stringify(child?.position)})`,
        );
        assert(t.transactions() === 1, `one transaction (${t.transactions()})`);
        t.undo.undo();
        const restored = t.snapshot().nodes.find((n) => n.id === 'C');
        assert(
            t.snapshot().nodes.some((n) => n.id === 'G') &&
            restored?.parentId === 'G' &&
            restored.position.x === 10 &&
            restored.position.y === 20,
            'one undo restores the boundary and puts the child back inside it',
        );
        assert(!t.undo.canUndo(), 'and that was the only undo step');
    }

    console.log('=== Deleting a node takes its edges, sub-diagram and wires in one edit ===');
    {
        const t = await setup('delete-node');
        const before = t.snapshot();
        t.editing.onDeleteNode('P');
        const after = t.snapshot();
        assert(
            !after.nodes.some((n) => n.id === 'P' || n.id === 'Y') &&
            !after.edges.some((e) => e.id === 'e1' || e.id === 'w1'),
            'the node, its sub-diagram and every edge touching it are gone',
        );
        assert(t.transactions() === 1, `one transaction (${t.transactions()})`);
        t.undo.undo();
        assert(
            ids(t.snapshot().nodes) === ids(before.nodes) &&
            ids(t.snapshot().edges) === ids(before.edges),
            'one undo restores all of it',
        );
        assert(!t.undo.canUndo(), 'and that was the only undo step');
    }

    if (failures > 0) {
        console.error(`\n${failures} check(s) failed`);
        (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
        return;
    }
    console.log('\nReconnect and delete are each one undoable edit.');
}

void run();
