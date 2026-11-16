/**
 * Whether the configured store is one this editor can use.
 *
 * A store serves workspaces under /v2 and says so at /v2/health: that is
 * "trusted", the only kind this editor works with. A store from before
 * workspaces has no /v2: that is "outdated". The editor then runs on its
 * own and says the store needs upgrading, rather than failing request by
 * request.
 *
 * The answer decides how the editor is wired, so it is resolved once,
 * before the first render (main.tsx), and read synchronously afterward.
 * To keep that from delaying every start:
 *
 *   - no store configured: nothing to ask;
 *   - asked before: the remembered answer is used at once, and re-checked in
 *     the background for next time (a store is upgraded once, and the editor
 *     is reloaded far more often than that);
 *   - never asked: one short request. A store that does not answer in time
 *     is taken to be a current one that is unreachable - which the editor
 *     already handles, by saying so and working locally - and nothing is
 *     remembered.
 */

export type StoreMode = 'none' | 'outdated' | 'trusted';

const KEY_PREFIX = 'system-design-editor:store-mode:';
/** Long enough for a store on the same network, short enough not to hold up
 * the editor when the store is down. */
const PROBE_TIMEOUT_MS = 1500;

let resolved: StoreMode | null = null;

function remembered(storeUrl: string): StoreMode | null {
  try {
    const value = localStorage.getItem(`${KEY_PREFIX}${storeUrl}`);
    // "legacy" is what earlier versions of this editor wrote for the same
    // thing.
    if (value === 'legacy' || value === 'outdated') return 'outdated';
    return value === 'trusted' ? value : null;
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
): Promise<'outdated' | 'trusted' | null> {
  const call = options.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? PROBE_TIMEOUT_MS);
  try {
    const response = await call(`${storeUrl.replace(/\/+$/, '')}/v2/health`, {
      signal: controller.signal,
    });
    if (response.status === 404) return 'outdated';
    if (!response.ok) return null;
    const body = (await response.json()) as { mode?: unknown };
    return body.mode === 'trusted' ? 'trusted' : 'outdated';
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
 * an outdated store: true of a store the deployment configured, but any web
 * server answers 404 to a path it does not have. So an apparent outdated
 * store must also answer the health check every store has had.
 */
export async function checkStore(
  storeUrl: string,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<'outdated' | 'trusted' | null> {
  const timeoutMs = options.timeoutMs ?? 4000;
  const mode = await probeStoreMode(storeUrl, { ...options, timeoutMs });
  if (mode !== 'outdated') return mode;
  const call = options.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await call(`${storeUrl.replace(/\/+$/, '')}/v1/health`, {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { status?: unknown };
    return typeof body === 'object' && body !== null && 'status' in body ? 'outdated' : null;
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
  resolved = probed ?? 'trusted';
  return resolved;
}

/**
 * The mode resolved for this visit. Before `resolveStoreMode` has run -
 * which only happens in tests that render without main.tsx - a configured
 * store is taken to be a current one.
 */
export function getStoreMode(storeUrl: string | null): StoreMode {
  if (!storeUrl) return 'none';
  return resolved ?? 'trusted';
}

/** For tests. */
export function resetStoreModeForTests() {
  resolved = null;
}
