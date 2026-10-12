/**
 * Verification for copy/paste style (styleClipboard.ts).
 *
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/canvas/styleClipboard.verify.ts
 */
import type {Edge, Node} from '@xyflow/react';
import {describeStyle, edgeStylePatch, nodeStylePatch, styleFromEdge, styleFromNode,} from './styleClipboard';
import type {ArchEdgeData, ArchNodeData} from './types';

let failures = 0;

function assert(condition: boolean, message: string) {
    if (condition) {
        console.log(`ok: ${message}`);
    } else {
        failures++;
        console.error(`FAIL: ${message}`);
    }
}

function node(type: string, data: Partial<ArchNodeData> = {}): Node<ArchNodeData> {
    return {
        id: `${type}-1`,
        type,
        position: {x: 0, y: 0},
        data: {nodeType: 'microservice', label: '', properties: {}, tags: [], ...data},
    };
}

function edge(data: Partial<ArchEdgeData> = {}): Edge<ArchEdgeData> {
    return {
        id: 'e1',
        source: 'a',
        target: 'b',
        data: {edgeType: 'http', properties: {}, ...data},
    };
}

// Node -> node
{
    const style = styleFromNode(node('typed', {color: '#ff0000', icon: 'Server'}));
    const patch = nodeStylePatch(style, node('typed', {color: '#00ff00'}));
    assert(patch.color === '#ff0000', 'pastes color onto a typed node');
    assert(patch.icon === 'Server', 'pastes icon onto a typed node');

    const onText = nodeStylePatch(style, node('text'));
    assert(
        onText.textColor === '#ff0000' && onText.color === '#ff0000',
        'text nodes get textColor too',
    );
    assert(!('icon' in onText), 'text nodes have no icon to paste onto');
}

// "Default" is a style too: pasting a node with no overrides clears them.
{
    const style = styleFromNode(node('typed'));
    const patch = nodeStylePatch(style, node('typed', {color: '#123456', icon: 'Box'}));
    assert(
        'color' in patch && patch.color === undefined,
        'no color override clears the target override',
    );
    assert(
        'icon' in patch && patch.icon === undefined,
        'no icon override clears the target override',
    );
}

// Text node as the source reads its visible color.
{
    const style = styleFromNode(node('text', {textColor: '#abcdef', fontSize: 28}));
    assert(style.color === '#abcdef', 'a text node copies its textColor');
    const onShape = nodeStylePatch(style, node('shape'));
    assert(onShape.fontSize === 28, 'text size pastes from text onto a shape');
    const onTyped = nodeStylePatch(style, node('typed'));
    assert(!('fontSize' in onTyped), "text size doesn't paste onto a node without text sizing");
    assert(!('icon' in onTyped), "a source with no icon slot leaves the target's icon alone");
}

// Edge -> edge, and across kinds.
{
    const style = styleFromEdge(edge({color: '#ff00ff', strokeWidth: 3.5, routing: 'curved'}));
    const patch = edgeStylePatch(style);
    assert(
        patch.color === '#ff00ff' && patch.strokeWidth === 3.5 && patch.routing === 'curved',
        'edge style carries color, thickness and routing',
    );
    const onNode = nodeStylePatch(style, node('typed', {icon: 'Box'}));
    assert(onNode.color === '#ff00ff' && !('icon' in onNode), 'edge style onto a node is color only');
    const fromNode = edgeStylePatch(styleFromNode(node('typed', {color: '#111111'})));
    assert(
        fromNode.color === '#111111' && !('strokeWidth' in fromNode) && !('routing' in fromNode),
        'node style onto an edge is color only',
    );
    assert(describeStyle(style) === 'color, thickness, routing', 'describes an edge style');
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) {
    (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
}
