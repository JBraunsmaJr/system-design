/**
 * WS6 — the encryption seam, and WS12-R3's requirement that altering any byte
 * of a sealed blob makes it fail to open.
 */
import {
  ALG_AES_256_GCM,
  ALG_NONE,
  ENVELOPE_VERSION,
  KNOWN_ENVELOPE_VERSIONS,
  EnvelopeError,
  IV_BYTES,
  KDF_HKDF_SHA256,
  KDF_NONE,
  assemble,
  authenticatedData,
  buildHeader,
  needsReseal,
  parseEnvelope,
  type BlobContext,
} from './envelope.ts';
import {
  createPassthroughStorage,
  createStorageCrypto,
  createWebCryptoStorage,
  OpenError,
} from './storageCrypto.ts';
import { randomBytes, randomHex } from './random.ts';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}
async function rejects(
  work: () => Promise<unknown>,
  message: string,
  check?: (error: unknown) => boolean,
) {
  try {
    await work();
    failures++;
    console.error(`  FAIL: ${message} (it succeeded)`);
  } catch (error) {
    if (check && !check(error)) {
      failures++;
      console.error(`  FAIL: ${message} (wrong error: ${String(error).slice(0, 90)})`);
    } else {
      console.log(`  ✓ ${message}`);
    }
  }
}

const text = (value: string) => new TextEncoder().encode(value);
const readable = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const CONTEXT: BlobContext = { docId: 'doc-1', kind: 'snapshot', version: 3 };
const PLAINTEXT = text('the quick brown fox jumps over the lazy dog');

console.log('=== Envelope structure ===');
{
  const header = buildHeader({
    formatVersion: ENVELOPE_VERSION,
    algorithm: ALG_AES_256_GCM,
    kdf: KDF_NONE,
    kdfParams: new Uint8Array(0),
  });
  const blob = assemble(header, randomBytes(IV_BYTES), text('body'));
  const parsed = parseEnvelope(blob);
  assert(
    parsed.formatVersion === ENVELOPE_VERSION &&
      parsed.algorithm === ALG_AES_256_GCM &&
      parsed.kdf === KDF_NONE,
    'a header round-trips',
  );
  assert(
    parsed.iv.length === IV_BYTES && readable(parsed.body) === 'body',
    'the IV and body are recovered exactly',
  );
  assert(!needsReseal(blob), 'a current-version blob does not need re-sealing');

  const withKdf = buildHeader({
    formatVersion: ENVELOPE_VERSION,
    algorithm: ALG_AES_256_GCM,
    kdf: KDF_HKDF_SHA256,
    kdfParams: text('salt-and-info'),
  });
  const parsedKdf = parseEnvelope(assemble(withKdf, randomBytes(IV_BYTES), text('x')));
  assert(
    parsedKdf.kdf === KDF_HKDF_SHA256 && readable(parsedKdf.kdfParams) === 'salt-and-info',
    'KDF parameters round-trip',
  );

  assert(
    KNOWN_ENVELOPE_VERSIONS.has(ENVELOPE_VERSION) &&
      Math.max(...KNOWN_ENVELOPE_VERSIONS) === ENVELOPE_VERSION,
    'the current version is the newest known one, so nothing needs re-sealing yet',
  );
  const unknown = new Uint8Array(blob);
  unknown[4] = ENVELOPE_VERSION + 1;
  assert(!needsReseal(unknown), 'a blob this build cannot read is not offered for re-sealing');
}

console.log('\n=== Envelope rejection ===');
{
  const header = buildHeader({
    formatVersion: ENVELOPE_VERSION,
    algorithm: ALG_AES_256_GCM,
    kdf: KDF_NONE,
    kdfParams: new Uint8Array(0),
  });
  const blob = assemble(header, randomBytes(IV_BYTES), text('body'));
  const reasonOf = (work: () => unknown): string => {
    try {
      work();
      return 'no error';
    } catch (error) {
      return error instanceof EnvelopeError ? error.reason : `other: ${String(error)}`;
    }
  };
  assert(
    reasonOf(() => parseEnvelope(text('not an envelope at all, but long enough to pass'))) ===
      'not-an-envelope',
    'foreign bytes are rejected as not an envelope',
  );
  assert(
    reasonOf(() => parseEnvelope(blob.slice(0, 8))) === 'truncated',
    'a truncated blob is rejected',
  );
  const newer = new Uint8Array(blob);
  newer[4] = ENVELOPE_VERSION + 1;
  assert(
    reasonOf(() => parseEnvelope(newer)) === 'unsupported-version',
    'a newer format version is named as such, not treated as corruption',
  );
  const unknownAlg = new Uint8Array(blob);
  unknownAlg[5] = 99;
  assert(
    reasonOf(() => parseEnvelope(unknownAlg)) === 'unsupported-algorithm',
    'an unknown algorithm is rejected',
  );
  const lying = new Uint8Array(blob);
  lying[7] = 0xff; // claims a huge KDF parameter block
  assert(
    reasonOf(() => parseEnvelope(lying)) === 'truncated',
    'a header claiming more bytes than exist is rejected',
  );
  for (const bad of [
    { docId: '', kind: 'snapshot', version: 1 },
    { docId: 'd', kind: '', version: 1 },
    { docId: 'd', kind: 'snapshot', version: -1 },
    { docId: 'd', kind: 'snapshot', version: 1.5 },
  ]) {
    assert(
      reasonOf(() => authenticatedData(header, bad as BlobContext)) === 'invalid-context',
      `an invalid context is rejected (${JSON.stringify(bad)})`,
    );
  }
  // Length-prefixed fields: ("ab","c") must not authenticate as ("a","bc").
  const left = authenticatedData(header, {
    docId: 'ab',
    kind: 'c' as BlobContext['kind'],
    version: 1,
  });
  const right = authenticatedData(header, {
    docId: 'a',
    kind: 'bc' as BlobContext['kind'],
    version: 1,
  });
  assert(
    readable(left) !== readable(right),
    'context fields cannot be confused across their boundaries',
  );
}

