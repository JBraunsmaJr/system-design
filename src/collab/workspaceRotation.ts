/**
 * Rotating a workspace key (WS7-R7).
 *
 * Wanted when a device is lost: revoking it stops the store serving it, but
 * it keeps whatever workspace key it already unwrapped. Rotation makes that
 * key worthless for anything afterwards.
 *
 * Only keys move. Each document key is unwrapped with the old workspace key
 * and wrapped with the new one, and the index is re-sealed; no content is
 * re-encrypted, which is what keeps a 500-document workspace cheap to
 * rotate. Deleted documents inside their retention are re-wrapped too, so
 * they stay restorable (WS10-R4).
 *
 * The order matters. Documents and the index are re-wrapped before the new
 * key is handed to anyone, and the new key is granted to members last: an
 * interruption leaves everyone still holding a working old key rather than
 * a new key that opens nothing.
 */
import { generateWorkspaceKey, unwrapKey, wrapKey, wrapKeyForPublicKey, importPublicKey } from "../crypto/keys.ts";
import { fromBase64, indexKeyFor, toBase64 } from "./workspaceDocuments.ts";
import type { IndexEntry, StoreClient } from "./storeClient.ts";

export interface RotationResult {
  generation: number;
  workspaceKey: CryptoKey;
  documentsRewrapped: number;
  membersGranted: number;
  /** Members with no published key: they cannot be given the new one until
   * they sign in again, and are named rather than skipped silently. */
  membersSkipped: string[];
}

export interface RotationOptions {
  client: StoreClient;
  workspaceId: string;
  /** The key being replaced. */
  currentKey: CryptoKey;
  currentGeneration: number;
  /** Progress, for an interface that shows it. */
  onProgress?: (done: number, total: number) => void;
}

export async function rotateWorkspaceKey(options: RotationOptions): Promise<RotationResult> {
  const { client, workspaceId, currentKey } = options;
  const generation = options.currentGeneration + 1;
  const newKey = await generateWorkspaceKey();

  const currentIndexKey = await indexKeyFor(currentKey);
  const { entries, version } = await client.readIndex(workspaceId, currentIndexKey);

  // Every document the index knows about, including ones deleted but still
  // retained: skipping those would make them unrestorable (WS10-R4).
  const rewrapped: IndexEntry[] = [];
  let done = 0;
  for (const entry of entries) {
    const documentKey = await unwrapKey(fromBase64(entry.wrappedDocKey), currentKey, "AES-GCM", 128);
    const wrappedDocKey = toBase64(await wrapKey(documentKey, newKey));
    await client.rewrapDocument(entry.docId, wrappedDocKey);
    rewrapped.push({ ...entry, wrappedDocKey });
    options.onProgress?.(++done, entries.length);
  }

  // The index, re-sealed under the new key and marked with its generation,
  // so a client holding the old key knows to fetch the new one rather than
  // conclude the index is unreadable.
  // Written, not updated: updateIndex re-reads first, which would need the
  // key being replaced. The version it was read at makes the write
  // conditional all the same, so a concurrent edit is still caught (WS9-R3).
  const newIndexKey = await indexKeyFor(newKey);
  await client.writeIndex(workspaceId, newIndexKey, rewrapped, version, generation);

  // Last: hand the new key to each member.
  const members = await client.listMembers();
  const skipped: string[] = [];
  let granted = 0;
  for (const member of members) {
    if (!member.publicKey) {
      skipped.push(member.displayName ?? member.userId);
      continue;
    }
    const wrapped = await wrapKeyForPublicKey(newKey, await importPublicKey(fromBase64(member.publicKey)));
    await client.grantWorkspaceKey(member.userId, generation, toBase64(wrapped));
    granted++;
  }

  return { generation, workspaceKey: newKey, documentsRewrapped: rewrapped.length, membersGranted: granted, membersSkipped: skipped };
}
