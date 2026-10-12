/**
 * The fields added for multi-select editing - a node's `locked`, an edge's
 * `strokeWidth` and `routing` - survive both diagram stores, so they reach
 * peers and saved files rather than living only in the local view.
 *
 * Run with: npx tsx --tsconfig tsconfig.app.json src/collab/stores/editingFields.verify.ts
 */
import * as Y from 'yjs';
import {createLocalDiagramStore, type DiagramStore} from './diagramStore';
import {createYjsDiagramStore} from './yjsDiagramStore';

let failures = 0;

function assert(condition: boolean, message: string) {
    if (condition) {
        console.log(`ok: ${message}`);
    } else {
        failures++;
        console.error(`FAIL: ${message}`);
    }
}

function exercise(name: string, store: DiagramStore) {
    const a = store.addNode(
        [],
        'typed',
        {x: 0, y: 0},
        {
            nodeType: 'microservice',
            label: 'A',
            properties: {},
            tags: [],
        },
    );
    const b = store.addNode(
        [],
        'typed',
        {x: 300, y: 0},
        {
            nodeType: 'database',
            label: 'B',
            properties: {},
            tags: [],
        },
    );
    const e = store.addEdge([], a, b, {edgeType: 'http', properties: {}});

    store.updateNode(a, {locked: true});
    store.updateEdge(e, {strokeWidth: 3.5, routing: 'curved'});
    let snap = store.getSnapshot();
    assert(snap.nodes.find((n) => n.id === a)?.data.locked === true, `${name}: node lock is stored`);
    const edge = snap.edges.find((x) => x.id === e)!;
    assert(edge.data?.strokeWidth === 3.5, `${name}: edge thickness is stored`);
    assert(edge.data?.routing === 'curved', `${name}: edge routing is stored`);

    store.updateNode(a, {locked: undefined});
    store.updateEdge(e, {strokeWidth: undefined, routing: undefined});
    snap = store.getSnapshot();
    assert(!snap.nodes.find((n) => n.id === a)?.data.locked, `${name}: node unlocks`);
    const cleared = snap.edges.find((x) => x.id === e)!;
    assert(
        cleared.data?.strokeWidth === undefined && cleared.data?.routing === undefined,
        `${name}: edge thickness and routing reset to defaults`,
    );
}

exercise('local', createLocalDiagramStore());
exercise('yjs', createYjsDiagramStore(new Y.Doc()));

// Through a second peer: what one writes, the other reads.
{
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    docA.on('update', (u: Uint8Array) => Y.applyUpdate(docB, u));
    const storeA = createYjsDiagramStore(docA);
    const storeB = createYjsDiagramStore(docB);
    const n = storeA.addNode(
        [],
        'typed',
        {x: 0, y: 0},
        {
            nodeType: 'microservice',
            label: 'A',
            properties: {},
            tags: [],
        },
    );
    const m = storeA.addNode(
        [],
        'typed',
        {x: 0, y: 0},
        {
            nodeType: 'microservice',
            label: 'B',
            properties: {},
            tags: [],
        },
    );
    const e = storeA.addEdge([], n, m, {edgeType: 'http', properties: {}});
    storeA.updateNode(n, {locked: true});
    storeA.updateEdge(e, {strokeWidth: 5, routing: 'straight'});
    const seen = storeB.getSnapshot();
    assert(seen.nodes.find((x) => x.id === n)?.data.locked === true, 'peer: sees the lock');
    const edge = seen.edges.find((x) => x.id === e)!;
    assert(
        edge.data?.strokeWidth === 5 && edge.data?.routing === 'straight',
        'peer: sees thickness and routing',
    );
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) {
    (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
}
