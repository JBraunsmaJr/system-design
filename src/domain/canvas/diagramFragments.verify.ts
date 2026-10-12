/**
 * Verification for reusable diagram fragments (diagramFragments.ts), and
 * for saving and inserting them through the clipboard hook.
 *
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/canvas/diagramFragments.verify.ts
 */
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {Node} from '@xyflow/react';
import {
    deleteFragment,
    type DiagramFragmentContents,
    FRAGMENTS_STORAGE_KEY,
    getFragment,
    listFragments,
    MAX_FRAGMENT_BYTES,
    prepareFragmentContents,
    reloadFragments,
    renameFragment,
    saveFragment,
    subscribeToFragments,
    suggestFragmentName,
    translateFragmentContents,
    validateFragment,
} from './diagramFragments';
import type {ArchEdgeData, ArchNodeData} from './types';
import {createLocalDiagramStore, getEdgesAtPath, getNodesAtPath,} from '../../collab/stores/diagramStore';
import {useClipboard} from '../../app/hooks/useClipboard';

let failures = 0;

function assert(condition: boolean, message: string) {
    if (condition) {
        console.log(`ok: ${message}`);
    } else {
        failures++;
        console.error(`FAIL: ${message}`);
    }
}

// A localStorage for Node, so the library can be exercised as in a browser.
const storage = new Map<string, string>();
let failWrites = false;
(globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => {
        if (failWrites) throw new Error('QuotaExceededError');
        storage.set(k, v);
    },
    removeItem: (k: string) => void storage.delete(k),
    clear: () => storage.clear(),
    key: () => null,
    get length() {
        return storage.size;
    },
} as Storage;

function data(label: string, extra: Partial<ArchNodeData> = {}): ArchNodeData {
    return {nodeType: 'service', label, properties: {}, tags: [], ...extra};
}

function sampleContents(): DiagramFragmentContents {
    return {
        nodes: [
            {
                id: 'a',
                type: 'typed',
                position: {x: 120, y: 200},
                selected: true,
                data: data('API', {
                    linkedRequirementIds: ['REQ-1'],
                    linkedDocument: {docId: 'doc-x', title: 'X'},
                    locked: true,
                    hasSubDiagram: true,
                    parentPath: ['old'],
                } as Partial<ArchNodeData>),
                relativePath: [],
            },
            {
                id: 'b',
                type: 'typed',
                position: {x: 300, y: 150},
                width: 180,
                height: 60,
                data: data('DB'),
                relativePath: [],
            },
            {
                id: 'inner',
                type: 'typed',
                position: {x: 5, y: 6},
                data: data('Handler'),
                relativePath: ['a'],
            },
        ],
        edges: [
            {
                id: 'e1',
                source: 'a',
                target: 'b',
                data: {
                    edgeType: 'blank-solid',
                    label: 'reads',
                    properties: {},
                    waypoints: [{id: 'w', x: 1, y: 2}],
                    isStepMember: true,
                },
                relativePath: [],
            },
        ],
    };
}

// --- prepareFragmentContents ---
{
    const prepared = prepareFragmentContents(sampleContents());
    const a = prepared.nodes.find((n) => n.id === 'a')!;
    const b = prepared.nodes.find((n) => n.id === 'b')!;
    const inner = prepared.nodes.find((n) => n.id === 'inner')!;
    assert(
        a.position.x === 0 && b.position.y === 0,
        'top-level nodes are moved so the group starts at 0,0',
    );
    assert(b.position.x === 180 && a.position.y === 50, 'relative layout is kept');
    assert(inner.position.x === 5 && inner.position.y === 6, 'nested positions are left alone');
    assert(
        !('linkedRequirementIds' in a.data) && !('linkedDocument' in a.data) && !('locked' in a.data),
        'requirement links, document links and lock state are stripped',
    );
    assert(
        !('hasSubDiagram' in a.data) && !('parentPath' in a.data),
        'computed and level fields are stripped',
    );
    assert(!('selected' in a), 'selection is not saved');
    assert(b.width === 180 && b.height === 60, 'sizes are kept');
    const e = prepared.edges[0];
    assert(
        e.data?.label === 'reads' &&
        !('waypoints' in (e.data ?? {})) &&
        !('isStepMember' in (e.data ?? {})),
        'edge label kept; waypoints and step highlight stripped',
    );
    assert(sampleContents().nodes[0].data.locked === true, 'the input is not mutated');

    const moved = translateFragmentContents(prepared, 500, 400);
    assert(
        moved.nodes.find((n) => n.id === 'a')!.position.x === 500 &&
        moved.nodes.find((n) => n.id === 'inner')!.position.x === 5,
        'translating moves only the top-level nodes',
    );

    assert(suggestFragmentName(prepared) === '3 elements', 'a multi-node fragment is named by size');
    assert(
        suggestFragmentName({nodes: [prepared.nodes[0]], edges: []}) === 'API',
        'a single-node fragment is named after its node',
    );
}

