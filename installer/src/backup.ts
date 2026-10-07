import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,} from 'node:fs';
import {join} from 'node:path';
import type {Compose} from './docker.ts';
import {run} from './docker.ts';
import type {ImageRefs} from './render/index.ts';
import {STATE_DIR} from './state.ts';
import {InstallerError, timestampId} from './lib/util.ts';
import {RECOVERY_PRIVATE} from './provision.ts';

export const BACKUP_DIR = 'backups';

export interface BackupMeta {
    id: string;
    at: string;
    reason: string;
    images?: ImageRefs;
    databases: string[];
    configArchive: string;
}

const DATABASES: { service: string; user: string; db: string }[] = [
    {service: 'postgres', user: 'store', db: 'store'},
    {service: 'keycloak-db', user: 'keycloak', db: 'keycloak'},
];

/**
 * A backup is a directory holding one pg_dump per running database (custom
 * format) and a tarball of the configuration, including .env. The recovery
 * private key is deliberately excluded: it must never travel with backups.
 */
export async function createBackup(
    dir: string,
    compose: Compose,
    reason: string,
    images?: ImageRefs,
): Promise<BackupMeta> {
    const id = timestampId();
    const target = join(dir, BACKUP_DIR, id);
    mkdirSync(target, {recursive: true, mode: 0o700});

    const running = new Set(
        (await compose.ps()).filter((s) => s.state === 'running').map((s) => s.service),
    );
    const databases: string[] = [];
    for (const db of DATABASES) {
        if (!running.has(db.service)) continue;
        await compose.exec(db.service, ['pg_dump', '-U', db.user, '-Fc', db.db], {
            stdoutFile: join(target, `${db.db}.dump`),
        });
        databases.push(db.db);
    }

    const include = [
        'compose.yml',
        '.env',
        STATE_DIR,
        'keys/recovery-public.pem',
        'Caddyfile',
        'caddy',
        'nginx',
        'certbot/conf',
        'keycloak-realm.json',
        'turnserver.conf',
        'proxy-snippets',
    ].filter((p) => existsSync(join(dir, p)));
    const archive = join(target, 'config.tar.gz');
    await run('tar', [
        '-czf',
        archive,
        '-C',
        dir,
        `--exclude=${RECOVERY_PRIVATE}`,
        `--exclude=${STATE_DIR}/replaced`,
        ...include,
    ]);

    const meta: BackupMeta = {
        id,
        at: new Date().toISOString(),
        reason,
        images,
        databases,
        configArchive: 'config.tar.gz',
    };
    writeFileSync(join(target, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', {mode: 0o600});
    return meta;
}

export function listBackups(dir: string): BackupMeta[] {
    const root = join(dir, BACKUP_DIR);
    if (!existsSync(root)) return [];
    return readdirSync(root)
        .filter((id) => existsSync(join(root, id, 'meta.json')))
        .map((id) => JSON.parse(readFileSync(join(root, id, 'meta.json'), 'utf8')) as BackupMeta)
        .sort((a, b) => a.id.localeCompare(b.id));
}

export function getBackup(dir: string, id: string): BackupMeta {
    const found = listBackups(dir).find((b) => b.id === id);
    if (!found) throw new InstallerError(`No backup named ${id}.`, 'List them with `backup --list`.');
    return found;
}

export function backupSize(dir: string, id: string): number {
    const root = join(dir, BACKUP_DIR, id);
    return readdirSync(root).reduce((n, f) => n + statSync(join(root, f)).size, 0);
}

/** Keeps the newest `keep`, never deleting one a deployment still refers to. */
export function pruneBackups(dir: string, keep: number, protectedIds: Set<string>): string[] {
    const all = listBackups(dir);
    const removable = all
        .slice(0, Math.max(0, all.length - keep))
        .filter((b) => !protectedIds.has(b.id));
    for (const b of removable) rmSync(join(dir, BACKUP_DIR, b.id), {recursive: true, force: true});
    return removable.map((b) => b.id);
}

export async function restoreConfig(dir: string, meta: BackupMeta): Promise<void> {
    await run('tar', ['-xzf', join(dir, BACKUP_DIR, meta.id, meta.configArchive), '-C', dir]);
}

/**
 * Restores database dumps. The applications using a database are stopped
 * first, so nothing writes into it mid-restore.
 */
export async function restoreDatabases(
    dir: string,
    compose: Compose,
    meta: BackupMeta,
): Promise<void> {
    const users: Record<string, string[]> = {store: ['store'], keycloak: ['keycloak']};
    for (const db of DATABASES.filter((d) => meta.databases.includes(d.db))) {
        await compose.stop(users[db.db] ?? []);
        await compose.start([db.service]);
        await compose.exec(
            db.service,
            [
                'pg_restore',
                '-U',
                db.user,
                '-d',
                db.db,
                '--clean',
                '--if-exists',
                '--no-owner',
                '--single-transaction',
            ],
            {
                stdinFile: join(dir, BACKUP_DIR, meta.id, `${db.db}.dump`),
            },
        );
    }
}
