/**
 * Standalone verification for presenceIdentity.ts. Run with:
 *
 *   npx tsx src/domain/presenceIdentity.verify.ts
 *
 * localStorage is a browser API, not natively available in a plain Node
 * script - this installs a minimal in-memory mock (with the same
 * get/set/removeItem shape localStorage actually has) before importing
 * the module under test, since these functions access the global
 * directly at call time rather than at import time.
 */
let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  } else {
    console.log("ok:", msg);
  }
}

class MockStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

(globalThis as unknown as { localStorage: MockStorage }).localStorage = new MockStorage();

const { loadPresenceName, savePresenceName, loadShowPeerCursors, saveShowPeerCursors } = await import("./presenceIdentity");

// === loadPresenceName / savePresenceName ===
{
  (globalThis as unknown as { localStorage: MockStorage }).localStorage.clear();
  assert(loadPresenceName() === null, "with nothing ever saved, loadPresenceName returns null rather than throwing or returning an empty string");

  savePresenceName("Alice");
  assert(loadPresenceName() === "Alice", "a saved name round-trips correctly through load");

  savePresenceName("Bob");
  assert(loadPresenceName() === "Bob", "saving again correctly overwrites the previous value, not appends or merges");
}

// === loadShowPeerCursors / saveShowPeerCursors - the actual new feature ===
{
  (globalThis as unknown as { localStorage: MockStorage }).localStorage.clear();
  assert(loadShowPeerCursors() === true, "with nothing ever saved, loadShowPeerCursors defaults to true - a first-time user should see the feature exists at all, not have it silently hidden");

  saveShowPeerCursors(false);
  assert(loadShowPeerCursors() === false, "turning cursors off round-trips correctly through load");

  saveShowPeerCursors(true);
  assert(loadShowPeerCursors() === true, "turning cursors back on round-trips correctly too - not stuck at whatever the first save happened to be");
}

// === Malformed/legacy storage content shouldn't crash the reader ===
{
  (globalThis as unknown as { localStorage: MockStorage }).localStorage.clear();
  (globalThis as unknown as { localStorage: MockStorage }).localStorage.setItem("system-design-editor:show-peer-cursors", "not-actually-a-boolean");
  assert(loadShowPeerCursors() === false, "a stored value that isn't the literal string \"true\" is treated as false rather than crashing or defaulting back to true - the string equality check is intentionally strict, not just 'not empty'");
}

// === Storage failures are swallowed, not thrown - matching the existing loadPresenceName/savePresenceName contract this file already established ===
{
  const throwingStorage = {
    getItem(): string {
      throw new Error("storage disabled");
    },
    setItem(): void {
      throw new Error("storage disabled");
    },
  };
  (globalThis as unknown as { localStorage: unknown }).localStorage = throwingStorage;

  let threw = false;
  let result: boolean | undefined;
  try {
    result = loadShowPeerCursors();
  } catch {
    threw = true;
  }
  assert(!threw && result === true, "when localStorage.getItem throws (private-browsing restrictions, etc.), loadShowPeerCursors falls back to true rather than propagating the error");

  threw = false;
  try {
    saveShowPeerCursors(false);
  } catch {
    threw = true;
  }
  assert(!threw, "when localStorage.setItem throws, saveShowPeerCursors silently swallows it rather than propagating the error - this is a convenience, not a guarantee, matching savePresenceName's own established contract");

  (globalThis as unknown as { localStorage: MockStorage }).localStorage = new MockStorage();
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
