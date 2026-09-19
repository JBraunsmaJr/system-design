/** WS7-R1, R3, WS9-R1: the key handling behind the workspace document list. */
import { documentKeyFor, indexKeyFor, newDocumentKey, removeEntry, upsertEntry } from "./workspaceDocuments.ts";
import { generateWorkspaceKey, exportSymmetricKeyHex, deriveStorageKey } from "../crypto/keys.ts";
import { createWebCryptoStorage } from "../crypto/storageCrypto.ts";
import type { IndexEntry } from "./storeClient.ts";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}
async function rejects(work: () => Promise<unknown>, message: string) {
  try {
    await work();
    failures++;
    console.error(`  FAIL: ${message} (it succeeded)`);
  } catch {
    console.log(`  ✓ ${message}`);
  }
}

const entry = (docId: string, updatedAt: string, wrappedDocKey = "AA=="): IndexEntry => ({ docId, wrappedDocKey, title: docId, updatedAt });

console.log("=== Document keys ===");
{
  const workspaceKey = await generateWorkspaceKey();
  const { documentKey, wrappedDocKey } = await newDocumentKey(workspaceKey);
  assert(/^[0-9a-f]{32}$/.test(documentKey), "a new document key is 128 bits of hex, as a share link carries");
  assert(!wrappedDocKey.includes(documentKey), "the wrap does not contain it");
  const recovered = await documentKeyFor({ wrappedDocKey }, workspaceKey);
  assert(recovered === documentKey, "unwrapping recovers the document key itself, so the document stays shareable by link");

  const other = await generateWorkspaceKey();
  await rejects(() => documentKeyFor({ wrappedDocKey }, other), "another workspace's key cannot recover it");

  // What the round trip is for: the document opens again.
  const crypto = createWebCryptoStorage();
  const context = { docId: "doc-1", kind: "snapshot" as const, version: 2 };
  const sealed = await crypto.seal(context, new TextEncoder().encode("a diagram"), await deriveStorageKey(documentKey));
  const opened = await crypto.open(context, sealed, await deriveStorageKey(recovered));
  assert(new TextDecoder().decode(opened) === "a diagram", "and a document sealed with it opens with the recovered key");
}

console.log("\n=== The index key ===");
{
  const workspaceKey = await generateWorkspaceKey();
  const first = await indexKeyFor(workspaceKey);
  const second = await indexKeyFor(workspaceKey);
  assert((await exportSymmetricKeyHex(first)) === (await exportSymmetricKeyHex(second)), "the same workspace key always derives the same index key");
  assert(
    (await exportSymmetricKeyHex(first)) !== (await exportSymmetricKeyHex(await indexKeyFor(await generateWorkspaceKey()))),
    "and a different workspace key derives a different one"
  );
  assert((await exportSymmetricKeyHex(first)) !== (await exportSymmetricKeyHex(workspaceKey)), "the index key is not the workspace key itself");
}

console.log("\n=== The list ===");
{
  const entries = [entry("a", "2026-09-01T00:00:00Z"), entry("b", "2026-09-03T00:00:00Z")];
  const updated = upsertEntry(entries, entry("a", "2026-09-05T00:00:00Z"));
  assert(updated.length === 2 && updated[0].docId === "a", "re-saving a document moves it to the top rather than duplicating it");
  const added = upsertEntry(entries, entry("c", "2026-09-02T00:00:00Z"));
  assert(added.length === 3 && added.map((e) => e.docId).join() === "b,c,a", "a new document is listed in recency order");
  assert(removeEntry(added, "c").length === 2, "removing takes exactly one entry");
  assert(removeEntry(added, "missing").length === 3, "and removing something absent changes nothing");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
} else {
  console.log("\nAll workspace document checks passed.");
}