// --- validateFragment ---
{
    const good = {
        id: 'f',
        name: 'x',
        createdAt: 1,
        contents: prepareFragmentContents(sampleContents()),
    };
    assert(validateFragment(good) !== null, 'a well-formed fragment validates');
    assert(validateFragment(null) === null, 'null is rejected');
    assert(
        validateFragment({...good, contents: {nodes: [], edges: []}}) === null,
        'an empty fragment is rejected',
    );
    const dangling = JSON.parse(JSON.stringify(good));
    dangling.contents.edges[0].target = 'nope';
    assert(validateFragment(dangling) === null, 'an edge to a node outside the fragment is rejected');
    const badPos = JSON.parse(JSON.stringify(good));
    badPos.contents.nodes[0].position = {x: 'a', y: 0};
    assert(validateFragment(badPos) === null, 'a malformed position is rejected');
}

// --- the library ---
{
    storage.clear();
    reloadFragments();
    let notified = 0;
    const unsubscribe = subscribeToFragments(() => notified++);
    assert(listFragments().length === 0, 'starts empty');

    const saved = saveFragment('  Auth pair  ', sampleContents());
    assert(saved.ok && saved.fragment.name === 'Auth pair', 'saves with a trimmed name');
    assert(
        listFragments().length === 1 && notified > 0,
        'the list updates and listeners hear about it',
    );
    assert(listFragments() === listFragments(), 'the list is stable between changes');

    reloadFragments();
    assert(listFragments().length === 1, 'fragments survive a reload from storage');
    const id = listFragments()[0].id;

    assert(renameFragment(id, 'Renamed') && getFragment(id)?.name === 'Renamed', 'renames');
    assert(!renameFragment(id, '   '), 'a blank rename is refused');

    const unnamed = saveFragment('', sampleContents());
    assert(unnamed.ok && unnamed.fragment.name === '3 elements', 'a blank name gets a suggested one');

    assert(saveFragment('x', {nodes: [], edges: []}).ok === false, 'nothing to save is refused');

    failWrites = true;
    const refused = saveFragment('quota', sampleContents());
    failWrites = false;
    assert(!refused.ok && refused.reason === 'storage', 'a refused write is reported, not thrown');
    assert(listFragments().length === 2, 'a refused write changes nothing');

    const huge = sampleContents();
    huge.nodes[0].data = data('x'.repeat(MAX_FRAGMENT_BYTES + 10));
    const tooLarge = saveFragment('big', huge);
    assert(!tooLarge.ok && tooLarge.reason === 'too-large', 'an oversized fragment is refused');

    storage.set(
        FRAGMENTS_STORAGE_KEY,
        JSON.stringify([...JSON.parse(storage.get(FRAGMENTS_STORAGE_KEY)!), {junk: true}]),
    );
    reloadFragments();
    assert(listFragments().length === 2, 'invalid stored entries are skipped, valid ones kept');

    assert(deleteFragment(id) && !getFragment(id), 'deletes');
    storage.set(FRAGMENTS_STORAGE_KEY, 'not json');
    reloadFragments();
    assert(listFragments().length === 0, 'unreadable storage reads as empty');
    unsubscribe();
}

