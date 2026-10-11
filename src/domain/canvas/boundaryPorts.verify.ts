/**
 * Boundary ports - see boundaryPorts.ts.
 *
 *   npx tsx src/domain/canvas/boundaryPorts.verify.ts
 */
import type {Edge, Node} from '@xyflow/react';
import type {ArchEdgeData, ArchNodeData} from './types';
import {
    buildPortIndex,
    findOrphanedPortEdges,
    isPortOrientationValid,
    orientPortConnection,
    parsePortId,
    portId,
    portsForLevel,
    unwiredPortCounts,
} from './boundaryPorts';

let failures = 0;

function assert(cond: boolean, msg: string) {
    if (!cond) {
        (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
        console.error('FAIL:', msg);
        failures++;
    } else {
        console.log('ok:', msg);
    }
}

function node(id: string, label: string, parentPath: string[] = []): Node<ArchNodeData> {
    return {
        id,
        type: 'typed',
        position: {x: 0, y: 0},
        data: {nodeType: 'microservice', label, properties: {}, tags: [], parentPath},
    };
}

function edge(
    id: string,
    source: string,
    target: string,
    parentPath: string[] = [],
    extra: Partial<ArchEdgeData> = {},
): Edge<ArchEdgeData> {
    return {
        id,
        source,
        target,
        type: 'typed',
        data: {edgeType: 'rest', properties: {}, parentPath, ...extra} as ArchEdgeData,
    };
}

// Root: Web -> Orders -> DB.  Orders' sub-diagram: Handler, Repo.
// Repo's sub-diagram: Pool.
const nodes = [
    node('web', 'Web'),
    node('orders', 'Orders'),
    node('db', 'Orders DB'),
    node('handler', 'Handler', ['orders']),
    node('repo', 'Repo', ['orders']),
    node('pool', 'Pool', ['orders', 'repo']),
];
const baseEdges = [
    edge('e-web', 'web', 'orders', [], {label: 'POST /orders'}),
    edge('e-db', 'orders', 'db', [], {edgeType: 'sql'}),
    edge('e-inner', 'handler', 'repo', ['orders']),
];

// --- ids ---
{
    assert(portId('e-1', 'in') === 'port:e-1:in', 'port ids embed the edge id and side');
    const parsed = parsePortId('port:edge-abc:def:out');
    assert(
        parsed?.edgeId === 'edge-abc:def' && parsed.side === 'out',
        'parsing splits on the LAST colon, so edge ids containing colons survive',
    );
    assert(
        parsePortId('web') === null && parsePortId('port:x:sideways') === null,
        'non-ports parse to null',
    );
}

// --- ports derived from the level above ---
{
    const index = buildPortIndex(nodes, baseEdges);
    const ports = portsForLevel(index, ['orders']);
    assert(ports.length === 2, 'Orders sub-diagram has one port per outer edge touching Orders');
    const [inPort, outPort] = ports;
    assert(
        inPort.side === 'in' && inPort.peerLabel === 'Web' && inPort.connectionLabel === 'POST /orders',
        'inbound port names the caller and the connection label',
    );
    assert(
        outPort.side === 'out' && outPort.peerLabel === 'Orders DB',
        'outbound port names the callee',
    );
    assert(!inPort.bound && !outPort.bound, 'nothing is wired inside yet');
    assert(portsForLevel(index, []).length === 0, 'the root level has no boundary');

    const unwired = unwiredPortCounts(index, []);
    assert(unwired.get('orders') === 2, 'Orders reports both connections as unwired inside');
}

// --- wiring, and propagation to the next level down ---
{
    const edges = [
        ...baseEdges,
        edge('w-in', portId('e-web', 'in'), 'handler', ['orders']),
        edge('w-out', 'repo', portId('e-db', 'out'), ['orders']),
    ];
    const index = buildPortIndex(nodes, edges);
    const ports = portsForLevel(index, ['orders']);
    assert(
        ports.every((p) => p.bound),
        'both ports are bound once wired',
    );
    assert(!unwiredPortCounts(index, []).has('orders'), 'Orders is fully wired');

    const repoPorts = portsForLevel(index, ['orders', 'repo']);
    const dbPort = repoPorts.find((p) => p.edgeId === 'w-out');
    assert(
        dbPort?.side === 'out' && dbPort.peerLabel === 'Orders DB' && dbPort.peerDepth === 2,
        'the wire Repo -> boundary shows up inside Repo as a port to Orders DB, two levels up',
    );
    assert(dbPort?.edgeType === 'sql', "a pass-through port carries the outermost connection's type");
}

// --- orphans ---
{
    const edges = [
        ...baseEdges,
        edge('w-in', portId('e-web', 'in'), 'handler', ['orders']),
        edge('w-deep', 'pool', portId('w-in', 'out'), ['orders', 'repo']), // bogus: w-in doesn't leave repo
    ];
    const index = buildPortIndex(nodes, edges);
    assert(index.isValidEdge('w-in'), 'a correctly attached wire is valid');
    assert(
        !index.isValidEdge('w-deep'),
        "a wire to a port the outer edge doesn't produce is invalid",
    );

    const afterDelete = edges.filter((e) => e.id !== 'e-web');
    const orphans = findOrphanedPortEdges(nodes, afterDelete);
    assert(orphans.includes('w-in'), 'deleting the outer edge orphans the wire from its port');

    // Chain: deleting the outer edge orphans the wire, and the wire's own
    // port one level further down.
    const chain = [
        ...baseEdges,
        edge('w-in', portId('e-web', 'in'), 'repo', ['orders']),
        edge('w-pool', portId('w-in', 'in'), 'pool', ['orders', 'repo']),
    ];
    assert(buildPortIndex(nodes, chain).isValidEdge('w-pool'), 'a two-level chain is valid');
    const chainOrphans = findOrphanedPortEdges(
        nodes,
        chain.filter((e) => e.id !== 'e-web'),
    );
    assert(
        chainOrphans.includes('w-in') && chainOrphans.includes('w-pool'),
        'orphaning cascades down every level',
    );

    const moved = baseEdges.map((e) => (e.id === 'e-web' ? {...e, target: 'db'} : e));
    assert(
        findOrphanedPortEdges(nodes, [
            ...moved,
            edge('w-in', portId('e-web', 'in'), 'handler', ['orders']),
        ]).length === 1,
        'reconnecting the outer edge away from Orders orphans the wire inside Orders',
    );
}

// --- orientation ---
{
    const toIn = orientPortConnection({
        source: 'handler',
        target: portId('e-web', 'in'),
        sourceHandle: 'source-left',
        targetHandle: 'target-right',
    });
    assert(
        toIn?.source === 'port:e-web:in' &&
        toIn.target === 'handler' &&
        toIn.sourceHandle === 'source-right' &&
        toIn.targetHandle === 'target-left',
        'drawing from a node to an inbound port is flipped, handles and all',
    );
    const fromOut = orientPortConnection({source: portId('e-db', 'out'), target: 'repo'});
    assert(
        fromOut?.source === 'repo' && fromOut.target === 'port:e-db:out',
        'drawing from an outbound port is flipped',
    );
    assert(
        orientPortConnection({source: portId('a', 'in'), target: portId('b', 'in')}) === null,
        'two inbound ports cannot be connected',
    );
    assert(
        orientPortConnection({source: portId('a', 'in'), target: portId('b', 'out')})?.source ===
        'port:a:in',
        'an inbound port wired straight to an outbound one is a pass-through, kept as drawn',
    );
    assert(
        orientPortConnection({source: 'a', target: 'b'})?.source === 'a',
        'plain edges untouched',
    );
    assert(
        !isPortOrientationValid({source: 'x', target: portId('e', 'in')}),
        'reconnecting a wire so it points INTO an inbound port is rejected',
    );
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
