/**
 * The Inspector with more than one thing selected, and the edge panel's
 * thickness and routing fields.
 *
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/canvas/MultiSelectionInspector.verify.tsx
 */
import {renderToStaticMarkup} from 'react-dom/server';
import type {Edge, Node} from '@xyflow/react';
import {Inspector} from './Inspector';
import type {MultiSelectionActions} from './MultiSelectionInspector';
import type {ArchEdgeData, ArchNodeData} from '../../domain/canvas/types';
import {EMPTY_REQUIREMENTS_DOCUMENT} from '../../domain/requirements/requirementsTypes';

let failures = 0;

function assert(condition: boolean, message: string) {
    if (condition) {
        console.log(`ok: ${message}`);
    } else {
        failures++;
        console.error(`FAIL: ${message}`);
    }
}

const noop = () => {
};
const actions: MultiSelectionActions = {
    onUpdateNodes: noop,
    onUpdateEdges: noop,
    onSetLocked: noop,
    onGroup: noop,
    onUngroup: noop,
    onDeleteSelection: noop,
    onArrange: noop,
};

function node(id: string, data: Partial<ArchNodeData> = {}, type = 'typed'): Node<ArchNodeData> {
    return {
        id,
        type,
        position: {x: 0, y: 0},
        data: {nodeType: 'microservice', label: id, properties: {}, tags: [], ...data},
    };
}

function edge(id: string, data: Partial<ArchEdgeData> = {}): Edge<ArchEdgeData> {
    return {id, source: 'a', target: 'b', data: {edgeType: 'http', properties: {}, ...data}};
}

function render(props: {
    nodes?: Node<ArchNodeData>[];
    edges?: Edge<ArchEdgeData>[];
    multi?: boolean;
}) {
    const nodes = props.nodes ?? [];
    const edges = props.edges ?? [];
    return renderToStaticMarkup(
        <Inspector
            selectedNode={nodes[0] ?? null}
            selectedEdge={edges[0] ?? null}
            onUpdateNode={noop}
            onUpdateEdge={noop}
            onClearEdgeWaypoints={noop}
            onRemoveEdgeWaypoint={noop}
            onDeleteNode={noop}
            onDeleteEdge={noop}
            onDrillInto={noop}
            requirements={EMPTY_REQUIREMENTS_DOCUMENT}
            onNavigateToRequirement={noop}
            onZOrderCommand={noop}
            selectedNodes={nodes}
            selectedEdges={edges}
            multiSelection={props.multi === false ? undefined : actions}
        />,
    );
}

// 1. Several nodes and an edge: one panel for all of them.
{
    const html = render({
        nodes: [node('a', {color: '#ff0000', tags: ['x', 'y']}), node('b', {tags: ['x']})],
        edges: [edge('e1', {strokeWidth: 5, routing: 'curved'})],
    });
    assert(html.includes('3 selected'), 'header counts the whole selection');
    assert(html.includes('2 nodes · 1 edge'), 'summary splits nodes and edges');
    assert(html.includes('>Mixed<'), 'disagreeing colors show as Mixed');
    assert(html.includes('Reset'), 'Reset is offered when any node has a color override');
    assert(html.includes('>x<') && !html.includes('>y<'), 'only tags on every node are listed');
    assert(html.includes('+1 tag on only some of them'), 'tags on some nodes are counted');
    assert(html.includes('Thickness') && html.includes('Heavy (5px)'), 'edge thickness field');
    assert(
        /aria-checked="true"[^>]*>Curved</.test(html),
        'the edge routing control marks the current routing',
    );
    assert(html.includes('Delete 3 items'), 'one delete for the whole selection');
    assert(!html.includes('Description'), 'per-item text fields are not offered');
}

// 1b. Align / distribute / match size: enabled by what the selection allows.
{
    const two = render({nodes: [node('a'), node('b')]});
    assert(two.includes('aria-label="Align left"'), 'align controls are offered');
    assert(
        /<button[^>]*disabled=""[^>]*aria-label="Distribute horizontally/.test(two) ||
        /aria-label="Distribute horizontally[^"]*"[^>]*disabled=""/.test(two),
        'distribute needs three nodes',
    );
    assert(
        /aria-label="Match width[^"]*"[^>]*disabled=""/.test(two) ||
        /disabled=""[^>]*aria-label="Match width/.test(two),
        'matching size needs a resizable node - two component nodes have none',
    );
    const shapes = render({
        nodes: [node('s1', {}, 'shape'), node('s2', {}, 'shape'), node('s3', {}, 'shape')],
    });
    assert(
        !/aria-label="Distribute horizontally[^"]*"[^>]*disabled=""/.test(shapes) &&
        !/disabled=""[^>]*aria-label="Distribute horizontally/.test(shapes),
        'three nodes can be distributed',
    );
    const oneNode = render({nodes: [node('a')], edges: [edge('e1')]});
    assert(!oneNode.includes('aria-label="Align left"'), 'no align controls for a single node');
}

// 2. Nodes only, all of one kind: the type can be changed for all of them.
{
    const html = render({nodes: [node('a'), node('b', {nodeType: 'database'})]});
    assert(html.includes('>Type<'), 'all-typed selection offers a type field');
    assert(!html.includes('Edges'), 'no edge section without edges');
    const groups = render({
        nodes: [node('g1', {nodeType: 'vpc'}, 'group'), node('g2', {nodeType: 'vpc'}, 'group')],
    });
    assert(groups.includes('Boundary kind'), 'all-boundary selection offers the boundary kind');
    assert(groups.includes('Ungroup'), 'boundaries can be ungrouped from the Inspector');
    const mixedKinds = render({nodes: [node('a'), node('t', {}, 'text')]});
    assert(!mixedKinds.includes('>Type<'), 'no type field across different kinds of node');
    assert(!mixedKinds.includes('>Icon<'), 'no icon field when a node has no icon');
}

// 3. Locks: a mix shows as indeterminate, and the delete hint says what stays.
{
    const html = render({nodes: [node('a', {locked: true}), node('b')]});
    assert(html.includes('Locked'), 'lock toggle is offered');
    assert(html.includes('1 locked node will be kept'), 'delete explains locked nodes are kept');
}

// 4. Without the multi-selection actions, the Inspector behaves as before.
{
    const html = render({nodes: [node('a'), node('b')], multi: false});
    assert(!html.includes('2 selected'), 'falls back to the single-item panel');
}

// 5. Single edge: thickness and routing next to color.
{
    const html = render({edges: [edge('e1')]});
    assert(html.includes('<div class="panel-header">Edge</div>'), 'single edge panel');
    assert(html.includes('Normal (1.75px)'), 'thickness defaults to Normal');
    assert(/aria-checked="true"[^>]*>Orthogonal</.test(html), 'routing defaults to orthogonal');
}

// 6. Single locked node: delete is disabled.
{
    const html = render({nodes: [node('a', {locked: true})]});
    assert(/<button[^>]*disabled=""[^>]*>Delete node/.test(html), 'a locked node cannot be deleted');
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) {
    (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
}
