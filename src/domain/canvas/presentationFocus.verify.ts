/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/canvas/presentationFocus.verify.ts
 */
import type {Edge, Node} from '@xyflow/react';
import {
    applyPresentationFocusToEdges,
    applyPresentationFocusToNodes,
    DIMMED_EDGE_OPACITY,
    DIMMED_NODE_OPACITY,
} from './presentationFocus';

let failures = 0;

function assert(condition: boolean, message: string) {
    if (condition) console.log(`ok: ${message}`);
    else {
        failures++;
        (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
        console.error(`FAIL: ${message}`);
    }
}

const nodes: Node[] = [
    {id: 'a', position: {x: 0, y: 0}, data: {}, style: {width: 100}},
    {id: 'b', position: {x: 0, y: 0}, data: {}, className: 'old'},
];
const edges: Edge[] = [
    {id: 'e1', source: 'a', target: 'b', style: {stroke: 'red'}},
    {id: 'e2', source: 'b', target: 'a'},
];
const focus = {nodeIds: ['a'], edgeIds: ['e1']};

const outNodes = applyPresentationFocusToNodes(nodes, focus);
assert(outNodes[0].className === 'is-presentation-focus', 'focused nodes get the glow class');
assert(outNodes[0].style?.opacity === 1, 'focused nodes are fully opaque');
assert(outNodes[0].style?.width === 100, "a node's own style is kept");
assert(outNodes[1].className === undefined, 'other nodes lose any focus class');
assert(outNodes[1].style?.opacity === DIMMED_NODE_OPACITY, 'other nodes are dimmed');
assert(nodes[0].style?.opacity === undefined, 'the input is not mutated');

const live = applyPresentationFocusToEdges(edges, focus, {animateEdges: true});
assert(
    live[0].animated === true && live[1].animated === false,
    'presenting animates focused edges',
);
assert(live[0].style?.opacity === 1, 'focused edges are fully opaque (TypedEdge thickens them)');
assert(live[1].style?.opacity === DIMMED_EDGE_OPACITY, 'other edges are dimmed');
assert(live[0].style?.stroke === 'red', "an edge's own style is kept");

const still = applyPresentationFocusToEdges(edges, focus, {animateEdges: false});
assert(
    still.every((e) => e.animated === false) && still[0].style?.opacity === 1,
    'exports keep the focus but not the animation, which a still image would freeze mid-dash',
);

if (failures > 0) console.error(`\n${failures} check(s) failed`);
else console.log('All presentation focus tests passed.\n');
