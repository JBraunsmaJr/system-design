/**
 * The key handling behind a workspace document list (WS7-R1, R3, WS9-R1).
 *
 * Separated from the React hook so it can be tested on its own: this is
 * where a document key is made, wrapped, and recovered, and getting it wrong
 * would mean either an unreadable document or a key reaching the store.
 */
import { deriveStorageKey, exportSymmetricKeyHex, importDocumentKey, unwrapKey, wrapKey } from "../crypto/keys.ts";
import { generateSessionKey } from "../domain/sessionLink.ts";
import type { IndexEntry } from "./storeClient.ts";

export const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
export const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/**
 * The key the workspace index is sealed under: derived from the workspace
 * key, so a device that cannot unwrap the workspace key cannot read the list
 * either - and neither can the store.
 */
export async function indexKeyFor(workspaceKey: CryptoKey): Promise<CryptoKey> {
  return deriveStorageKey(await exportSymmetricKeyHex(workspaceKey));
}

/**
 * A new document's key: generated here, wrapped under the workspace key, and
 * never sent anywhere unwrapped (WS7-R3). The same 128 bits a share link
 * would carry, so a document can be both stored and shared.
 */
export async function newDocumentKey(workspaceKey: CryptoKey): Promise<{ documentKey: string; wrappedDocKey: string }> {
  const documentKey = generateSessionKey();
  // The document key itself is wrapped, not the storage key derived from
  // it: the document stays shareable by link, and a reader derives the
  // storage key the same way the writer did. Wrapping the derived key would
  // make a re-opened document derive twice and decrypt nothing.
  return { documentKey, wrappedDocKey: toBase64(await wrapKey(await importDocumentKey(documentKey), workspaceKey)) };
}

/** Recovers a listed document's key. Fails if the workspace key is wrong,
 * which is what stops one workspace reading another's documents. */
export async function documentKeyFor(entry: Pick<IndexEntry, "wrappedDocKey">, workspaceKey: CryptoKey): Promise<string> {
  return exportSymmetricKeyHex(await unwrapKey(fromBase64(entry.wrappedDocKey), workspaceKey, "AES-GCM", 128));
}

/** Replaces an entry, or adds it, keeping the list sorted by recency - the
 * order the document list shows. */
export function upsertEntry(entries: readonly IndexEntry[], entry: IndexEntry): IndexEntry[] {
  return [...entries.filter((existing) => existing.docId !== entry.docId), entry].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function removeEntry(entries: readonly IndexEntry[], docId: string): IndexEntry[] {
  return entries.filter((entry) => entry.docId !== docId);
}
