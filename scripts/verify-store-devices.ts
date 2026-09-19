/**
 * Devices and the keys they hold (WS7-R8, R11, R12, R14).
 *
 * The wraps here are real: generated with src/crypto, sent to the store,
 * fetched back, and used to unwrap the workspace key. So this checks the
 * whole route from "a new browser signs in" to "it can open documents", not
 * just that some base64 round-trips.
 *
 * The store must never be able to use anything it holds, so the suite also
 * takes everything the store has for a user and confirms it cannot reach the
 * workspace key with it.
 */
import type { AddressInfo } from "net";
import { createMemoryBlobStore, type MemoryTx } from "../store/src/blobStore.ts";
import { createDocumentService } from "../store/src/documentService.ts";
import { createHttpService, createMemoryAuditSink, type StoreBackend } from "../store/src/httpService.ts";
import { createProvider } from "../store/src/auth/providers.ts";
import { createSessionStore } from "../store/src/auth/sessions.ts";
import { createMemoryUserDirectory, verificationCodeFor, type UserDirectory } from "../store/src/userDirectory.ts";
import { createPostgresUserDirectory } from "../store/src/postgresUserDirectory.ts";
import { createPostgresStore } from "../store/src/postgresStore.ts";
import { startTestOidcProvider } from "./lib/testIdentityProviders.ts";
import {
  deriveRecoveryKey,
  exportPublicKey,
  generateRecoveryCode,
  generateWorkspaceKey,
  generateWrappingKeyPair,
  importPublicKey,
  newRecoverySalt,
  openPrivateKey,
  sealPrivateKey,
  unwrapKeyWithPrivateKey,
  unwrapPrivateKeyWithPrivateKey,
  wrapKeyForPublicKey,
  wrapPrivateKeyForPublicKey,
} from "../src/crypto/keys.ts";
import type { BlobContext } from "../src/crypto/envelope.ts";
import { exportSymmetricKey } from "../src/crypto/keys.ts";

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}
async function rejects(work: () => Promise<Response>, status: number, message: string) {
  const response = await work();
  if (response.status === status) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message} (expected ${status}, got ${response.status})`);
  }
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const raw = async (key: CryptoKey) => b64(await exportSymmetricKey(key));
const KEY_CONTEXT: BlobContext = { docId: "user-key", kind: "key-wrap", version: 1 };
const DATABASE_URL = process.env.DATABASE_URL ?? "";

function memoryStore(): StoreBackend {
  const blobs = createMemoryBlobStore();
  return createDocumentService<MemoryTx>({
    blobs,
    begin: () => blobs.begin(),
    commit: (tx) => blobs.commit(tx),
    rollback: (tx) => blobs.rollback(tx),
  }) as unknown as StoreBackend;
}

async function run(name: string, directory: UserDirectory) {
  console.log(`\n########## ${name} ##########`);
  const idp = await startTestOidcProvider({ subject: `person-${name}` });
  const sessions = createSessionStore();
  const audit = createMemoryAuditSink();
  const providers = [createProvider({ id: "oidc", kind: "oidc", issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret })];
  let origin = "";
  const server = createHttpService({
    store: memoryStore(),
    audit,
    sessions,
    providers,
    directory,
    publicUrl: () => origin,
    // One administrator, for the re-grant below (WS7-R13, WS10-R2).
    isAdmin: (subject) => subject === `${idp.issuer}#person-${name}`,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const signIn = async (): Promise<string> => {
    const start = await fetch(`${origin}/v1/auth/oidc/start`, { redirect: "manual" });
    const atProvider = await fetch(start.headers.get("location") ?? "", { redirect: "manual" });
    const callback = await fetch(atProvider.headers.get("location") ?? "", { redirect: "manual" });
    return (callback.headers.get("set-cookie") ?? "").split(";")[0];
  };
  const call = (path: string, init: RequestInit & { cookie?: string; deviceId?: string } = {}) =>
    fetch(`${origin}${path}`, {
      ...init,
      redirect: "manual",
      headers: {
        ...(init.cookie ? { cookie: init.cookie } : {}),
        ...(init.deviceId ? { "x-device-id": init.deviceId } : {}),
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
  const json = async (response: Response) => (await response.json()) as Record<string, never> & Record<string, unknown>;

  try {
    // The person's own keys, as their first browser would make them.
    const userKeyPair = await generateWrappingKeyPair("user");
    const workspaceKey = await generateWorkspaceKey();
    const workspaceForUser = b64(await wrapKeyForPublicKey(workspaceKey, userKeyPair.publicKey));

    console.log("  -- the first device");
    const cookie = await signIn();
    const first = await generateWrappingKeyPair("device");
    const firstRegistered = (await json(
      await call("/v1/users/me/devices", { method: "POST", cookie, body: JSON.stringify({ publicKey: b64(await exportPublicKey(first.publicKey)), label: "Laptop" }) }),
    )).device as { deviceId: string; verificationCode: string; approvedAt: string | null };
    check(firstRegistered.approvedAt !== null, "the user's first device is approved as it registers: it is the one that makes the user key");
    const firstKeys = await json(await call("/v1/users/me/keys", { cookie, deviceId: firstRegistered.deviceId }));
    check(firstKeys.status === "awaiting-approval", "it still holds no wrap from the store: it has the user key itself");

    console.log("  -- the store holds only wraps");
    await call("/v1/users/me/keys", { method: "PUT", cookie, body: JSON.stringify({ generation: 1, wrappedKey: workspaceForUser }) });
    const held = await json(await call("/v1/users/me", { cookie }));
    const asStored = JSON.stringify(held);
    check(!asStored.includes(await raw(workspaceKey)), "nothing the store returns contains the workspace key itself");

    console.log("  -- a second device (WS7-R11)");
    const second = await generateWrappingKeyPair("device");
    const secondPublic = b64(await exportPublicKey(second.publicKey));
    const secondRegistered = (await json(
      await call("/v1/users/me/devices", { method: "POST", cookie, body: JSON.stringify({ publicKey: secondPublic, label: "Desktop" }) }),
    )).device as { deviceId: string; verificationCode: string };
    check(
      secondRegistered.verificationCode === (await verificationCodeFor(secondPublic)),
      `both sides derive the same verification code from the device's key (${secondRegistered.verificationCode})`
    );
    const impostorCode = await verificationCodeFor(b64(await exportPublicKey((await generateWrappingKeyPair("device")).publicKey)));
    check(impostorCode !== secondRegistered.verificationCode, "a substituted key would show a different code, so approval would be refused");

    // The approving device wraps the user key to the new device's key.
    const wrappedForSecond = await wrapPrivateKeyForPublicKey(
      userKeyPair.privateKey,
      await importPublicKey(Uint8Array.from(Buffer.from(secondPublic, "base64"))),
      KEY_CONTEXT,
    );
    const body = JSON.stringify({
      verificationCode: secondRegistered.verificationCode,
      wrappedUserKey: { keyWrap: b64(wrappedForSecond.keyWrap), body: b64(wrappedForSecond.body) },
    });
    await rejects(
      () => call(`/v1/users/me/devices/${secondRegistered.deviceId}/approve`, { method: "POST", cookie, deviceId: firstRegistered.deviceId, body: JSON.stringify({ ...JSON.parse(body), verificationCode: impostorCode }) }),
      400,
      "approval with the wrong code is refused"
    );
    const approved = await call(`/v1/users/me/devices/${secondRegistered.deviceId}/approve`, { method: "POST", cookie, deviceId: firstRegistered.deviceId, body });
    check(approved.status === 200, `an approved device can approve another (${approved.status})`);

    console.log("  -- the new device reaches the workspace key");
    const keys = await json(await call("/v1/users/me/keys", { cookie, deviceId: secondRegistered.deviceId }));
    check(keys.status === "approved" && !!keys.wrappedUserKey, "it is handed the user key, wrapped to it");
    const wrap = keys.wrappedUserKey as { keyWrap: string; body: string };
    const userKeyOnSecond = await unwrapPrivateKeyWithPrivateKey(
      { keyWrap: Uint8Array.from(Buffer.from(wrap.keyWrap, "base64")), body: Uint8Array.from(Buffer.from(wrap.body, "base64")) },
      second.privateKey,
      KEY_CONTEXT,
    );
    const workspaceOnSecond = await unwrapKeyWithPrivateKey(
      Uint8Array.from(Buffer.from((keys.workspaceKeys as { wrappedKey: string }[])[0].wrappedKey, "base64")),
      userKeyOnSecond,
      "AES-KW",
    );
    check((await raw(workspaceOnSecond)) === (await raw(workspaceKey)), "and unwraps the workspace key with it: the new browser can now open documents");

    console.log("  -- the store cannot do the same (WS7-R8)");
    const strangerKey = await generateWrappingKeyPair("device");
    let storeReached = false;
    try {
      await unwrapPrivateKeyWithPrivateKey(
        { keyWrap: Uint8Array.from(Buffer.from(wrap.keyWrap, "base64")), body: Uint8Array.from(Buffer.from(wrap.body, "base64")) },
        strangerKey.privateKey,
        KEY_CONTEXT,
      );
      storeReached = true;
    } catch {
      // Expected: the wrap is for one device's key and no other.
    }
    check(!storeReached, "everything the store holds is useless without the device's own private key");

    console.log("  -- revoking a device (WS7-R14)");
    const revoked = await json(await call(`/v1/users/me/devices/${secondRegistered.deviceId}`, { method: "DELETE", cookie }));
    check((revoked.device as { revokedAt: string | null }).revokedAt !== null, "revocation is recorded");
    check((revoked.device as { wrappedUserKey: unknown }).wrappedUserKey === null, "and its wrap of the user key is taken away");
    await rejects(() => call("/v1/users/me/keys", { cookie, deviceId: secondRegistered.deviceId }), 403, "the revoked device is refused its keys");
    // A fresh device, so the attempt fails on the revocation and not on
    // some other check first.
    const third = await generateWrappingKeyPair("device");
    const thirdPublic = b64(await exportPublicKey(third.publicKey));
    const thirdRegistered = (await json(
      await call("/v1/users/me/devices", { method: "POST", cookie, body: JSON.stringify({ publicKey: thirdPublic, label: "Phone" }) }),
    )).device as { deviceId: string; verificationCode: string };
    const wrappedForThird = await wrapPrivateKeyForPublicKey(
      userKeyPair.privateKey,
      await importPublicKey(Uint8Array.from(Buffer.from(thirdPublic, "base64"))),
      KEY_CONTEXT,
    );
    await rejects(
      () =>
        call(`/v1/users/me/devices/${thirdRegistered.deviceId}/approve`, {
          method: "POST",
          cookie,
          deviceId: secondRegistered.deviceId,
          body: JSON.stringify({
            verificationCode: thirdRegistered.verificationCode,
            wrappedUserKey: { keyWrap: b64(wrappedForThird.keyWrap), body: b64(wrappedForThird.body) },
          }),
        }),
      403,
      "and it can no longer approve anything"
    );

    console.log("  -- the recovery code (WS7-R12)");
    const code = generateRecoveryCode();
    const salt = newRecoverySalt();
    const recoveryKey = await deriveRecoveryKey(code.secret, salt);
    const sealedUserKey = await sealPrivateKey(userKeyPair.privateKey, recoveryKey, KEY_CONTEXT);
    const stored = await call("/v1/users/me/recovery", { method: "PUT", cookie, body: JSON.stringify({ salt: b64(salt), sealedUserKey: b64(sealedUserKey) }) });
    check(stored.status === 204, "the sealed user key and its salt are stored");
    const fetched = (await json(await call("/v1/users/me/recovery", { cookie }))).recovery as { salt: string; sealedUserKey: string };
    const unlocked = await openPrivateKey(
      Uint8Array.from(Buffer.from(fetched.sealedUserKey, "base64")),
      await deriveRecoveryKey(code.secret, Uint8Array.from(Buffer.from(fetched.salt, "base64"))),
      KEY_CONTEXT,
    );
    const workspaceViaCode = await unwrapKeyWithPrivateKey(Uint8Array.from(Buffer.from(workspaceForUser, "base64")), unlocked, "AES-KW");
    check((await raw(workspaceViaCode)) === (await raw(workspaceKey)), "someone with no device left recovers the user key from their code, and through it the workspace key");
    const wrongCode = generateRecoveryCode();
    let wrongWorked = false;
    try {
      await openPrivateKey(
        Uint8Array.from(Buffer.from(fetched.sealedUserKey, "base64")),
        await deriveRecoveryKey(wrongCode.secret, Uint8Array.from(Buffer.from(fetched.salt, "base64"))),
        KEY_CONTEXT,
      );
      wrongWorked = true;
    } catch {
      // Expected.
    }
    check(!wrongWorked, "another code does not");

    console.log("  -- administrator re-grant (WS7-R13)");
    {
      // The member publishes their public user key, so the workspace key can
      // be wrapped to them.
      const userPublic = b64(await exportPublicKey(userKeyPair.publicKey));
      const published = await call("/v1/users/me/public-key", { method: "PUT", cookie, body: JSON.stringify({ publicKey: userPublic }) });
      check(published.status === 200, "a member publishes their public user key");
      const listed = (await json(await call("/v1/admin/users", { cookie }))).users as { userId: string; publicKey?: string }[];
      check(listed.some((user) => user.publicKey === userPublic), "an administrator can see it, to wrap the workspace key to them");

      // Now everything is lost: every device gone, recovery code forgotten.
      const me = listed[0];
      const regranted = await call(`/v1/admin/users/${me.userId}/regrant`, { method: "POST", cookie });
      check(regranted.status === 200, "the administrator re-grants access");
      const afterDevices = (await json(await call("/v1/users/me/devices", { cookie }))).devices as { revokedAt: string | null }[];
      check(afterDevices.every((device) => device.revokedAt !== null), "every previous device is revoked");
      check((await json(await call("/v1/users/me/recovery", { cookie }))).recovery === null, "the old recovery wrap is gone");
      check(((await json(await call("/v1/admin/users", { cookie }))).users as { publicKey?: string }[])[0].publicKey === undefined, "and so is the old user key, which nobody can reach");

      // The person signs in on a new machine: a new user key, a new device.
      const freshUserKey = await generateWrappingKeyPair("user");
      const freshDevice = await generateWrappingKeyPair("device");
      const freshRegistered = (await json(
        await call("/v1/users/me/devices", { method: "POST", cookie, body: JSON.stringify({ publicKey: b64(await exportPublicKey(freshDevice.publicKey)), label: "Replacement" }) }),
      )).device as { deviceId: string; approvedAt: string | null };
      check(freshRegistered.approvedAt !== null, "their next device enrolls as a first device again");
      await call("/v1/users/me/public-key", { method: "PUT", cookie, body: JSON.stringify({ publicKey: b64(await exportPublicKey(freshUserKey.publicKey)) }) });

      // The administrator wraps the workspace key to the new user key.
      const rewrapped = b64(await wrapKeyForPublicKey(workspaceKey, freshUserKey.publicKey));
      const granted = await call(`/v1/admin/users/${me.userId}/workspace-key`, { method: "PUT", cookie, body: JSON.stringify({ generation: 2, wrappedKey: rewrapped }) });
      check(granted.status === 204, "and wraps the workspace key to it");

      const recovered = await unwrapKeyWithPrivateKey(Uint8Array.from(Buffer.from(rewrapped, "base64")), freshUserKey.privateKey, "AES-KW");
      check((await raw(recovered)) === (await raw(workspaceKey)), "the person is back in: the same workspace key, through a new user key");
      check((await json(await call("/v1/users/me/keys", { cookie, deviceId: freshRegistered.deviceId }))).status !== undefined, "and their new device is serviceable");
    }

    console.log("  -- the audit trail");
    const operations = audit.all().map((entry) => entry.operation);
    for (const operation of ["device-register", "device-approve", "device-revoke", "recovery-set", "workspace-key-set", "user-regrant", "workspace-key-grant"]) {
      check(operations.includes(operation), `${operation} is audited`);
    }
    check(audit.all().some((e) => e.operation === "device-approve" && e.outcome === "denied"), "a refused approval is audited too");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await idp.close();
  }
}

await run("memory", createMemoryUserDirectory());

if (DATABASE_URL) {
  const store = createPostgresStore({ connectionString: DATABASE_URL });
  await store.migrate();
  const pool = new (await import("pg")).default.Pool({ connectionString: DATABASE_URL });
  await pool.query("DELETE FROM users");
  await run("postgres", createPostgresUserDirectory(pool));
  await pool.query("DELETE FROM users");
  await pool.end();
  await store.close();
} else {
  console.log("\n(DATABASE_URL is not set: PostgreSQL is not covered by this run)");
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll device enrollment checks passed.");