console.log('\n=== webcrypto mode ===');
{
  const crypto = createWebCryptoStorage();
  const key = await crypto.generateContentKey();
  const other = await crypto.generateContentKey();
  const sealed = await crypto.seal(CONTEXT, PLAINTEXT, key);

  assert(
    crypto.mode === 'webcrypto' && createStorageCrypto().mode === 'webcrypto',
    'webcrypto is the default mode (WS6-R2)',
  );
  assert(
    readable(await crypto.open(CONTEXT, sealed, key)) === readable(PLAINTEXT),
    'a sealed blob opens again',
  );
  assert(!readable(sealed).includes('quick brown fox'), 'the plaintext is not present in the blob');
  assert(parseEnvelope(sealed).algorithm === ALG_AES_256_GCM, 'sealed with AES-256-GCM');
  assert(
    parseEnvelope(sealed).body.length === PLAINTEXT.length + 16,
    'the body carries the 128-bit GCM tag',
  );

  await rejects(
    () => crypto.open(CONTEXT, sealed, other),
    'the wrong key cannot open it',
    (e) => e instanceof OpenError && e.reason === 'wrong-key-or-tampered',
  );

  // WS12-R3: every byte is covered.
  let missed = 0;
  for (let i = 0; i < sealed.length; i++) {
    const damaged = new Uint8Array(sealed);
    damaged[i] ^= 0x01;
    try {
      await crypto.open(CONTEXT, damaged, key);
      missed++;
    } catch {
      // Expected: either the envelope is malformed or authentication fails.
    }
  }
  assert(
    missed === 0,
    `flipping any one of the ${sealed.length} bytes makes it fail to open (WS12-R3)`,
  );

  // The bound context (WS6-R4).
  for (const wrong of [
    { ...CONTEXT, docId: 'doc-2' },
    { ...CONTEXT, kind: 'update' as const },
    { ...CONTEXT, version: 2 },
    { ...CONTEXT, version: 4 },
  ]) {
    await rejects(
      () => crypto.open(wrong, sealed, key),
      `a blob cannot be replayed as ${JSON.stringify(wrong)}`,
      (e) => e instanceof OpenError && e.reason === 'wrong-key-or-tampered',
    );
  }

  // WS6-R6: never the same IV twice.
  const hex = (bytes: Uint8Array) =>
    Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const ivs = new Set<string>();
  for (let i = 0; i < 200; i++) {
    ivs.add(hex(parseEnvelope(await crypto.seal(CONTEXT, PLAINTEXT, key)).iv));
  }
  assert(ivs.size === 200, '200 seals produce 200 distinct IVs (WS6-R6)');
  await rejects(
    () => crypto.seal(CONTEXT, PLAINTEXT, null),
    'sealing without a key fails',
    (e) => e instanceof OpenError && e.reason === 'missing-key',
  );
}

console.log('\n=== passthrough mode ===');
{
  const plain = createPassthroughStorage();
  const sealed = await plain.seal(CONTEXT, PLAINTEXT, null);
  assert(
    plain.mode === 'passthrough' && createStorageCrypto('passthrough').mode === 'passthrough',
    'selected by configuration alone (WS6-R2)',
  );
  assert(
    readable(await plain.open(CONTEXT, sealed, null)) === readable(PLAINTEXT),
    'a blob round-trips',
  );
  assert(
    readable(sealed).includes('quick brown fox'),
    'the content is readable in the blob - which is what this mode means',
  );
  assert(
    parseEnvelope(sealed).algorithm === ALG_NONE,
    'the envelope says so, so a reader can tell',
  );

  // Same interface, same failures for a caller that is wrong either way.
  await rejects(
    () => plain.seal({ ...CONTEXT, docId: '' }, PLAINTEXT, null),
    'an invalid context fails in this mode too',
    (e) => e instanceof EnvelopeError,
  );

  const encrypting = createWebCryptoStorage();
  const key = await encrypting.generateContentKey();
  const encrypted = await encrypting.seal(CONTEXT, PLAINTEXT, key);
  await rejects(
    () => plain.open(CONTEXT, encrypted, null),
    'an encrypted blob is reported, not mangled',
    (e) => e instanceof OpenError && e.reason === 'mode-mismatch',
  );
  await rejects(
    () => encrypting.open(CONTEXT, sealed, key),
    'and a passthrough blob is reported to an encrypting reader',
    (e) => e instanceof OpenError && e.reason === 'mode-mismatch',
  );
}

console.log('\n=== Random material ===');
{
  assert(randomBytes(32).length === 32 && randomHex(16).length === 32, 'lengths are as asked');
  assert(
    new Set(Array.from({ length: 100 }, () => randomHex(16))).size === 100,
    '100 draws are distinct',
  );
  assert(/^[0-9a-f]+$/.test(randomHex(8)), 'hex output is lowercase hex');
  for (const bad of [0, -1, 1.5]) {
    let threw = false;
    try {
      randomBytes(bad);
    } catch {
      threw = true;
    }
    assert(threw, `a length of ${bad} is refused`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
} else {
  console.log('\nAll storage crypto checks passed.');
}
