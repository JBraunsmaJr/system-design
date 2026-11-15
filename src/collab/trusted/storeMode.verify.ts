/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/collab/trusted/storeMode.verify.ts
 */
import {
  getStoreMode,
  probeStoreMode,
  resetStoreModeForTests,
  resolveStoreMode,
} from './storeMode';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1; // run-tests.ts reads the exit status
    console.error(`FAIL: ${message}`);
  }
}

const STORE = 'https://store.example';
const entries = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => entries.get(key) ?? null,
  setItem: (key: string, value: string) => void entries.set(key, value),
  removeItem: (key: string) => void entries.delete(key),
  clear: () => entries.clear(),
  key: () => null,
  length: 0,
} as Storage;

const answering = (status: number, body: unknown = {}) => {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetcher, calls };
};
const failing = (async () => {
  throw new Error('network down');
}) as typeof fetch;
const hanging = ((_input: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  })) as typeof fetch;
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

// === Asking the store ===
{
  const trusted = answering(200, { status: 'ok', mode: 'trusted' });
  assert(
    (await probeStoreMode(`${STORE}/`, { fetch: trusted.fetcher })) === 'trusted',
    'a store that answers /v2/health in trusted mode is trusted',
  );
  assert(
    trusted.calls[0] === `${STORE}/v2/health`,
    'the store address is used without its trailing slash',
  );
  assert(
    (await probeStoreMode(STORE, { fetch: answering(404).fetcher })) === 'legacy',
    'a store with no /v2 is legacy',
  );
  assert(
    (await probeStoreMode(STORE, { fetch: answering(200, { status: 'ok' }).fetcher })) === 'legacy',
    'an answer that does not say trusted is legacy',
  );
  assert(
    (await probeStoreMode(STORE, { fetch: answering(503).fetcher })) === null,
    'a store that is failing says nothing about what it is',
  );
  assert(
    (await probeStoreMode(STORE, { fetch: failing })) === null,
    'nor does one that cannot be reached',
  );
  assert(
    (await probeStoreMode(STORE, { fetch: hanging, timeoutMs: 10 })) === null,
    'nor one that does not answer in time',
  );
}

// === Resolving for a visit ===
{
  resetStoreModeForTests();
  assert(getStoreMode(null) === 'none', 'no store configured is none');
  assert(
    getStoreMode(STORE) === 'legacy',
    'before resolving, a configured store is taken to be legacy',
  );
  assert((await resolveStoreMode(null)) === 'none', 'resolving with no store asks nothing');

  // First visit: asks, and remembers.
  entries.clear();
  resetStoreModeForTests();
  const first = answering(200, { mode: 'trusted' });
  assert(
    (await resolveStoreMode(STORE, { fetch: first.fetcher })) === 'trusted' &&
      getStoreMode(STORE) === 'trusted',
    'a first visit asks the store and uses its answer',
  );
  assert(first.calls.length === 1, 'with one request');

  // Later visit: the remembered answer, without waiting.
  resetStoreModeForTests();
  assert(
    (await resolveStoreMode(STORE, { fetch: hanging, timeoutMs: 10 })) === 'trusted',
    'a later visit uses the remembered answer even when the store does not respond',
  );

  // The store changed since: this visit keeps its answer, the next gets the new one.
  resetStoreModeForTests();
  assert(
    (await resolveStoreMode(STORE, { fetch: answering(404).fetcher })) === 'trusted',
    'a changed store does not change the mode of a visit already under way',
  );
  await settle();
  resetStoreModeForTests();
  assert(
    (await resolveStoreMode(STORE, { fetch: failing })) === 'legacy',
    'but the next visit starts with what the store said last time',
  );

  // Never reached: legacy for now, and not remembered.
  entries.clear();
  resetStoreModeForTests();
  assert(
    (await resolveStoreMode(STORE, { fetch: failing })) === 'legacy',
    'a store never reached is treated as legacy for this visit',
  );
  assert(entries.size === 0, 'and nothing is remembered about it');

  // Each store is remembered on its own.
  entries.clear();
  resetStoreModeForTests();
  await resolveStoreMode(STORE, { fetch: answering(200, { mode: 'trusted' }).fetcher });
  resetStoreModeForTests();
  assert(
    (await resolveStoreMode('https://other.example', { fetch: answering(404).fetcher })) ===
      'legacy',
    "another store's answer is its own",
  );
}

if (failures > 0) console.error(`${failures} failure(s)`);