// --- end to end: save from one document, insert into another ---
{
    storage.clear();
    reloadFragments();

    const flat = (
        id: string,
        parentPath: string[],
        x: number,
        y: number,
        label: string,
        extra: Partial<Node<ArchNodeData>> = {},
    ): Node<ArchNodeData> => ({
        id,
        type: 'typed',
        position: {x, y},
        data: {...data(label, {linkedRequirementIds: ['REQ-9']}), parentPath} as ArchNodeData,
        ...extra,
    });
    const source = createLocalDiagramStore({
        nodes: [
            flat('svc', [], 100, 100, 'Service'),
            flat('db', [], 400, 160, 'Database'),
            flat('other', [], 900, 900, 'Unrelated'),
            flat('handler', ['svc'], 10, 10, 'Handler'),
            flat('cache', ['svc'], 200, 10, 'Cache'),
        ],
        edges: [
            {
                id: 'e-top',
                source: 'svc',
                target: 'db',
                data: {
                    edgeType: 'blank-solid',
                    label: 'queries',
                    properties: {},
                    parentPath: [],
                } as ArchEdgeData,
            },
            {
                id: 'e-inner',
                source: 'handler',
                target: 'cache',
                data: {
                    edgeType: 'blank-solid',
                    label: '',
                    properties: {},
                    parentPath: ['svc'],
                } as ArchEdgeData,
            },
        ],
    });

    type Handlers = ReturnType<typeof useClipboard>;

    function handlersFor(
        store: ReturnType<typeof createLocalDiagramStore>,
        selected: { nodes: string[]; edges: string[] },
    ): Handlers {
        let captured: Handlers | null = null;
        const snapshot = store.getSnapshot();

        function Probe() {
            captured = useClipboard({
                nodes: getNodesAtPath(snapshot.nodes, []),
                edges: getEdgesAtPath(snapshot.edges, []),
                selectedNodeIds: [],
                diagramStore: store,
                path: [],
                setSelectedNodeIds: (v) => {
                    selected.nodes = typeof v === 'function' ? v(selected.nodes) : v;
                },
                setSelectedEdgeIds: (v) => {
                    selected.edges = typeof v === 'function' ? v(selected.edges) : v;
                },
            });
            return null;
        }

        renderToStaticMarkup(React.createElement(Probe));
        return captured!;
    }

    const sel = {nodes: [] as string[], edges: [] as string[]};
    const result = handlersFor(source, sel).onSaveFragment(['svc', 'db'], 'Service + DB');
    assert(result.ok, 'saving a selection succeeds');
    const fragment = listFragments()[0];
    assert(
        fragment.contents.nodes.length === 4 && fragment.contents.edges.length === 2,
        'the fragment holds the selection, its connection, and the sub-diagram inside it',
    );
    assert(
        !fragment.contents.nodes.some((n) => n.data.label === 'Unrelated'),
        'nodes outside the selection are left out',
    );

    const target = createLocalDiagramStore({
        nodes: [flat('existing', [], 0, 0, 'Existing')],
        edges: [],
    });
    handlersFor(target, sel).onInsertFragment(fragment.id, {x: 1000, y: 2000});
    const after = target.getSnapshot();
    const top = getNodesAtPath(after.nodes, []);
    const svc = top.find((n) => n.data.label === 'Service')!;
    const db = top.find((n) => n.data.label === 'Database')!;
    assert(top.length === 3, 'both top-level nodes land in the target document');
    assert(
        svc.position.x === 1000 &&
        svc.position.y === 2000 &&
        db.position.x === 1300 &&
        db.position.y === 2060,
        'the group lands with its top-left corner at the drop point, layout intact',
    );
    assert(svc.id !== 'svc' && db.id !== 'db', 'inserted nodes get fresh ids');
    assert(
        !('linkedRequirementIds' in svc.data),
        "requirement links from the source document don't follow it",
    );
    const topEdges = getEdgesAtPath(after.edges, []);
    assert(
        topEdges.length === 1 && topEdges[0].source === svc.id && topEdges[0].target === db.id,
        'the connection is rewired to the new nodes',
    );
    const nested = getNodesAtPath(after.nodes, [svc.id]);
    assert(
        nested.length === 2 && getEdgesAtPath(after.edges, [svc.id]).length === 1,
        "the service's sub-diagram comes along, under the new service",
    );
    assert(
        sel.nodes.length === 2 && sel.nodes.includes(svc.id) && sel.edges.includes(topEdges[0].id),
        'the inserted fragment becomes the selection',
    );

    handlersFor(target, sel).onInsertFragment('missing', {x: 0, y: 0});
    assert(
        target.getSnapshot().nodes.length === after.nodes.length,
        'an unknown fragment inserts nothing',
    );
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) {
    (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
}
