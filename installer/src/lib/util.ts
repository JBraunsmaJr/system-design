import {createHash, randomBytes} from 'node:crypto';

/** An error the operator can act on. `hint` is printed beneath the message. */
export class InstallerError extends Error {
    hint?: string;

    constructor(message: string, hint?: string) {
        super(message);
        this.name = 'InstallerError';
        this.hint = hint;
    }
}

export type Draft = Record<string, unknown>;

export function getPath(obj: unknown, path: string): unknown {
    let cur: unknown = obj;
    for (const key of path.split('.')) {
        if (cur === null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[key];
    }
    return cur;
}

export function setPath(obj: Draft, path: string, value: unknown): void {
    const keys = path.split('.');
    let cur: Draft = obj;
    for (const key of keys.slice(0, -1)) {
        const next = cur[key];
        if (next === null || typeof next !== 'object' || Array.isArray(next)) cur[key] = {};
        cur = cur[key] as Draft;
    }
    cur[keys[keys.length - 1]!] = value;
}

export function isPlainObject(v: unknown): v is Draft {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Right wins. Arrays are replaced, not concatenated. */
export function deepMerge(left: Draft, right: Draft): Draft {
    const out: Draft = {...left};
    for (const [key, value] of Object.entries(right)) {
        if (value === undefined) continue;
        const existing = out[key];
        out[key] = isPlainObject(existing) && isPlainObject(value) ? deepMerge(existing, value) : value;
    }
    return out;
}

export function sha256(content: string | Buffer): string {
    return createHash('sha256').update(content).digest('hex');
}

/** URL-, shell-, YAML- and .env-safe random secret. */
export function randomSecret(bytes = 24): string {
    return randomBytes(bytes).toString('base64url');
}

export function timestampId(date = new Date()): string {
    return date
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d+Z$/, 'Z');
}

export function stripTrailingSlash(s: string): string {
    return s.replace(/\/+$/, '');
}
