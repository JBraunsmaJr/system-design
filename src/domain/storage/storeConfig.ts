/**
 * Where the store is, if there is one (WS8-R9, deployment shapes A-D).
 *
 * Absent means shapes A and B: the editor works exactly as it does today,
 * with no sign-in and nothing leaving the browser. Everything the store adds
 * is additive, so a deployment that never configures one sees no change.
 *
 * The address comes from one of two places:
 *
 *   - the deployment, which serves the editor with its store's address
 *     built in or injected at runtime; or
 *   - this browser, where someone has pointed the editor at a store
 *     themselves (File > Documents). That is how a copy of the editor
 *     hosted somewhere general - the public build, say - is used with an
 *     organization's own store.
 *
 * The browser's choice wins, because it is the more specific and the more
 * recent decision, and it can always be removed to fall back.
 */
export const STORE_URL_KEY = 'system-design-editor:store-url';

/** The address the deployment configured, or null. */
export function getDeploymentStoreUrl(): string | null {
  const runtime = (
    globalThis as unknown as { window?: { __APP_CONFIG__?: { STORE_URL?: string } } }
  ).window?.__APP_CONFIG__?.STORE_URL;
  const configured =
    typeof runtime === 'string' && runtime.trim() && !runtime.includes('__STORE_URL__')
      ? runtime
      : ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_STORE_URL ?? '');
  const trimmed = configured.trim().replace(/\/+$/, '');
  return trimmed.length > 0 ? trimmed : null;
}

/** The address chosen in this browser, or null. */
export function getSavedStoreUrl(): string | null {
  try {
    const saved = globalThis.localStorage?.getItem(STORE_URL_KEY) ?? null;
    if (saved === null) return null;
    // Re-checked on the way out: storage can be edited by hand.
    const parsed = parseStoreAddress(saved);
    return parsed.ok ? parsed.url : null;
  } catch {
    return null;
  }
}

/** Remembers a store for this browser; null forgets it. False if the
 * browser would not keep it. */
export function saveStoreUrl(url: string | null): boolean {
  try {
    if (url === null) globalThis.localStorage.removeItem(STORE_URL_KEY);
    else globalThis.localStorage.setItem(STORE_URL_KEY, url);
    return true;
  } catch {
    return false;
  }
}

export function getStoreUrl(): string | null {
  return getSavedStoreUrl() ?? getDeploymentStoreUrl();
}

export type ParsedStoreAddress = { ok: true; url: string } | { ok: false; message: string };

const isLoopback = (hostname: string) =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

/**
 * Turns what someone typed into a store address, or says what is wrong
 * with it (pure).
 *
 * `pageProtocol` is the protocol of the page the editor is on. A page
 * served over https cannot call a store over plain http - the browser
 * blocks it without saying why - so that is caught here, where it can be
 * explained. A store on this machine is the exception browsers make.
 */
export function parseStoreAddress(input: string, pageProtocol?: string): ParsedStoreAddress {
  const typed = input.trim();
  if (!typed) return { ok: false, message: 'Enter the address of your store.' };
  // "store.example.com" is taken to mean https, which is what a store
  // should be served over.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return {
      ok: false,
      message: 'That is not a web address. It looks like https://store.example.com',
    };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return {
      ok: false,
      message: 'A store address starts with https:// (or http:// on this machine).',
    };
  }
  if (!url.hostname) {
    return {
      ok: false,
      message: 'That is not a web address. It looks like https://store.example.com',
    };
  }
  if (url.username || url.password) {
    return {
      ok: false,
      message: 'Leave the user name and password out of the address. You sign in after connecting.',
    };
  }
  if (url.search || url.hash) {
    return { ok: false, message: 'Leave everything after the ? or # out of the address.' };
  }
  if (pageProtocol === 'https:' && url.protocol === 'http:' && !isLoopback(url.hostname)) {
    return {
      ok: false,
      message:
        'This page is served over https, and browsers do not let it talk to a store over plain http. Use the https address of your store.',
    };
  }
  // A store may be served under a path, behind a proxy; keep it.
  const path = url.pathname.replace(/\/+$/, '');
  return { ok: true, url: `${url.origin}${path}` };
}
