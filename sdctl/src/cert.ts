import {
  X509Certificate,
  createPrivateKey,
  generateKeyPairSync,
  createSign,
  randomBytes,
} from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export interface CertValidationOptions {
  certPath: string;
  keyPath: string;
  caPath?: string;
  expectedHostnames?: string[];
  warnDaysThreshold?: number;
}

export interface CertValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
  details: {
    subject?: string;
    issuer?: string;
    validFrom?: string;
    validTo?: string;
    daysRemaining?: number;
    sans?: string[];
    keyType?: string;
  };
}

export interface GenerateCertOptions {
  commonName: string;
  sans?: string[];
  validityDays?: number;
  certPath?: string;
  keyPath?: string;
}

export interface GenerateCertResult {
  certPem: string;
  keyPem: string;
  certPath?: string;
  keyPath?: string;
}

function encodeDerLength(len: number): Buffer {
  if (len < 128) return Buffer.from([len]);
  const bytes: number[] = [];
  let temp = len;
  while (temp > 0) {
    bytes.unshift(temp & 0xff);
    temp >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTag(tag: number, content: Buffer): Buffer {
  const len = encodeDerLength(content.length);
  return Buffer.concat([Buffer.from([tag]), len, content]);
}

function derSeq(...items: Buffer[]): Buffer {
  return derTag(0x30, Buffer.concat(items));
}

function derSet(...items: Buffer[]): Buffer {
  return derTag(0x31, Buffer.concat(items));
}

function derInt(val: number | bigint | Buffer): Buffer {
  let buf: Buffer;
  if (typeof val === 'number' || typeof val === 'bigint') {
    let hex = val.toString(16);
    if (hex.length % 2 !== 0) hex = '0' + hex;
    buf = Buffer.from(hex, 'hex');
  } else {
    buf = Buffer.isBuffer(val) ? val : Buffer.from(val);
  }
  if (buf.length === 0) buf = Buffer.from([0x00]);
  if (buf[0] & 0x80) buf = Buffer.concat([Buffer.from([0x00]), buf]);
  return derTag(0x02, buf);
}

function derOid(oidStr: string): Buffer {
  const parts = oidStr.split('.').map(Number);
  const bytes = [parts[0] * 40 + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i];
    const sub: number[] = [];
    sub.push(v & 0x7f);
    v >>= 7;
    while (v > 0) {
      sub.unshift(0x80 | (v & 0x7f));
      v >>= 7;
    }
    bytes.push(...sub);
  }
  return derTag(0x06, Buffer.from(bytes));
}

function derUtf8Str(str: string): Buffer {
  return derTag(0x0c, Buffer.from(str, 'utf8'));
}

function derUtcTime(date: Date): Buffer {
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = String(date.getUTCFullYear()).slice(-2);
  const str =
    year +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z';
  return derTag(0x17, Buffer.from(str, 'ascii'));
}

function derNull(): Buffer {
  return Buffer.from([0x05, 0x00]);
}

function derBitString(buf: Buffer, unusedBits = 0): Buffer {
  return derTag(0x03, Buffer.concat([Buffer.from([unusedBits]), buf]));
}

function derOctetString(buf: Buffer): Buffer {
  return derTag(0x04, buf);
}

export function generateSelfSignedCertificate(options: GenerateCertOptions): GenerateCertResult {
  const cn = options.commonName.trim() || 'localhost';
  const validityDays = options.validityDays ?? 365;

  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const sha256WithRSA = derSeq(derOid('1.2.840.113549.1.1.11'), derNull());

  // Subject / Issuer RDN
  const commonNameRdn = derSet(derSeq(derOid('2.5.4.3'), derUtf8Str(cn)));
  const orgRdn = derSet(derSeq(derOid('2.5.4.10'), derUtf8Str('System Design Self-Signed')));
  const nameSeq = derSeq(orgRdn, commonNameRdn);

  const now = new Date();
  const notBefore = new Date(now.getTime() - 60000); // 1 min buffer
  const notAfter = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);
  const validity = derSeq(derUtcTime(notBefore), derUtcTime(notAfter));

  // Extensions
  const extList: Buffer[] = [];
  // Basic Constraints (cA = false)
  extList.push(derSeq(derOid('2.5.29.19'), derOctetString(derSeq())));

  // Key Usage: digitalSignature (bit 0), keyEncipherment (bit 2) -> 10100000 = 0xA0 with 5 unused bits
  extList.push(derSeq(derOid('2.5.29.15'), derOctetString(derBitString(Buffer.from([0xa0]), 5))));

  // Extended Key Usage: serverAuth, clientAuth
  extList.push(
    derSeq(
      derOid('2.5.29.37'),
      derOctetString(derSeq(derOid('1.3.6.1.5.5.7.3.1'), derOid('1.3.6.1.5.5.7.3.2'))),
    ),
  );

  // Subject Alternative Names (SAN)
  const sanList: string[] = [cn];
  if (options.sans) {
    for (const s of options.sans) {
      if (s && !sanList.includes(s)) sanList.push(s);
    }
  }

  const sanEntries: Buffer[] = [];
  for (const name of sanList) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(trimmed)) {
      const ipBytes = Buffer.from(trimmed.split('.').map(Number));
      sanEntries.push(derTag(0x87, ipBytes)); // [7] IPAddress
    } else {
      sanEntries.push(derTag(0x82, Buffer.from(trimmed, 'ascii'))); // [2] dNSName
    }
  }

  if (sanEntries.length > 0) {
    extList.push(derSeq(derOid('2.5.29.17'), derOctetString(derSeq(...sanEntries))));
  }

  const extensionsTag = derTag(0xa3, derSeq(...extList));
  const serial = randomBytes(16);
  const version = derTag(0xa0, derInt(2)); // v3 = integer 2

  const tbs = derSeq(
    version,
    derInt(serial),
    sha256WithRSA,
    nameSeq,
    validity,
    nameSeq,
    publicKey,
    extensionsTag,
  );

  const signer = createSign('SHA256');
  signer.update(tbs);
  const signature = signer.sign(privateKey);

  const certDer = derSeq(tbs, sha256WithRSA, derBitString(signature));

  const pemBase64 =
    certDer
      .toString('base64')
      .match(/.{1,64}/g)
      ?.join('\n') || '';
  const certPem = `-----BEGIN CERTIFICATE-----\n${pemBase64}\n-----END CERTIFICATE-----\n`;

  if (options.certPath) {
    mkdirSync(dirname(options.certPath), { recursive: true });
    writeFileSync(options.certPath, certPem, 'utf8');
  }
  if (options.keyPath) {
    mkdirSync(dirname(options.keyPath), { recursive: true });
    writeFileSync(options.keyPath, privateKey, { encoding: 'utf8', mode: 0o600 });
  }

  return {
    certPem,
    keyPem: privateKey,
    certPath: options.certPath,
    keyPath: options.keyPath,
  };
}

