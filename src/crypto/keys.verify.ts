/**
 * WS7 key material: derivation (R1, R2), the wrapping hierarchy (R3, R8),
 * escrow (R4), device verification codes (R11), and recovery codes (R12).
 */
import {
  PBKDF2_ITERATIONS,
  RSA_MODULUS_BITS,
  deriveStorageKey,
  generateWorkspaceKey,
  generateDocumentKeyHex,
  generateWrappingKeyPair,
  exportPublicKey,
  importPublicKey,
  wrapKey,
  unwrapKey,
  wrapKeyForPublicKey,
  unwrapKeyWithPrivateKey,
  wrapPrivateKeyForPublicKey,
  unwrapPrivateKeyWithPrivateKey,
  sealPrivateKey,
  openPrivateKey,
  generateRecoveryCode,
  parseRecoveryCode,
  deriveRecoveryKey,
  newRecoverySalt,
  deviceVerificationCode,
} from "./keys.ts";
import { createWebCryptoStorage } from "./storageCrypto.ts";
import type { BlobContext } from "./envelope.ts";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
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
const subtle = globalThis.crypto.subtle;
const rawOf = async (key: CryptoKey) => new Uint8Array(await subtle.exportKey("raw", key));
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const text = (value: string) => new TextEncoder().encode(value);
const CONTEXT: BlobContext = { docId: "doc-7", kind: "snapshot", version: 1 };

console.log("=== Storage key derivation (WS7-R1, R2) ===");
{
  const documentKey = "0f1e2d3c4b5a69788796a5b4c3d2e1f0"; // a link's key parameter
  const first = await deriveStorageKey(documentKey);
  const second = await deriveStorageKey(documentKey);
  assert(hex(await rawOf(first)) === hex(await rawOf(second)), "the same link always derives the same storage key");
  assert(hex(await rawOf(first)) !== documentKey, "and it is not the document key itself");
  assert((await rawOf(first)).length === 32, "it is a 256-bit key");
  const otherDocument = await deriveStorageKey("0f1e2d3c4b5a69788796a5b4c3d2e1f1");
  assert(hex(await rawOf(otherDocument)) !== hex(await rawOf(first)), "a different document key derives a different storage key");
  assert(
    hex(await rawOf(await deriveStorageKey("hunter2"))) !== hex(await rawOf(await deriveStorageKey("hunter3"))),
    "a legacy password-style link derives a key too (WS7-R2)"
  );
  assert(
    hex(await rawOf(await deriveStorageKey("0F1E2D3C4B5A69788796A5B4C3D2E1F0"))) === hex(await rawOf(first)),
    "hex case does not change the derivation"
  );
  // It is a real key: it seals and opens.
  const crypto = createWebCryptoStorage();
  const sealed = await crypto.seal(CONTEXT, text("secret plan"), first);
  assert(new TextDecoder().decode(await crypto.open(CONTEXT, sealed, second)) === "secret plan", "a blob sealed with it opens with a key derived elsewhere");
}

