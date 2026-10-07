/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/srd/srdSnapshotPlan.verify.ts
 */
import type {Edge, Node} from '@xyflow/react';
import {planSrdSnapshots, primaryLinkedNodes} from './srdSnapshotPlan';
import {SnapshotCache} from './srdSnapshotCache';
import {SRD_DIAGRAM_FRAMING_KEY} from './srdSettings';
import type {SrdSnapshotFraming} from './srdTypes';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

const node = (id: string, parentPath: string[], linked: string[] = [], x = 0): Node => ({
  id,
  position: { x, y: 0 },
  data: { label: id, parentPath, linkedRequirementIds: linked },
});
const edge = (id: string, source: string, target: string, parentPath: string[]): Edge => ({
  id,
  source,
  target,
  data: { parentPath },
});

const nodes = [
  node('gw', [], ['REQ-1']),
  node('db', [], []),
  node('auth', [], ['REQ-2']),
  node('inner-a', ['auth'], ['REQ-2']),
  node('inner-b', ['auth'], ['REQ-2']),
];
const edges = [edge('e1', 'gw', 'db', []), edge('e2', 'inner-a', 'inner-b', ['auth'])];
const noFraming = { framing: {} as Record<string, SrdSnapshotFraming> };

console.log('=== 1. Planning ===');
{
  const targets = planSrdSnapshots({
    nodes,
    edges,
    itemIds: ['REQ-1', 'REQ-2', 'REQ-3'],
    state: noFraming,
  });
  assert(
    targets.map((t) => t.key).join() === `${SRD_DIAGRAM_FRAMING_KEY},REQ-1,REQ-2`,
    'one diagram target, then linked items in order',
  );
  const req2 = targets.find((t) => t.key === 'REQ-2')!;
  assert(
    JSON.stringify(req2.path) === '["auth"]',
    'an item is shown at the level holding most of its nodes',
  );
  assert(req2.nodeIds.join() === 'inner-a,inner-b', 'only the nodes at that level are framed');

  const primary = primaryLinkedNodes([node('a', ['x'], ['R']), node('b', ['y'], ['R'])]);
  assert(JSON.stringify(primary.get('R')?.path) === '["x"]', 'a tie goes to the level met first');

  const hidden = planSrdSnapshots({
    nodes,
    edges,
    itemIds: ['REQ-1'],
    state: {
      framing: {
        'REQ-1': { offsetX: 0, offsetY: 0, zoom: 1, hidden: true },
        [SRD_DIAGRAM_FRAMING_KEY]: { offsetX: 0, offsetY: 0, zoom: 1, hidden: true },
      },
    },
  });
  assert(hidden.length === 0, 'removed snapshots are not planned');

  assert(
    planSrdSnapshots({ nodes: [], edges: [], itemIds: [], state: noFraming }).length === 0,
    'an empty diagram needs no snapshots',
  );
}

console.log('=== 2. Fingerprints change exactly when the rendering would ===');
{
  const plan = (n: Node[], e: Edge[], framing = noFraming) =>
    new Map(
      planSrdSnapshots({ nodes: n, edges: e, itemIds: ['REQ-1', 'REQ-2'], state: framing }).map(
        (t) => [t.key, t.fingerprint],
      ),
    );
  const base = plan(nodes, edges);
  const again = plan(structuredClone(nodes), structuredClone(edges));
  assert(
    [...base].every(([k, v]) => again.get(k) === v),
    'identical content gives identical fingerprints',
  );

  const movedRoot = plan(
    nodes.map((n) => (n.id === 'db' ? { ...n, position: { x: 99, y: 0 } } : n)),
    edges,
  );
  assert(movedRoot.get('REQ-1') !== base.get('REQ-1'), 'editing a level changes its snapshots');
  assert(
    movedRoot.get(SRD_DIAGRAM_FRAMING_KEY) !== base.get(SRD_DIAGRAM_FRAMING_KEY),
    'editing the root changes the diagram snapshot',
  );
  assert(movedRoot.get('REQ-2') === base.get('REQ-2'), 'other levels are unaffected');

  const reframed = plan(nodes, edges, {
    framing: { 'REQ-1': { offsetX: 10, offsetY: 0, zoom: 1 } },
  });
  assert(reframed.get('REQ-1') !== base.get('REQ-1'), 'reframing changes that snapshot');
  assert(reframed.get('REQ-2') === base.get('REQ-2'), 'reframing leaves others alone');
}

console.log('=== 3. Cache ===');
{
  const cache = new SnapshotCache(10);
  cache.set('a', 'aaaa');
  cache.set('b', 'bbbb');
  cache.get('a'); // a is now most recently used
  cache.set('c', 'cccc');
  assert(cache.has('a') && cache.has('c') && !cache.has('b'), 'the least recently used is evicted');
  assert(cache.totalChars === 8, 'size is tracked');
  cache.set('huge', 'x'.repeat(11));
  assert(
    !cache.has('huge') && cache.has('a'),
    'an oversized image is not cached and evicts nothing',
  );
  cache.set('a', 'aa');
  assert(cache.totalChars === 6, 'replacing an entry updates the size');
  cache.delete('c');
  assert(cache.totalChars === 2 && !cache.has('c'), 'deleting frees its size');
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