export function validateCertificates(options: CertValidationOptions): CertValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const details: CertValidationResult['details'] = {};
  const warnThreshold = options.warnDaysThreshold ?? 30;

  if (!existsSync(options.certPath)) {
    errors.push(`Certificate file does not exist at '${options.certPath}'`);
    return { valid: false, warnings, errors, details };
  }
  if (!existsSync(options.keyPath)) {
    errors.push(`Private key file does not exist at '${options.keyPath}'`);
    return { valid: false, warnings, errors, details };
  }

  let certPem: string;
  let keyPem: string;
  try {
    certPem = readFileSync(options.certPath, 'utf8');
  } catch (err) {
    errors.push(`Failed to read certificate file: ${(err as Error).message}`);
    return { valid: false, warnings, errors, details };
  }

  try {
    keyPem = readFileSync(options.keyPath, 'utf8');
  } catch (err) {
    errors.push(`Failed to read private key file: ${(err as Error).message}`);
    return { valid: false, warnings, errors, details };
  }

  let cert: X509Certificate;
  try {
    cert = new X509Certificate(certPem);
    details.subject = cert.subject;
    details.issuer = cert.issuer;
    details.validFrom = cert.validFrom;
    details.validTo = cert.validTo;

    const expiryDate = new Date(cert.validTo);
    const now = new Date();
    const msDiff = expiryDate.getTime() - now.getTime();
    const daysRemaining = Math.floor(msDiff / (1000 * 60 * 60 * 24));
    details.daysRemaining = daysRemaining;

    if (daysRemaining <= 0) {
      errors.push(`Certificate expired on ${cert.validTo} (${Math.abs(daysRemaining)} days ago)`);
    } else if (daysRemaining < warnThreshold) {
      warnings.push(
        `Certificate expires soon: ${daysRemaining} days remaining (threshold: ${warnThreshold} days)`,
      );
    }

    // SAN extraction
    const rawSans = cert.subjectAltName || '';
    const sans: string[] = [];
    for (const part of rawSans.split(',')) {
      const trimmed = part.trim();
      if (trimmed.startsWith('DNS:')) {
        sans.push(trimmed.slice(4).trim().toLowerCase());
      } else if (trimmed.startsWith('IP Address:')) {
        sans.push(trimmed.slice(11).trim().toLowerCase());
      } else if (trimmed) {
        sans.push(trimmed.toLowerCase());
      }
    }
    details.sans = sans;

    // Check hostnames match SANs
    if (options.expectedHostnames && options.expectedHostnames.length > 0) {
      for (const expected of options.expectedHostnames) {
        const host = expected.trim().toLowerCase();
        if (!host || host === 'localhost' || host === '127.0.0.1') continue;

        const matched = sans.some((san) => {
          if (san === host) return true;
          if (san.startsWith('*.')) {
            const domain = san.slice(2);
            return host.endsWith(domain) && host.split('.').length === domain.split('.').length + 1;
          }
          return false;
        });

        if (!matched && !cert.subject.toLowerCase().includes(`cn=${host}`)) {
          errors.push(
            `Certificate does not cover expected hostname '${host}'. Subject SANs are: [${sans.join(', ')}]`,
          );
        }
      }
    }
  } catch (err) {
    errors.push(`Failed to parse certificate: ${(err as Error).message}`);
    return { valid: false, warnings, errors, details };
  }

  // Validate private key matches cert
  try {
    const key = createPrivateKey(keyPem);
    details.keyType = key.asymmetricKeyType;
    const matches = cert.checkPrivateKey(key);
    if (!matches) {
      errors.push('Private key does not match the provided certificate public key.');
    }
  } catch (err) {
    errors.push(`Failed to parse private key or verify match: ${(err as Error).message}`);
  }

  // Validate CA if provided
  if (options.caPath) {
    if (!existsSync(options.caPath)) {
      errors.push(`CA certificate file does not exist at '${options.caPath}'`);
    } else {
      try {
        const caPem = readFileSync(options.caPath, 'utf8');
        const caCert = new X509Certificate(caPem);
        const verified = cert.verify(caCert.publicKey);
        if (!verified) {
          errors.push('Certificate is not signed by the provided CA certificate.');
        }
      } catch (err) {
        errors.push(`Failed to verify certificate against CA: ${(err as Error).message}`);
      }
    }
  } else if (cert.issuer === cert.subject) {
    // Validate self-signed cert signature
    try {
      const verified = cert.verify(cert.publicKey);
      if (!verified) {
        errors.push('Self-signed certificate signature verification failed.');
      }
    } catch (err) {
      errors.push(`Failed to verify self-signed certificate signature: ${(err as Error).message}`);
    }
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
    details,
  };
}
