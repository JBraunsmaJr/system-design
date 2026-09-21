/**
 * WS1 Step 1 — stores must release the document when they are destroyed.
 *
 * The Yjs stores register observeDeep handlers at construction and previously
 * had no way to remove them. Harmless while a store was built once per
 * session; a leak once the unified model builds one per DOCUMENT, because
 * opening and closing documents would leave live observers on documents still
 * in memory, each rebuilding a full snapshot on every change.
 *
 * Detachment is measured by counting snapshot rebuilds rather than by
 * inspecting Yjs internals: a destroyed store that still rebuilds is leaking,
 * whatever its observer list says.
 */
import * as Y from 'yjs';
import { seedYjsDiagramDoc, createYjsDiagramStore } from './yjsDiagramStore.ts';
import { createYjsRequirementsStore } from './yjsRequirementsStore.ts';
import { createYjsProgramIncrementsStore } from './yjsProgramIncrementsStore.ts';
import { createYjsTeamStore } from './yjsTeamStore.ts';
import { createYjsMilestonesStore } from './yjsMilestonesStore.ts';
import type { SubDiagram } from '../domain/types';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const root = {
  nodes: [
    {
      id: 'n1',
      type: 'typed',
      position: { x: 0, y: 0 },
      data: { nodeType: 'service', label: 'Gateway' },
    },
  ],
  edges: [],
} as unknown as SubDiagram;

console.log('=== A destroyed store stops reacting ===');
{
  const doc = new Y.Doc();
  seedYjsDiagramDoc(doc, root);
  const store = createYjsDiagramStore(doc);

  let notifications = 0;
  store.subscribe(() => notifications++);

  store.updatePosition('n1', { x: 10, y: 10 });
  assert(notifications > 0, 'a live store notifies on change');

  const afterLive = notifications;
  store.destroy();

  // Mutate through a SECOND store so the change genuinely originates
  // elsewhere, as a remote update would.
  const other = createYjsDiagramStore(doc);
  other.updatePosition('n1', { x: 20, y: 20 });

  assert(notifications === afterLive, 'a destroyed store does not react to later changes');
  other.destroy();
}

console.log('=== Destroy is idempotent ===');
{
  const doc = new Y.Doc();
  seedYjsDiagramDoc(doc, root);
  const store = createYjsDiagramStore(doc);
  store.destroy();
  let threw = false;
  try {
    store.destroy();
  } catch {
    threw = true;
  }
  assert(!threw, 'calling destroy twice is safe, so teardown can be defensive');
}

console.log('=== Churn does not accumulate observers ===');
{
  const doc = new Y.Doc();
  seedYjsDiagramDoc(doc, root);

  // The unified model's pattern: open a document, work in it, close it.
  // Every closed store keeps a subscriber attached, so a store that failed to
  // detach reports itself here rather than hiding behind a survivor's count.
  let notificationsFromClosedStores = 0;
  for (let i = 0; i < 50; i++) {
    const store = createYjsDiagramStore(doc);
    store.subscribe(() => notificationsFromClosedStores++);
    store.updatePosition('n1', { x: i, y: i });
    store.destroy();
  }
  const duringLifetimes = notificationsFromClosedStores;

  const survivor = createYjsDiagramStore(doc);
  let survivorNotifications = 0;
  survivor.subscribe(() => survivorNotifications++);
  survivor.updatePosition('n1', { x: 999, y: 999 });

  assert(
    notificationsFromClosedStores === duringLifetimes,
    `no closed store reacted to a later change (${notificationsFromClosedStores - duringLifetimes} did)`,
  );
  assert(
    survivorNotifications === 1,
    `the live store notified exactly once (got ${survivorNotifications})`,
  );
  survivor.destroy();
}

console.log('=== Every store implements the seam ===');
{
  const doc = new Y.Doc();
  const stores = [
    ['diagram', createYjsDiagramStore(doc)],
    ['requirements', createYjsRequirementsStore(doc)],
    ['programIncrements', createYjsProgramIncrementsStore(doc)],
    ['team', createYjsTeamStore(doc)],
    ['milestones', createYjsMilestonesStore(doc)],
  ] as const;

  for (const [name, store] of stores) {
    assert(
      typeof (store as { destroy?: unknown }).destroy === 'function',
      `${name} store exposes destroy`,
    );
  }
  for (const [, store] of stores) store.destroy();
  assert(true, 'and all of them tear down without throwing');
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  throw new Error(`${failures} store lifecycle check(s) failed`);
}
console.log('\nAll store lifecycle checks passed.');

console.log('=== replaceAll swaps the whole diagram (WS1 Step 3) ===');
{
  const doc = new Y.Doc();
  seedYjsDiagramDoc(doc, root);
  const store = createYjsDiagramStore(doc);

  // What matters is not how many times subscribers are told, but whether any
  // of them can observe the intermediate empty state. Inside one transaction
  // observers run after it commits, so the blank canvas should never be
  // visible - which is the property worth pinning.
  const observedCounts: number[] = [];
  store.subscribe(() => observedCounts.push(store.getSnapshot().nodes.length));

  const replacement = {
    nodes: [
      {
        id: 'replacement',
        type: 'typed',
        position: { x: 5, y: 5 },
        data: { nodeType: 'database', label: 'Replacement' },
      },
    ],
    edges: [],
  } as unknown as SubDiagram;

  store.replaceAll(replacement);

  const snapshot = store.getSnapshot();
  assert(
    snapshot.nodes.length === 1 && snapshot.nodes[0].id === 'replacement',
    'the previous contents are gone, not merged with the new ones',
  );
  assert(
    observedCounts.length > 0 && observedCounts.every((n) => n > 0),
    `no subscriber ever observed the empty intermediate state (saw ${JSON.stringify(observedCounts)})`,
  );
  store.destroy();
}
