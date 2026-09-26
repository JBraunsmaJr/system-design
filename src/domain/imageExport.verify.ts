/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/imageExport.verify.ts
 */
import type { Node } from '@xyflow/react';
import { calculateNodesAbsoluteBounds } from './imageExport';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
    console.error(`FAIL: ${message}`);
  }
}

console.log('Testing Image Export & Absolute Bounding Box Calculations...');

// Test 1: Empty node array
const emptyBounds = calculateNodesAbsoluteBounds([], []);
assert(
  emptyBounds.x === 0 && emptyBounds.y === 0 && emptyBounds.width === 0 && emptyBounds.height === 0,
  'empty node list returns zero bounds',
);

// Test 2: Root standalone nodes
const rootNodes: Node[] = [
  {
    id: 'node-1',
    type: 'service',
    position: { x: 100, y: 200 },
    width: 180,
    height: 80,
    data: { label: 'Service A' },
  },
  {
    id: 'node-2',
    type: 'database',
    position: { x: 400, y: 350 },
    width: 160,
    height: 90,
    data: { label: 'DB 1' },
  },
];

const rootBounds = calculateNodesAbsoluteBounds(rootNodes, rootNodes);
assert(rootBounds.x === 100, 'root bounds minX matches 100');
assert(rootBounds.y === 200, 'root bounds minY matches 200');
assert(rootBounds.width === 460, 'root bounds width matches 460 (400+160-100)');
assert(rootBounds.height === 240, 'root bounds height matches 240 (350+90-200)');

// Test 3: Nested child nodes inside group
const allNodes: Node[] = [
  {
    id: 'group-1',
    type: 'group',
    position: { x: 500, y: 300 },
    width: 400,
    height: 300,
    data: { label: 'Backend Cluster' },
  },
  {
    id: 'child-1',
    parentId: 'group-1',
    type: 'service',
    position: { x: 40, y: 60 }, // Relative: absolute is 540, 360
    width: 150,
    height: 70,
    data: { label: 'API Worker' },
  },
  {
    id: 'child-2',
    parentId: 'group-1',
    type: 'cache',
    position: { x: 220, y: 180 }, // Relative: absolute is 720, 480
    width: 120,
    height: 60,
    data: { label: 'Redis' },
  },
];

const childNodes = allNodes.filter((n) => n.id.startsWith('child'));
const childBounds = calculateNodesAbsoluteBounds(childNodes, allNodes);
assert(childBounds.x === 540, 'nested child absolute x resolves to 540 (500+40)');
assert(childBounds.y === 360, 'nested child absolute y resolves to 360 (300+60)');
assert(childBounds.width === 300, 'nested children width spans 300 (720+120-540)');
assert(childBounds.height === 180, 'nested children height spans 180 (480+60-360)');

// Test 4: Fallback dimensions for group container
const groupNode: Node = {
  id: 'group-main',
  type: 'group',
  position: { x: 200, y: 150 },
  data: { label: 'Auth Subsystem' },
};

const groupBounds = calculateNodesAbsoluteBounds([groupNode], [groupNode]);
assert(groupBounds.x === 200, 'fallback group minX matches 200');
assert(groupBounds.y === 150, 'fallback group minY matches 150');
assert(groupBounds.width === 320, 'fallback group width defaults to 320');
assert(groupBounds.height === 220, 'fallback group height defaults to 220');

if (failures === 0) {
  console.log('All image export bounds tests passed!');
} else {
  console.error(`${failures} test(s) failed`);
  (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
}
