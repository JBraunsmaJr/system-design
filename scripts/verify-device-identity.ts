/**
 * Two browsers, one workspace (WS7-R8, R11, WS9).
 *
 * The real store service, the real client, and the real key handling: the
 * first browser makes the keys, the second registers and waits, the first
 * approves it, and both then open the same document from the workspace.
 * Nothing here is stubbed except the key storage, which stands in for
 * IndexedDB.
 */
import type { AddressInfo } from "net";
import { createMemoryBlobStore, type MemoryTx } from "../store/src/blobStore.ts";
import { createDocumentService } from "../store/src/documentService.ts";
import { createHttpService, type StoreBackend } from "../store/src/httpService.ts";
import { createMemoryUserDirectory } from "../store/src/userDirectory.ts";
import { createMemoryWorkspaceIndex } from "../store/src/workspaceIndex.ts";
import { createSessionStore } from "../store/src/auth/sessions.ts";
import { createProvider } from "../store/src/auth/providers.ts";
import { startTestOidcProvider } from "./lib/testIdentityProviders.ts";
import { createStoreClient, type StoreClient } from "../src/collab/storeClient.ts";
import {
  approveOtherDevice,
  bootstrapFirstDevice,
  createMemoryDeviceKeyStorage,
  enrollDevice,
  type EnrollmentApi,
} from "../src/collab/deviceIdentity.ts";
import { documentKeyFor, indexKeyFor, newDocumentKey, upsertEntry } from "../src/collab/workspaceDocuments.ts";
import { exportPublicKey, exportSymmetricKeyHex, generateWrappingKeyPair, unwrapPrivateKeyWithPrivateKey } from "../src/crypto/keys.ts";
import { escrowDocumentKey } from "../src/collab/workspaceDocuments.ts";
import { toPem } from "../src/crypto/documentPackage.ts";
import type { DiagramFile } from "../src/domain/serialization.ts";

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const DOCUMENT = {
  schemaVersion: "0.7",
  title: "Shared architecture",
  nodes: [{ id: "n1", type: "typed", position: { x: 0, y: 0 }, data: { nodeType: "service", label: "Ledger" } }],
  edges: [],
  scenarios: [],
  requirements: { itemTypes: [], categories: [], items: [], relationshipTypes: [], relationships: [], nextSequence: {} },
  programIncrements: [],
  team: { members: [], settings: {} },
  milestones: [],
  metadata: { updatedAt: "2026-09-17T00:00:00.000Z" },
} as unknown as DiagramFile;

/** The store's enrolment surface, as a browser sees it. */
const apiFor = (client: StoreClient): EnrollmentApi => ({
  registerDevice: (publicKey, label) => client.registerDevice(publicKey, label),
  keysForDevice: (deviceId) => client.keysForDevice(deviceId),
  publishUserPublicKey: (publicKey) => client.publishUserPublicKey(publicKey),
  putWorkspaceKey: (generation, wrappedKey) => client.putWorkspaceKey(generation, wrappedKey),
  listDevices: () => client.listDevices(),
  approveDevice: (deviceId, code, wrapped, from) => client.approveDevice(deviceId, code, wrapped, from),
  setOwnUserKey: (deviceId, wrapped) => client.setOwnUserKey(deviceId, wrapped),
});

const blobs = createMemoryBlobStore();
const store = createDocumentService<MemoryTx>({
  blobs,
  begin: () => blobs.begin(),
  commit: (tx) => blobs.commit(tx),
  rollback: (tx) => blobs.rollback(tx),
}) as unknown as StoreBackend;

