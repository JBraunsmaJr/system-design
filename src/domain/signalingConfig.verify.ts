/**
 * Standalone verification for signalingConfig.ts. Run with:
 *
 *   npx tsx src/domain/signalingConfig.verify.ts
 *
 * localStorage is a browser API, not natively available in a plain Node
 * script - this installs a minimal in-memory mock before importing the
 * module under test, since these functions access the global directly
 * at call time rather than at import time. Same approach as
 * presenceIdentity.verify.ts.
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

const { loadSignalingUrls, saveSignalingUrls, parseSignalingUrls, getDefaultSignalingUrl } = await import("./signalingConfig");

// === parseSignalingUrls - pure parsing logic ===
{
  assert(JSON.stringify(parseSignalingUrls("ws://localhost:4444")) === JSON.stringify(["ws://localhost:4444"]), "a single URL parses to a one-element array");

  assert(
    JSON.stringify(parseSignalingUrls("wss://a.example.com,wss://b.example.com")) === JSON.stringify(["wss://a.example.com", "wss://b.example.com"]),
    "multiple comma-separated URLs parse to a multi-element array, in order"
  );

  assert(JSON.stringify(parseSignalingUrls(" wss://a.example.com , wss://b.example.com ")) === JSON.stringify(["wss://a.example.com", "wss://b.example.com"]), "whitespace around each entry is trimmed");

  assert(JSON.stringify(parseSignalingUrls("wss://a.example.com,,wss://b.example.com")) === JSON.stringify(["wss://a.example.com", "wss://b.example.com"]), "an accidental double comma doesn't produce a bogus empty entry in the middle");

  assert(JSON.stringify(parseSignalingUrls("wss://a.example.com,")) === JSON.stringify(["wss://a.example.com"]), "a trailing comma doesn't produce a bogus empty entry at the end");

  assert(JSON.stringify(parseSignalingUrls("")) === JSON.stringify([]), "an empty string parses to an empty array, not an array containing one empty string");

  assert(JSON.stringify(parseSignalingUrls("   ")) === JSON.stringify([]), "a whitespace-only string parses to an empty array");
}

// === loadSignalingUrls / saveSignalingUrls - the actual persistence, and the null-vs-empty-string distinction that matters for correctly falling back to the build-time default ===
{
  (globalThis as unknown as { localStorage: MockStorage }).localStorage.clear();
  assert(loadSignalingUrls() === null, "with nothing ever saved, loadSignalingUrls returns null - distinct from an empty string, so a caller can tell 'never configured' apart from 'deliberately cleared'");

  saveSignalingUrls("ws://localhost:4444");
  assert(loadSignalingUrls() === "ws://localhost:4444", "a saved value round-trips correctly through load");

  saveSignalingUrls("wss://signaling.example.com");
  assert(loadSignalingUrls() === "wss://signaling.example.com", "saving again correctly overwrites the previous value, not appends or merges");

  saveSignalingUrls("");
  assert(loadSignalingUrls() === "", "explicitly saving an empty string (clearing the override) is distinguishable from never having saved anything at all - loadSignalingUrls returns '', not null, once something (even nothing) has actually been saved");
}

// === getDefaultSignalingUrl ===
{
  (globalThis as unknown as { window?: { __APP_CONFIG__?: { SIGNALING_URL?: string; RELAY_URL?: string; RELAY?: string } } }).window = undefined;
  assert(getDefaultSignalingUrl() === "", "when no window or runtime config exists, returns empty default or build-time env");

  (globalThis as unknown as { window: { __APP_CONFIG__?: { SIGNALING_URL?: string; RELAY_URL?: string; RELAY?: string } } }).window = {
    __APP_CONFIG__: {
      SIGNALING_URL: "wss://runtime-relay.example.com",
    },
  };
  assert(getDefaultSignalingUrl() === "wss://runtime-relay.example.com", "when window.__APP_CONFIG__.SIGNALING_URL is set, returns runtime config");

  (globalThis as unknown as { window: { __APP_CONFIG__?: { SIGNALING_URL?: string; RELAY_URL?: string; RELAY?: string } } }).window = {
    __APP_CONFIG__: {
      RELAY: "wss://relay-env.example.com",
    },
  };
  assert(getDefaultSignalingUrl() === "wss://relay-env.example.com", "when window.__APP_CONFIG__.RELAY is set, returns runtime config");

  (globalThis as unknown as { window: { __APP_CONFIG__?: { SIGNALING_URL?: string; RELAY_URL?: string; RELAY?: string } } }).window = {
    __APP_CONFIG__: {
      RELAY_URL: "wss://relay-url-env.example.com",
    },
  };
  assert(getDefaultSignalingUrl() === "wss://relay-url-env.example.com", "when window.__APP_CONFIG__.RELAY_URL is set, returns runtime config");

  (globalThis as unknown as { window?: { __APP_CONFIG__?: { SIGNALING_URL?: string } } }).window = undefined;
}

// === Storage failures are swallowed, not thrown - matching presenceIdentity.ts's own established contract ===
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
  let result: string | null = "not yet set";
  try {
    result = loadSignalingUrls();
  } catch {
    threw = true;
  }
  assert(!threw && result === null, "when localStorage.getItem throws (private-browsing restrictions, etc.), loadSignalingUrls falls back to null rather than propagating the error");

  threw = false;
  try {
    saveSignalingUrls("ws://localhost:4444");
  } catch {
    threw = true;
  }
  assert(!threw, "when localStorage.setItem throws, saveSignalingUrls silently swallows it rather than propagating the error");

  (globalThis as unknown as { localStorage: MockStorage }).localStorage = new MockStorage();
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
