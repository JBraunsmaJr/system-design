/**
 * The join commitment (WS14-R1, R22).
 *
 * Pinned test vectors, so the editor and the store - and any other client
 * someone writes later - agree on the exact bytes hashed. The expected value
 * is also recomputed independently with Node's own hash, so a change to the
 * shared module cannot quietly move both sides at once.
 */
import { createHash } from 'crypto';
import {
  JOIN_COMMITMENT_PATTERN,
  JOIN_COMMITMENT_TAG,
  joinCommitment,
  matchesJoinCommitment,
  newJoinSalt,
} from '../src/crypto/joinCommitment.ts';
import { exportPublicKey, generateWrappingKeyPair } from '../src/crypto/keys.ts';

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const spki = new Uint8Array(Array.from({ length: 64 }, (_, i) => i));
const salt = new Uint8Array(Array.from({ length: 32 }, (_, i) => 255 - i));

console.log('=== Test vectors ===');
{
  const independent = createHash('sha256')
    .update(JOIN_COMMITMENT_TAG)
    .update(Buffer.from([0]))
    .update(spki)
    .update(salt)
    .digest('base64url');
  const computed = await joinCommitment(spki, salt);
  check(computed === independent, 'matches an independent SHA-256 over tag ‖ 0x00 ‖ SPKI ‖ salt');
  check(
    computed === 'DF-BMv7dFe-eVNPSKs17MAS7bEWNyqSFxXbEjv1825Q',
    `pinned vector unchanged (${computed})`,
  );
  check(JOIN_COMMITMENT_PATTERN.test(computed), 'is 43 unpadded base64url characters');
}

console.log('\n=== Binding ===');
{
  const commitment = await joinCommitment(spki, salt);
  check(await matchesJoinCommitment(commitment, spki, salt), 'matches its own key and salt');
  const otherKey = spki.slice();
  otherKey[0] ^= 1;
  check(
    !(await matchesJoinCommitment(commitment, otherKey, salt)),
    'does not match a key differing by one bit',
  );
  const otherSalt = salt.slice();
  otherSalt[31] ^= 1;
  check(!(await matchesJoinCommitment(commitment, spki, otherSalt)), 'does not match another salt');
  check(!(await matchesJoinCommitment(undefined, spki, salt)), 'an absent nonce matches nothing');
  check(!(await matchesJoinCommitment(`${commitment}=`, spki, salt)), 'padding is not accepted');
  check(
    !(await matchesJoinCommitment(commitment, spki, salt.slice(0, 16))),
    'a short salt matches nothing rather than throwing',
  );
}

console.log('\n=== Inputs ===');
{
  let threw = false;
  try {
    await joinCommitment(spki, new Uint8Array(31));
  } catch {
    threw = true;
  }
  check(threw, 'refuses a salt that is not 32 bytes');
  threw = false;
  try {
    await joinCommitment(new Uint8Array(0), salt);
  } catch {
    threw = true;
  }
  check(threw, 'refuses an empty key');
  const a = newJoinSalt();
  const b = newJoinSalt();
  check(a.length === 32 && a.some((byte, i) => byte !== b[i]), 'fresh salts are 32 random bytes');
}

console.log('\n=== With a real user key ===');
{
  const pair = await generateWrappingKeyPair('user');
  const published = await exportPublicKey(pair.publicKey);
  const joinSalt = newJoinSalt();
  const commitment = await joinCommitment(published, joinSalt);
  check(
    await matchesJoinCommitment(commitment, published, joinSalt),
    'commits to the SPKI exactly as it is published',
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll join commitment checks passed.');