console.log("\n=== The wrapping hierarchy (WS7-R3, R8) ===");
{
  const workspaceKey = await generateWorkspaceKey();
  const documentKey = await deriveStorageKey(generateDocumentKeyHex());
  const wrapped = await wrapKey(documentKey, workspaceKey);
  const unwrapped = await unwrapKey(wrapped, workspaceKey, "AES-GCM");
  assert(hex(await rawOf(unwrapped)) === hex(await rawOf(documentKey)), "a document key wraps under the workspace key and comes back");
  assert(!hex(wrapped).includes(hex(await rawOf(documentKey))), "the wrap does not contain the key in the clear");
  const strangerWorkspace = await generateWorkspaceKey();
  await rejects(() => unwrapKey(wrapped, strangerWorkspace, "AES-GCM"), "another workspace key cannot unwrap it");

  const member = await generateWrappingKeyPair("user");
  const forMember = await wrapKeyForPublicKey(workspaceKey, member.publicKey);
  const backForMember = await unwrapKeyWithPrivateKey(forMember, member.privateKey, "AES-KW");
  assert(hex(await rawOf(backForMember)) === hex(await rawOf(workspaceKey)), "the workspace key wraps to a member's user key and comes back");
  const stranger = await generateWrappingKeyPair("user");
  await rejects(() => unwrapKeyWithPrivateKey(forMember, stranger.privateKey, "AES-KW"), "another member's key cannot unwrap it");
  assert((member.privateKey.algorithm as RsaHashedKeyAlgorithm).modulusLength === RSA_MODULUS_BITS, `keypairs are RSA-${RSA_MODULUS_BITS}`);
  const deviceKeyPair = await generateWrappingKeyPair("device");
  assert(deviceKeyPair.privateKey.extractable === false, "a device private key is non-extractable (WS7-R8)");
  await rejects(() => subtle.exportKey("pkcs8", deviceKeyPair.privateKey), "so it cannot be exported from the browser it was made in");
  assert(member.privateKey.extractable === true, "a user private key is extractable, because it is wrapped to each device");

  const device = await generateWrappingKeyPair("device");
  const userKeyContext: BlobContext = { docId: "user-1", kind: "key-wrap", version: 1 };
  const userKeyForDevice = await wrapPrivateKeyForPublicKey(member.privateKey, device.publicKey, userKeyContext);
  const recoveredUserKey = await unwrapPrivateKeyWithPrivateKey(userKeyForDevice, device.privateKey, userKeyContext);
  const viaDevice = await unwrapKeyWithPrivateKey(forMember, recoveredUserKey, "AES-KW");
  assert(hex(await rawOf(viaDevice)) === hex(await rawOf(workspaceKey)), "a new device unwraps the user key, and through it the workspace key (WS7-R8)");

  const publicAgain = await importPublicKey(await exportPublicKey(member.publicKey));
  const viaExported = await unwrapKeyWithPrivateKey(await wrapKeyForPublicKey(workspaceKey, publicAgain), member.privateKey, "AES-KW");
  assert(hex(await rawOf(viaExported)) === hex(await rawOf(workspaceKey)), "a public key survives export and import, as the store holds it");
}

console.log("\n=== Escrow (WS7-R4) ===");
{
  const recovery = await generateWrappingKeyPair("recovery"); // the organization's keypair
  const documentKey = await deriveStorageKey(generateDocumentKeyHex());
  const escrowed = await wrapKeyForPublicKey(documentKey, recovery.publicKey);
  const recoveredKey = await unwrapKeyWithPrivateKey(escrowed, recovery.privateKey, "AES-GCM");
  assert(hex(await rawOf(recoveredKey)) === hex(await rawOf(documentKey)), "the recovery key recovers a document key with no workspace key involved");
  const otherRecovery = await generateWrappingKeyPair("recovery");
  await rejects(() => unwrapKeyWithPrivateKey(escrowed, otherRecovery.privateKey, "AES-GCM"), "another keypair cannot open the escrow");
  const crypto = createWebCryptoStorage();
  const sealed = await crypto.seal(CONTEXT, text("recovered content"), documentKey);
  assert(
    new TextDecoder().decode(await crypto.open(CONTEXT, sealed, recoveredKey)) === "recovered content",
    "and content sealed for the store opens with the recovered key"
  );
}