const recoveryPair = await generateWrappingKeyPair("recovery");
const recoveryPublicPem = toPem(await exportPublicKey(recoveryPair.publicKey), "PUBLIC KEY");
const idp = await startTestOidcProvider({ subject: "person-1" });
const sessions = createSessionStore();
const directory = createMemoryUserDirectory();
let origin = "";
const server = createHttpService({
  store,
  directory,
  sessions,
  workspaceIndex: createMemoryWorkspaceIndex(),
  providers: [createProvider({ id: "oidc", kind: "oidc", issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret })],
  publicUrl: () => origin,
  recoveryPublicKeyPem: recoveryPublicPem,
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

/** One browser: its own cookie jar and its own key storage. */
async function newBrowser() {
  let cookie = "";
  const client = createStoreClient({
    baseUrl: origin,
    fetch: async (input, init) => {
      const response = await fetch(input as string, {
        ...init,
        redirect: "manual",
        headers: { ...(cookie ? { cookie } : {}), ...(init?.headers ?? {}) },
      });
      const set = response.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      return response;
    },
  });
  // Sign in, as a person would.
  const start = await fetch(`${origin}/v1/auth/oidc/start`, { redirect: "manual" });
  const atProvider = await fetch(start.headers.get("location") ?? "", { redirect: "manual" });
  const callback = await fetch(atProvider.headers.get("location") ?? "", { redirect: "manual" });
  cookie = (callback.headers.get("set-cookie") ?? "").split(";")[0];
  return { client, storage: createMemoryDeviceKeyStorage(), api: apiFor(client) };
}

try {
  console.log("=== The first browser ===");
  const first = await newBrowser();
  check((await first.client.session())?.subject === "person-1", "signs in");
  const firstState = await bootstrapFirstDevice({ api: first.api, storage: first.storage, label: "Laptop" });
  check(firstState.status === "ready" && firstState.workspaceKey !== null, `makes the keys and is ready (${firstState.status}${firstState.message ? `: ${firstState.message}` : ""})`);

  const workspaceKey = firstState.workspaceKey!;
  const indexKey = await indexKeyFor(workspaceKey);
  const { documentKey, wrappedDocKey } = await newDocumentKey(workspaceKey);
  await first.client.putDocument("doc-shared", documentKey, DOCUMENT, {
    wrappedForWorkspace: wrappedDocKey,
    wrappedForRecovery: await escrowDocumentKey(documentKey, recoveryPublicPem),
  });
  await first.client.updateIndex("default", indexKey, (entries) =>
    upsertEntry(entries, { docId: "doc-shared", wrappedDocKey, title: DOCUMENT.title, updatedAt: new Date().toISOString() }),
  );
  check((await first.client.readIndex("default", indexKey)).entries.length === 1, "and saves a document to the workspace");

  console.log("\n=== Returning to the same browser ===");
  const again = await enrollDevice({ api: first.api, storage: first.storage });
  check(again.status === "ready", "it reuses its device rather than registering another");
  check(
    (await exportSymmetricKeyHex(again.workspaceKey!)) === (await exportSymmetricKeyHex(workspaceKey)),
    "and reaches the same workspace key"
  );
  check((await first.client.listDevices()).filter((device) => !device.revokedAt).length === 1, "still one device");

  console.log("\n=== A second browser ===");
  const second = await newBrowser();
  const waiting = await enrollDevice({ api: second.api, storage: second.storage, label: "Desktop" });
  check(waiting.status === "awaiting-approval", "registers and waits for approval (WS7-R11)");
  check(!!waiting.verificationCode && /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{3}$/.test(waiting.verificationCode), `showing a code to compare (${waiting.verificationCode})`);
  check(waiting.workspaceKey === null, "and holds no workspace key meanwhile");

  const listed = (await first.client.listDevices()).find((device) => device.deviceId === waiting.deviceId);
  check(listed?.verificationCode === waiting.verificationCode, "the first browser shows the same code for it");

  // The first browser approves it, wrapping the user key to the new device.
  const held = await first.storage.load();
  const firstKeys = await first.client.keysForDevice(held!.deviceId);
  if (firstKeys.status !== "approved") throw new Error("the first device should be approved");
  const userKey = await unwrapPrivateKeyWithPrivateKey(
    {
      keyWrap: Uint8Array.from(Buffer.from(firstKeys.wrappedUserKey.keyWrap, "base64")),
      body: Uint8Array.from(Buffer.from(firstKeys.wrappedUserKey.body, "base64")),
    },
    held!.keyPair.privateKey,
    { docId: "user-key", kind: "key-wrap", version: 1 },
  );
  await approveOtherDevice(
    { api: first.api, storage: first.storage, thisDeviceId: held!.deviceId, userKey },
    { deviceId: listed!.deviceId, publicKey: listed!.publicKey, verificationCode: listed!.verificationCode },
  );

  const approved = await enrollDevice({ api: second.api, storage: second.storage });
  check(approved.status === "ready", `the second browser becomes ready (${approved.status}${approved.message ? `: ${approved.message}` : ""})`);
  check(
    (await exportSymmetricKeyHex(approved.workspaceKey!)) === (await exportSymmetricKeyHex(workspaceKey)),
    "and reaches the same workspace key, without either browser sending it anywhere"
  );

  console.log("\n=== The second browser opens the document ===");
  const secondIndexKey = await indexKeyFor(approved.workspaceKey!);
  const entries = (await second.client.readIndex("default", secondIndexKey)).entries;
  check(entries.length === 1 && entries[0].title === "Shared architecture", "it lists the workspace by title");
  const opened = await second.client.getDocument(entries[0].docId, await documentKeyFor(entries[0], approved.workspaceKey!));
  check(JSON.stringify(opened.file) === JSON.stringify(DOCUMENT), "and opens the document the first browser saved");

  console.log("\n=== What the store saw ===");
  const served = JSON.stringify(await (await fetch(`${origin}/v1/docs/doc-shared`)).json());
  check(!served.includes("Shared architecture") && !served.includes("Ledger"), "no content, at any point in the exchange");
  const devices = JSON.stringify(await first.client.listDevices());
  check(!devices.includes(await exportSymmetricKeyHex(workspaceKey)), "and no workspace key among the device records");

  console.log("\n=== Revoking the second browser (WS7-R14) ===");
  await first.client.revokeDevice(waiting.deviceId!);
  const afterRevoke = await enrollDevice({ api: second.api, storage: second.storage });
  check(afterRevoke.status === "error", "it can no longer reach its keys");
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await idp.close();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll device identity checks passed.");
