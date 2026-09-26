/**
 * Rotating a workspace key (WS7-R7), against the real service.
 *
 * The acceptance is specific: a large workspace rotates without rewriting
 * any content blob, documents open with the new key and not the old, and
 * soft-deleted documents inside their retention are re-wrapped so they stay
 * restorable. All three are checked here, with real keys.
 */
import type { AddressInfo } from 'net';
import { createMemoryBlobStore, type MemoryTx } from '../store/src/blobStore.ts';
import { createDocumentService } from '../store/src/documentService.ts';
import { createHttpService, type StoreBackend } from '../store/src/httpService.ts';
import { createMemoryUserDirectory } from '../store/src/userDirectory.ts';
import { createMemoryWorkspaceIndex } from '../store/src/workspaceIndex.ts';
import { createStoreClient } from '../src/collab/storeClient.ts';
import { rotateWorkspaceKey } from '../src/collab/workspaceRotation.ts';
import {
  documentKeyFor,
  escrowDocumentKey,
  indexKeyFor,
  newDocumentKey,
  upsertEntry,
} from '../src/collab/workspaceDocuments.ts';
import {
  exportPublicKey,
  exportSymmetricKeyHex,
  generateWorkspaceKey,
  generateWrappingKeyPair,
} from '../src/crypto/keys.ts';
import { toPem } from '../src/crypto/documentPackage.ts';
import type { DiagramFile } from '../src/domain/serialization.ts';

