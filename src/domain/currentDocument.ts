/**
 * Which document a tab opens (WS2-R1, WS2-R3).
 *
 * The document id lives in the URL (`?doc=<id>`), so each tab holds its own
 * document and reloading reopens the same one - two tabs can no longer write
 * over each other through a single shared slot. A small "last opened" pointer
 * (a preference-sized key, which WS2-R1 permits) picks the document for a
 * bare URL.
 *
 * With neither, the id is "local": the document every browser has been
 * persisting under since the unified model landed, so existing work reopens
 * without any migration step.
 */
export const DOCUMENT_URL_PARAM = 'doc';
export const LAST_DOCUMENT_KEY = 'system-design-editor:last-document';
export const DEFAULT_DOCUMENT_ID = 'local';

/** Ids become IndexedDB database names and URL parameters, so only a
 * conservative alphabet is accepted from either source. */
const VALID_ID = /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,127}$/;

export function isValidDocumentId(id: unknown): id is string {
  return typeof id === 'string' && VALID_ID.test(id);
}

export type DocumentIdSource = 'url' | 'last-opened' | 'default';

export function resolveDocumentId(inputs: { urlDocId: string | null; lastDocId: string | null }): {
  docId: string;
  source: DocumentIdSource;
} {
  if (isValidDocumentId(inputs.urlDocId)) return { docId: inputs.urlDocId, source: 'url' };
  if (isValidDocumentId(inputs.lastDocId))
    return { docId: inputs.lastDocId, source: 'last-opened' };
  return { docId: DEFAULT_DOCUMENT_ID, source: 'default' };
}

export function readDocumentParam(href: string): string | null {
  try {
    return new URL(href).searchParams.get(DOCUMENT_URL_PARAM);
  } catch {
    return null;
  }
}

/**
 * `href` with the document parameter set, everything else - including a
 * session link in the hash - left as it was. Returns `href` unchanged when it
 * already names this document, so callers can skip a history write.
 */
export function withDocumentParam(href: string, docId: string): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }
  if (url.searchParams.get(DOCUMENT_URL_PARAM) === docId) return href;
  url.searchParams.set(DOCUMENT_URL_PARAM, docId);
  return url.toString();
}

/**
 * The document-store id a joined session's replica is indexed under. Distinct
 * from any local document, and derived from the room so rejoining the same
 * room updates the same entry (WS13-R12 needs the room to rehost it).
 */
export function sessionDocumentId(roomName: string): string {
  const safe = roomName.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 100);
  return `session:${safe}`;
}
