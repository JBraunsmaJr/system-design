/**
 * Recovery codes (WS7-R12), as a person meets them.
 *
 * A code is 128 bits written for reading aloud. It seals the person's own
 * user key under a key derived from it with 600,000 PBKDF2 iterations, and
 * the sealed result goes to the store. The code itself never does, in any
 * form - which is also why nobody can look it up for anyone.
 *
 * Using one on a new browser is a proof, not a password: the store sends a
 * secret encrypted to the person's public key, the browser opens it with
 * the private key the code unsealed, and the answer approves the browser.
 * A session alone - stolen or not - cannot produce that answer.
 */
import {
  deriveRecoveryKey,
  exportSymmetricKeyHex,
  generateRecoveryCode,
  newRecoverySalt,
  openPrivateKey,
  parseRecoveryCode,
  sealPrivateKey,
  unwrapKeyWithPrivateKey,
  wrapPrivateKeyForPublicKey,
} from '../crypto/keys.ts';
import type { BlobContext } from '../crypto/envelope.ts';
import type { DeviceKeyStorage } from './deviceIdentity.ts';
import type { StoreClient } from './storeClient.ts';
import { fromBase64, toBase64 } from './workspaceDocuments.ts';

const KEY_CONTEXT: BlobContext = { docId: 'user-key', kind: 'key-wrap', version: 1 };

/**
 * Makes a new code for this person and stores their user key sealed under
 * it. Replaces any earlier code: only the newest one works afterwards.
 * Returns the code for showing once.
 */
export async function createRecoveryCode(client: StoreClient, userKey: CryptoKey): Promise<string> {
  const code = generateRecoveryCode();
  const salt = newRecoverySalt();
  const sealed = await sealPrivateKey(
    userKey,
    await deriveRecoveryKey(code.secret, salt),
    KEY_CONTEXT,
  );
  await client.putRecovery(toBase64(salt), toBase64(sealed));
  return code.display;
}

export type RecoveryOutcome =
  | { ok: true }
  | { ok: false; reason: 'malformed' | 'wrong-code' | 'no-code-set' | 'refused'; message: string };

/**
 * Approves this browser with a recovery code. The browser must already be
 * registered (awaiting approval); on success it holds the user key and the
 * next enrolment reaches the workspace key as usual.
 */
export async function recoverWithCode(
  client: StoreClient,
  storage: DeviceKeyStorage,
  typed: string,
): Promise<RecoveryOutcome> {
  const parsed = parseRecoveryCode(typed);
  if (!parsed.ok) {
    // Named, because each has a different fix: a typo shows as the
    // checksum, a missing group as the length.
    const why =
      parsed.problem === 'checksum'
        ? 'One of the characters is wrong - the code checks itself, and this one does not add up.'
        : parsed.problem === 'length'
          ? 'It is the wrong length. A recovery code is 28 characters, in groups of five.'
          : parsed.problem === 'charset'
            ? 'It contains a character recovery codes never use.'
            : 'Type the code first.';
    return { ok: false, reason: 'malformed', message: why };
  }
  const secret = parsed.secret;
  const held = await storage.load();
  if (!held)
    return {
      ok: false,
      reason: 'refused',
      message: 'This browser is not registered yet. Reload and try again.',
    };

  const recovery = await client.getRecovery();
  if (!recovery) {
    return {
      ok: false,
      reason: 'no-code-set',
      message:
        'No recovery code was ever created for your account. An administrator can restore your access.',
    };
  }

  let userKey: CryptoKey;
  try {
    userKey = await openPrivateKey(
      fromBase64(recovery.sealedUserKey),
      await deriveRecoveryKey(secret, fromBase64(recovery.salt)),
      KEY_CONTEXT,
    );
  } catch {
    // The checksum passed, so this is a real code - just not this
    // person's current one. Usually an older code, replaced since.
    return {
      ok: false,
      reason: 'wrong-code',
      message:
        'That code does not open your keys. If you have created a new code since, use that one.',
    };
  }

  // Proof that this browser holds the key, answered without sending it.
  const challenge = await client.recoveryChallenge(held.deviceId);
  const answer = await exportSymmetricKeyHex(
    await unwrapKeyWithPrivateKey(fromBase64(challenge.wrapped), userKey, 'AES-GCM', 256),
  );
  const wrapped = await wrapPrivateKeyForPublicKey(userKey, held.keyPair.publicKey, KEY_CONTEXT);
  try {
    await client.recoverDevice(held.deviceId, challenge.challengeId, answer, {
      keyWrap: toBase64(wrapped.keyWrap),
      body: toBase64(wrapped.body),
    });
  } catch {
    return {
      ok: false,
      reason: 'refused',
      message: 'The workspace refused this recovery. Try again.',
    };
  }
  return { ok: true };
}