let failures = 0;
function check(condition: boolean, message: string) {
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

const document = (title: string) =>
  ({
    schemaVersion: '0.7',
    title,
    nodes: [],
    edges: [],
    scenarios: [],
    requirements: {
      itemTypes: [],
      categories: [],
      items: [],
      relationshipTypes: [],
      relationships: [],
      nextSequence: {},
    },
    programIncrements: [],
    team: { members: [], settings: {} },
    milestones: [],
    metadata: { updatedAt: '2026-09-19T00:00:00.000Z' },
  }) as unknown as DiagramFile;

const blobs = createMemoryBlobStore();
const service = createDocumentService<MemoryTx>({
  blobs,
  begin: () => blobs.begin(),
  commit: (tx) => blobs.commit(tx),
  rollback: (tx) => blobs.rollback(tx),
});
const recovery = await generateWrappingKeyPair('recovery');
const recoveryPem = toPem(await exportPublicKey(recovery.publicKey), 'PUBLIC KEY');
const directory = createMemoryUserDirectory();
const server = createHttpService({
  store: service as unknown as StoreBackend,
  workspaceIndex: createMemoryWorkspaceIndex(),
  directory,
  allowUnauthenticated: true,
  isAdmin: () => true,
  recoveryPublicKeyPem: recoveryPem,
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const client = createStoreClient({ baseUrl: origin });
const WORKSPACE = 'default';
const COUNT = Number(process.env.ROTATION_DOCUMENTS ?? 60);

try {
  console.log(`=== A workspace of ${COUNT} documents ===`);
  const oldKey = await generateWorkspaceKey();
  const oldIndexKey = await indexKeyFor(oldKey);
  const recoveryPublic = (await client.recoveryPublicKey())!;

  for (let i = 0; i < COUNT; i++) {
    const docId = `doc-${i}`;
    const { documentKey, wrappedDocKey } = await newDocumentKey(oldKey);
    await client.putDocument(docId, documentKey, document(`Document ${i}`), {
      wrappedForWorkspace: wrappedDocKey,
      wrappedForRecovery: await escrowDocumentKey(documentKey, recoveryPublic),
    });
    await client.updateIndex(WORKSPACE, oldIndexKey, (entries) =>
      upsertEntry(entries, {
        docId,
        wrappedDocKey,
        title: `Document ${i}`,
        updatedAt: new Date(2026, 8, 19, 0, i).toISOString(),
      }),
    );
  }
  // One of them deleted, but still inside its retention.
  await client.deleteDocument('doc-0');
  check(
    (await client.readIndex(WORKSPACE, oldIndexKey)).entries.length === COUNT,
    'all of them are listed, including the deleted one',
  );

  const blobsBefore = await blobs.totalBytes();
  const contentBefore = new Map<string, string>();
  for (let i = 1; i < COUNT; i++) {
    const entry = (await client.readIndex(WORKSPACE, oldIndexKey)).entries.find(
      (e) => e.docId === `doc-${i}`,
    )!;
    contentBefore.set(
      `doc-${i}`,
      (await client.getDocument(`doc-${i}`, await documentKeyFor(entry, oldKey))).file.title,
    );
  }

  console.log('\n=== Rotating ===');
  const started = performance.now();
  const result = await rotateWorkspaceKey({
    client,
    workspaceId: WORKSPACE,
    currentKey: oldKey,
    currentGeneration: 1,
  });
  const elapsed = performance.now() - started;
  check(
    result.generation === 2 && result.documentsRewrapped === COUNT,
    `every document is re-wrapped (${result.documentsRewrapped}) at generation ${result.generation}`,
  );
  check(
    (await blobs.totalBytes()) === blobsBefore,
    'and not one content blob is rewritten (WS7-R7)',
  );
  console.log(`  (${COUNT} documents in ${elapsed.toFixed(0)} ms)`);

  console.log('\n=== The new key works, the old one does not ===');
  const newKey = result.workspaceKey;
  const newIndexKey = await indexKeyFor(newKey);
  const after = await client.readIndex(WORKSPACE, newIndexKey);
  check(
    after.entries.length === COUNT && after.generation === 2,
    'the index opens with the new key, and says which generation it is',
  );
  let opened = 0;
  for (const [docId, title] of contentBefore) {
    const entry = after.entries.find((e) => e.docId === docId)!;
    const file = (await client.getDocument(docId, await documentKeyFor(entry, newKey))).file;
    if (file.title === title) opened++;
  }
  check(opened === contentBefore.size, `every document still opens, unchanged (${opened})`);
  await rejects(
    () => client.readIndex(WORKSPACE, oldIndexKey),
    'the old key no longer opens the index',
  );
  const staleEntry = {
    wrappedDocKey: (await client.readIndex(WORKSPACE, newIndexKey)).entries[0].wrappedDocKey,
  };
  await rejects(() => documentKeyFor(staleEntry, oldKey), 'and no longer unwraps a document key');

  console.log('\n=== A deleted document stays restorable (WS10-R4) ===');
  const deletedEntry = after.entries.find((e) => e.docId === 'doc-0')!;
  const deletedKey = await documentKeyFor(deletedEntry, newKey);
  await rejects(
    () => client.getDocument('doc-0', deletedKey),
    'it reads as deleted while it is deleted',
  );
  await fetch(`${origin}/v1/docs/doc-0/restore`, { method: 'POST' });
  const restored = await client.getDocument('doc-0', deletedKey);
  check(
    restored.file.title === 'Document 0',
    'and once restored it opens with the NEW key: rotation re-wrapped it too',
  );

  console.log('\n=== Members ===');
  {
    // Two members holding the current key, one of whom has never published
    // a public key; and someone who signed in but was never let in.
    const alice = await directory.upsertUser({ issuer: 'https://idp', subject: 'alice' });
    const userKey = await generateWrappingKeyPair('user');
    await directory.setUserPublicKey(
      alice.userId,
      Buffer.from(await exportPublicKey(userKey.publicKey)).toString('base64'),
    );
    await directory.putWorkspaceKey(alice.userId, 2, 'placeholder-wrap');
    const bob = await directory.upsertUser({ issuer: 'https://idp', subject: 'bob' });
    await directory.putWorkspaceKey(bob.userId, 2, 'placeholder-wrap');
    const carol = await directory.upsertUser({ issuer: 'https://idp', subject: 'carol' });
    const carolKey = await generateWrappingKeyPair('user');
    await directory.setUserPublicKey(
      carol.userId,
      Buffer.from(await exportPublicKey(carolKey.publicKey)).toString('base64'),
    );

    const second = await rotateWorkspaceKey({
      client,
      workspaceId: WORKSPACE,
      currentKey: newKey,
      currentGeneration: 2,
    });
    check(
      second.membersGranted === 1,
      'the new key is wrapped to each member who has published a key',
    );
    check(
      second.membersSkipped.length === 1,
      'and anyone who has not is named rather than skipped silently',
    );
    const wraps = await directory.getWorkspaceKeys(alice.userId);
    check(
      wraps.some((wrap) => wrap.generation === 3),
      "the member's wrap is recorded at the new generation",
    );
    check(
      (await directory.getWorkspaceKeys(carol.userId)).length === 0,
      'someone who was never let in is not let in by rotation',
    );
    check(
      (await exportSymmetricKeyHex(second.workspaceKey)) !== (await exportSymmetricKeyHex(newKey)),
      'and rotating again produces a different key',
    );
  }
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll workspace rotation checks passed.');