console.log("\n=== Recovery code (WS7-R12) ===");
{
  const code = generateRecoveryCode();
  assert(code.secret.length === 16, "it carries 128 bits");
  assert(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{1,5})+$/.test(code.display), `it is shown in groups, without ambiguous letters (${code.display})`);
  assert(new Set(Array.from({ length: 50 }, () => generateRecoveryCode().display)).size === 50, "50 codes are distinct");

  const parsed = parseRecoveryCode(code.display);
  assert(parsed.ok && hex(parsed.secret) === hex(code.secret), "it parses back to the same 128 bits");
  assert(parseRecoveryCode(code.display.replace(/-/g, "").toLowerCase()).ok, "spacing, hyphens and case do not matter");
  assert(parseRecoveryCode(` ${code.display.replace(/-/g, " ")} `).ok, "spaces instead of hyphens are accepted");

  // Every single-symbol typo is reported as a typo, not attempted as an unlock.
  const symbols = code.display.replace(/-/g, "");
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let undetected = 0;
  for (let i = 0; i < symbols.length; i++) {
    for (const replacement of alphabet) {
      if (replacement === symbols[i]) continue;
      const typo = symbols.slice(0, i) + replacement + symbols.slice(i + 1);
      const result = parseRecoveryCode(typo);
      if (result.ok) undetected++;
    }
  }
  assert(undetected === 0, `all ${symbols.length * 31} single-symbol typos are caught by the checksum`);
  let transposed = 0;
  for (let i = 0; i < symbols.length - 1; i++) {
    if (symbols[i] === symbols[i + 1]) continue;
    const swapped = symbols.slice(0, i) + symbols[i + 1] + symbols[i] + symbols.slice(i + 2);
    if (parseRecoveryCode(swapped).ok) transposed++;
  }
  assert(transposed === 0, "and so are transposed neighbours");

  const empty = parseRecoveryCode("");
  assert(!empty.ok && empty.problem === "empty", "an empty entry says so");
  const short = parseRecoveryCode(symbols.slice(0, 10));
  assert(!short.ok && short.problem === "length", "a short entry is reported as the wrong length, not as a failed unlock");
  const foreign = parseRecoveryCode(`${symbols.slice(0, -1)}!`);
  assert(!foreign.ok && foreign.problem === "charset", "an impossible character is reported as such");
  // O for 0, I or L for 1: what people type.
  const substituted = symbols.replace(/0/g, "O").replace(/1/g, "I");
  assert(parseRecoveryCode(substituted).ok === parseRecoveryCode(symbols).ok, "letters people substitute for digits are accepted");

  // What the code actually unlocks: the user's private key, and through it
  // the workspace key - the route for someone with no enrolled device.
  const salt = newRecoverySalt();
  const key = await deriveRecoveryKey(code.secret, salt);
  const again = await deriveRecoveryKey(code.secret, salt);
  const user = await generateWrappingKeyPair("user");
  const workspaceKey = await generateWorkspaceKey();
  const workspaceForUser = await wrapKeyForPublicKey(workspaceKey, user.publicKey);
  const context: BlobContext = { docId: "user-2", kind: "key-wrap", version: 1 };
  const sealedUserKey = await sealPrivateKey(user.privateKey, key, context);
  const unlockedUserKey = await openPrivateKey(sealedUserKey, again, context);
  const workspaceViaCode = await unwrapKeyWithPrivateKey(workspaceForUser, unlockedUserKey, "AES-KW");
  assert(hex(await rawOf(workspaceViaCode)) === hex(await rawOf(workspaceKey)), "the code unlocks the user key, and through it the workspace key");
  const otherSaltKey = await deriveRecoveryKey(code.secret, newRecoverySalt());
  await rejects(() => openPrivateKey(sealedUserKey, otherSaltKey, context), "a different salt derives a different key");
  const otherCodeKey = await deriveRecoveryKey(generateRecoveryCode().secret, salt);
  await rejects(() => openPrivateKey(sealedUserKey, otherCodeKey, context), "and so does a different code");
  await rejects(() => openPrivateKey(sealedUserKey, again, { ...context, docId: "user-3" }), "a sealed user key cannot be replayed for another user");
  assert(PBKDF2_ITERATIONS >= 600_000, `derivation uses at least 600,000 iterations (${PBKDF2_ITERATIONS.toLocaleString()})`);
}

console.log("\n=== Device verification code (WS7-R11) ===");
{
  const device = await generateWrappingKeyPair("device");
  const spki = await exportPublicKey(device.publicKey);
  const shown = await deviceVerificationCode(spki);
  assert((await deviceVerificationCode(spki)) === shown, "both devices compute the same code from the same public key");
  assert(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{3}$/.test(shown), `it is short enough to read aloud (${shown})`);
  const impostor = await deviceVerificationCode(await exportPublicKey((await generateWrappingKeyPair("device")).publicKey));
  assert(impostor !== shown, "a substituted public key produces a different code, so approval fails");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
} else {
  console.log("\nAll key material checks passed.");
}
