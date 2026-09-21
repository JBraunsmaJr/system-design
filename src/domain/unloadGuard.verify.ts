/**
 * WS13-R7 (unload guard) and WS13-R10 (replica count).
 *
 * Both exist to make the peer-to-peer durability story honest. The replica
 * count is what the leave guard reads; the unload guard is the backstop for
 * everything the leave guard cannot see, such as a tab being closed outright.
 */
import { installUnloadGuard, shouldBlockUnload, type UnloadTarget } from './unloadGuard.ts';
import { countPersistedReplicas } from '../collab/session.ts';
import type { PresenceInfo } from '../collab/session.ts';
import type { DurabilitySignals } from './durability.ts';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const safe: DurabilitySignals = { localPersistence: 'active' };

console.log('=== The guard stays quiet when nothing is at risk ===');
{
  assert(!shouldBlockUnload(safe), 'a document at rest in browser storage does not prompt');
  assert(
    shouldBlockUnload({
      ...safe,
      fileAccess: 'available',
      fileAttachment: { fileName: 'a.json', status: 'conflict' },
    }),
    'an unresolved file conflict prompts: the chosen file is behind (WS13-R4)',
  );
  assert(
    !shouldBlockUnload({
      ...safe,
      fileAccess: 'available',
      fileAttachment: { fileName: 'a.json', status: 'needs-permission' },
    }),
    'a paused file does not prompt: every change is still saved in the browser',
  );
  assert(
    !shouldBlockUnload({ ...safe, fileBacked: true }),
    'a file-backed document does not prompt',
  );
  assert(
    !shouldBlockUnload({ ...safe, serverSync: 'synced' }),
    'a synced document does not prompt',
  );
  assert(
    !shouldBlockUnload({ localPersistence: 'loading' }),
    'loading does not prompt - the state is unknown, but nothing has been typed yet',
  );
  assert(
    !shouldBlockUnload({ ...safe, serverSync: 'offline', pendingUpdates: 12 }),
    'a queued offline backlog does not prompt while the local replica holds it',
  );
}

console.log('=== It prompts when closing would actually lose work ===');
{
  assert(
    shouldBlockUnload({
      ...safe,
      storageFailure: { reason: 'quota', message: 'full' },
    }),
    'a storage failure prompts',
  );
  assert(
    shouldBlockUnload({ ...safe, autosaveBlockedReason: 'newer version' }),
    'a paused autosave prompts',
  );
  assert(
    shouldBlockUnload({ localPersistence: 'unavailable' }),
    'storage being unavailable prompts - nothing is being written at all',
  );
  assert(
    shouldBlockUnload({
      localPersistence: 'unavailable',
      serverSync: 'offline',
      pendingUpdates: 3,
    }),
    'a queue with no local replica behind it prompts',
  );
}

console.log('=== Installation and release ===');
{
  const listeners = new Set<(e: { preventDefault: () => void; returnValue?: unknown }) => void>();
  const target: UnloadTarget = {
    addEventListener: (_t, l) => listeners.add(l),
    removeEventListener: (_t, l) => listeners.delete(l),
  };

  let signals: DurabilitySignals = safe;
  const guard = installUnloadGuard(() => signals, target);
  assert(listeners.size === 1, 'installing registers one listener');

  const fire = () => {
    let prevented = false;
    for (const l of listeners) {
      l({ preventDefault: () => (prevented = true) });
    }
    return prevented;
  };

  assert(!fire(), 'with nothing at risk, closing is not blocked');

  // The decision must be read at unload time, not captured at install time.
  signals = { ...safe, storageFailure: { reason: 'quota', message: 'full' } };
  assert(
    fire(),
    'a failure that appeared AFTER installation still blocks - the signals are read live',
  );

  guard.release();
  assert(listeners.size === 0, 'releasing removes the listener');
  guard.release();
  assert(listeners.size === 0, 'releasing twice is harmless');
}

console.log('=== A target without events degrades quietly ===');
{
  const guard = installUnloadGuard(() => safe, undefined as unknown as UnloadTarget);
  guard.release();
  assert(true, 'installing against no target neither throws nor leaks');
}

console.log('=== Replica count (WS13-R10) ===');
{
  const peer = (clientId: number, hasPersistedReplica: boolean): PresenceInfo =>
    ({
      clientId,
      name: `Peer ${clientId}`,
      color: '#fff',
      cursor: null,
      selectedNodeIds: [],
      selectedEdgeIds: [],
      viewMode: null,
      focusedItemId: null,
      diagramPath: '',
      hasPersistedReplica,
    }) as PresenceInfo;

  assert(countPersistedReplicas([], true) === 1, 'alone with a replica counts one');
  assert(countPersistedReplicas([], false) === 0, 'alone without storage counts none');
  assert(
    countPersistedReplicas([peer(1, true), peer(2, true)], true) === 3,
    "own replica is included alongside peers'",
  );
  assert(
    countPersistedReplicas([peer(1, false), peer(2, false)], true) === 1,
    'connected peers whose storage was refused are NOT counted - this is the ' +
      'whole point, since counting connections would tell the last holder ' +
      'their work is duplicated when it is not',
  );
  assert(
    countPersistedReplicas([peer(1, true)], false) === 1,
    "a peer's replica counts even when this browser has none",
  );
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  throw new Error(`${failures} unload guard check(s) failed`);
}
console.log('\nAll unload guard and replica count checks passed.');
