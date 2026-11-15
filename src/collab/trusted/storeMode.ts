/**
 * Which API the configured store speaks.
 *
 * A store serving the workspace API (/v2) is "trusted": the server decides
 * access and can read documents. One that does not is "legacy": the
 * key-based API, where documents are encrypted in the browser. The editor
 * supports both while stores are being upgraded, and needs to know which
 * before it mounts, because the two are wired through different hooks.
 *
 * So the answer is resolved once, before the first render (main.tsx), and
 * read synchronously afterwards. To keep that from delaying every start:
 *
 *   - no store configured: nothing to ask;
 *   - asked before: the remembered answer is used at once, and re-checked in
 *     the background for next time (a store is upgraded once, and the editor
 *     is reloaded far more often than that);
 *   - never asked: one short request, and if the store does not answer in
 *     time it is treated as legacy for this visit and nothing is remembered.
 */

export type StoreMode = 'none' | 'legacy' | 'trusted';

const KEY_PREFIX = 'system-design-editor:store-mode:';
/** Long enough for a store on the same network, short enough not to hold up
 * the editor when the store is down. */
const PROBE_TIMEOUT_MS = 1500;

let resolved: StoreMode | null = null;

function remembered(storeUrl: string): StoreMode | null {
  try {
    const value = localStorage.getItem(`${KEY_PREFIX}${storeUrl}`);
    return value === 'legacy' || value === 'trusted' ? value : null;
  } catch {
    return null;
  }
}

function remember(storeUrl: string, mode: StoreMode) {
  try {
    localStorage.setItem(`${KEY_PREFIX}${storeUrl}`, mode);
  } catch {
    // Not remembered: the next visit asks again.
  }
}

/**
 * Asks the store. Null when it did not answer, which says nothing about
 * what it is.
 */
export async function probeStoreMode(
  storeUrl: string,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<'legacy' | 'trusted' | null> {
  const call = options.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? PROBE_TIMEOUT_MS);
  try {
    const response = await call(`${storeUrl.replace(/\/+$/, '')}/v2/health`, {
      signal: controller.signal,
    });
    if (response.status === 404) return 'legacy';
    if (!response.ok) return null;
    const body = (await response.json()) as { mode?: unknown };
    return body.mode === 'trusted' ? 'trusted' : 'legacy';
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether there is a store at an address someone typed, and which kind.
 * Null when there is not, or it cannot be reached from this page.
 *
 * Stricter than `probeStoreMode`, which takes a 404 from /v2/health to mean
 * an older store: true of a store the deployment configured, but any web
 * server answers 404 to a path it does not have. So an apparent older store
 * must also answer its own health check.
 */
export async function checkStore(
  storeUrl: string,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<'legacy' | 'trusted' | null> {
  const timeoutMs = options.timeoutMs ?? 4000;
  const mode = await probeStoreMode(storeUrl, { ...options, timeoutMs });
  if (mode !== 'legacy') return mode;
  const call = options.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await call(`${storeUrl.replace(/\/+$/, '')}/v1/health`, {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { status?: unknown };
    return typeof body === 'object' && body !== null && 'status' in body ? 'legacy' : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolves the mode for this visit. Call once, before the first render. */
export async function resolveStoreMode(
  storeUrl: string | null,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<StoreMode> {
  if (!storeUrl) {
    resolved = 'none';
    return resolved;
  }
  const known = remembered(storeUrl);
  if (known) {
    resolved = known;
    // For next time. Not awaited: this visit has its answer.
    void probeStoreMode(storeUrl, options).then((mode) => {
      if (mode && mode !== known) remember(storeUrl, mode);
    });
    return resolved;
  }
  const probed = await probeStoreMode(storeUrl, options);
  if (probed) remember(storeUrl, probed);
  resolved = probed ?? 'legacy';
  return resolved;
}

/**
 * The mode resolved for this visit. Before `resolveStoreMode` has run -
 * which only happens in tests that render without main.tsx - a configured
 * store is taken to be legacy, as it always was.
 */
export function getStoreMode(storeUrl: string | null): StoreMode {
  if (!storeUrl) return 'none';
  return resolved ?? 'legacy';
}

/** For tests. */
export function resetStoreModeForTests() {
  resolved = null;
}
