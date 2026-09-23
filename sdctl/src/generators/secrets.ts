import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { generateHeader } from './header.js';

export interface GeneratedSecrets {
  turnUsername?: string;
  turnPassword?: string;
  turnSecret?: string;
  registryPassword?: string;
}

export function generateRandomSecret(length: number = 32): string {
  return randomBytes(length).toString('hex');
}

export function parseSecretsEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      result[key] = val;
    }
  }
  return result;
}

export function formatSecretsEnv(secrets: Record<string, string>): string {
  const header = generateHeader('#');
  const lines: string[] = [header];
  for (const [key, value] of Object.entries(secrets)) {
    lines.push(`${key}=${value}`);
  }
  return lines.join('\n') + '\n';
}

export function loadOrCreateSecrets(
  filePath: string,
  needsTurn: boolean = false,
  extraSecrets?: Record<string, string>,
): Record<string, string> {
  let existing: Record<string, string> = {};
  if (existsSync(filePath)) {
    existing = parseSecretsEnv(readFileSync(filePath, 'utf8'));
  }

  let updated = false;
  if (needsTurn) {
    if (!existing.TURN_USERNAME) {
      existing.TURN_USERNAME = 'system-design';
      updated = true;
    }
    if (!existing.TURN_PASSWORD) {
      existing.TURN_PASSWORD = generateRandomSecret(16);
      updated = true;
    }
    if (!existing.TURN_SECRET) {
      existing.TURN_SECRET = generateRandomSecret(32);
      updated = true;
    }
  }

  if (extraSecrets) {
    for (const [k, v] of Object.entries(extraSecrets)) {
      if (v && !existing[k]) {
        existing[k] = v;
        updated = true;
      }
    }
  }

  if (updated || !existsSync(filePath)) {
    const content = formatSecretsEnv(existing);
    writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o600 });
    try {
      chmodSync(filePath, 0o600);
    } catch {
      // Windows doesn't support unix permissions, ignore
    }
  }

  return existing;
}
