import { X509Certificate, createPrivateKey } from 'crypto';
import { readFileSync, existsSync } from 'fs';

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
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
    details,
  };
}
