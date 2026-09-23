import { generateKeyPairSync, createSign, type KeyPairSyncResult } from 'crypto';

function derLen(len: number): Buffer {
  if (len < 128) return Buffer.from([len]);
  const bytes: number[] = [];
  let temp = len;
  while (temp > 0) {
    bytes.unshift(temp & 0xff);
    temp >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTag(tag: number, ...contents: Buffer[]): Buffer {
  const body = Buffer.concat(contents);
  return Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
}

function derSeq(...contents: Buffer[]): Buffer {
  return derTag(0x30, ...contents);
}

function derSet(...contents: Buffer[]): Buffer {
  return derTag(0x31, ...contents);
}

function derInt(num: number | Buffer): Buffer {
  if (typeof num === 'number') {
    if (num < 128) return Buffer.from([0x02, 1, num]);
    return Buffer.from([0x02, 2, (num >> 8) & 0xff, num & 0xff]);
  }
  return Buffer.concat([Buffer.from([0x02]), derLen(num.length), num]);
}

function derOid(str: string): Buffer {
  const parts = str.split('.').map(Number);
  const first = parts[0] * 40 + parts[1];
  const bytes = [first];
  for (let i = 2; i < parts.length; i++) {
    let val = parts[i];
    const sub: number[] = [];
    sub.push(val & 0x7f);
    while ((val >>= 7) > 0) {
      sub.unshift(0x80 | (val & 0x7f));
    }
    bytes.push(...sub);
  }
  return derTag(0x06, Buffer.from(bytes));
}

function derUtf8(str: string): Buffer {
  return derTag(0x0c, Buffer.from(str, 'utf8'));
}

function derUtcTime(date: Date): Buffer {
  const pad = (n: number) => String(n).padStart(2, '0');
  const str =
    pad(date.getUTCFullYear() % 100) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z';
  return derTag(0x17, Buffer.from(str, 'ascii'));
}

export interface GeneratedCertPair {
  certPem: string;
  keyPem: string;
  keyPair: KeyPairSyncResult<string, string>;
}

export function generateTestCertificate(options: {
  commonName: string;
  sanHosts?: string[];
  daysValid?: number;
  expired?: boolean;
}): GeneratedCertPair {
  const keyPair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const rawKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spkiDer = rawKeys.publicKey.export({ type: 'spki', format: 'der' });

  const commonNameAttr = derSeq(derOid('2.5.4.3'), derUtf8(options.commonName));
  const name = derSeq(derSet(commonNameAttr));

  const now = Date.now();
  let validFrom: Date;
  let validTo: Date;

  if (options.expired) {
    validFrom = new Date(now - 60 * 24 * 3600 * 1000);
    validTo = new Date(now - 10 * 24 * 3600 * 1000);
  } else {
    validFrom = new Date(now - 3600 * 1000);
    validTo = new Date(now + (options.daysValid ?? 365) * 24 * 3600 * 1000);
  }

  const validity = derSeq(derUtcTime(validFrom), derUtcTime(validTo));
  const sigAlg = derSeq(derOid('1.2.840.113549.1.1.11'), Buffer.from([0x05, 0x00]));

  const sans = options.sanHosts || [options.commonName];
  const sanTags = sans.map((h) => derTag(0x82, Buffer.from(h)));
  const sanSeq = derSeq(...sanTags);
  const sanExt = derSeq(derOid('2.5.29.17'), derTag(0x04, sanSeq));
  const extensions = derTag(0xa3, derSeq(sanExt));

  const version = derTag(0xa0, derInt(2));
  const serial = derInt(Buffer.from([0x01, 0x23, 0x45, 0x67]));
  const tbs = derSeq(version, serial, sigAlg, name, validity, name, spkiDer, extensions);

  const signer = createSign('SHA256');
  signer.update(tbs);
  const signature = signer.sign(rawKeys.privateKey);
  const sigBitString = Buffer.concat([
    Buffer.from([0x03]),
    derLen(signature.length + 1),
    Buffer.from([0x00]),
    signature,
  ]);

  const certDer = derSeq(tbs, sigAlg, sigBitString);
  const certPem =
    '-----BEGIN CERTIFICATE-----\n' +
    (certDer.toString('base64').match(/.{1,64}/g) || []).join('\n') +
    '\n-----END CERTIFICATE-----\n';

  const keyPem = rawKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

  return {
    certPem,
    keyPem,
    keyPair,
  };
}
