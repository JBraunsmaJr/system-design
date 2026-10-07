import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import YAML from 'yaml';
import type {Config} from './config/schema.ts';
import {derive} from './config/derive.ts';
import {readEnvFile, type ResolvedSecrets, resolveSecrets} from './config/secrets.ts';
import {type ImageRefs, renderAll} from './render/index.ts';
import {applyPlan, planFiles, planHasChanges, resolveConflicts, showPlan} from './files.ts';
import {Compose, run} from './docker.ts';
import {BACKUP_DIR, type BackupMeta, createBackup, pruneBackups} from './backup.ts';
import {ensureCertificate, ensureRecoveryKey, handOverPrivateKey, RECOVERY_PRIVATE,} from './provision.ts';
import {KeycloakAdmin} from './keycloak.ts';
import {giveBack, reloadProxy, type ReplacedContainer, takeOver, validateCaddy} from './proxy.ts';
import {
    currentDeployment,
    type Deployment,
    emptyState,
    loadState,
    saveConfig,
    saveState,
    type State,
    STATE_DIR,
} from './state.ts';
import {versionOf} from './registry.ts';
import {type Draft, InstallerError, timestampId} from './lib/util.ts';
import {pc, ui} from './lib/ui.ts';

export const INSTALLER_VERSION = '0.1.0';

export interface Ctx {
    dir: string;
    yes: boolean;
    force: boolean;
    dryRun: boolean;
    diffs: boolean;
    manifest?: string;
}

export function loadManifest(path: string | undefined): Draft {
    if (!path) return {};
    if (!existsSync(path))
        throw new InstallerError(
            `Manifest ${path} not found inside the installer container.`,
            'Mount it, e.g. -v ./manifest.yml:/manifest.yml:ro',
        );
    const parsed = YAML.parse(readFileSync(path, 'utf8')) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new InstallerError(`${path} must be a YAML mapping.`);
    return parsed as Draft;
}

export interface DeployOptions {
    kind: Deployment['kind'];
    config: Config;
    images: ImageRefs;
    /** Treat hand-edited files as approved for replacement (adoption: originals already saved). */
    overwriteConflicts?: boolean;
    /** Skip the pre-change backup (first install: nothing to protect yet). */
    skipBackup?: boolean;
}

export interface DeployResult {
    changed: boolean;
    secrets: ResolvedSecrets;
    backup?: BackupMeta;
    initialUserPassword?: string;
}

/**
 * The one path every change takes: render → show plan → confirm → back up →
 * write → provision → pull/up --wait → post-configure → record. A failed
 * start after a backup puts the previous configuration back automatically.
 */
export async function deploy(ctx: Ctx, opts: DeployOptions): Promise<DeployResult> {
    const {dir} = ctx;
    const c = opts.config;
    const d = derive(c);
    const compose = new Compose(dir, c.project);
    const state = loadState(dir) ?? emptyState(INSTALLER_VERSION);
    const previous = currentDeployment(state);

    const databasesExist =
        (await compose.volumeExists('store-data')) || (await compose.volumeExists('keycloak-data'));
    const secrets = resolveSecrets(c, readEnvFile(join(dir, '.env')), {
        databasesExist,
        allowInitOnlyChange: ctx.force,
    });

    const files = renderAll({config: c, secrets: secrets.values, images: opts.images});
    const plan = planFiles(dir, files, state);
    const imagesChanged =
        !previous || JSON.stringify(previous.images) !== JSON.stringify(opts.images);
    const filesChanged = planHasChanges(plan);

    ui.section('Plan');
    if (previous && imagesChanged) {
        ui.note(
            (['editor', 'relay', 'store'] as const)
                .map((k) => {
                    const from = versionOf(previous.images[k]);
                    const to = versionOf(opts.images[k]);
                    return `${k.padEnd(7)} ${from === to ? pc.dim(from) : `${pc.red(from)} → ${pc.green(to)}`}`;
                })
                .join('\n'),
            'Images',
        );
    }
    showPlan(plan, {diffs: ctx.diffs});
    if (secrets.generated.length)
        ui.info(`New secrets will be generated: ${secrets.generated.join(', ')}`);
    if (secrets.changed.length) ui.warn(`Secrets changing: ${secrets.changed.join(', ')}`);

    if (!imagesChanged && !filesChanged && opts.kind !== 'install') {
        ui.success('Nothing to change.');
        return {changed: false, secrets};
    }
    if (ctx.dryRun) {
        ui.info('Dry run: nothing was written or started.');
        return {changed: false, secrets};
    }

    if (opts.overwriteConflicts)
        for (const p of plan) if (p.status === 'conflict') p.decision = 'overwrite';
    await resolveConflicts(plan, {force: ctx.force});
    await ui.confirmOrAbort(`Apply this ${opts.kind}?`);

    // ------------------------------------------------------------- backup
    let backup: BackupMeta | undefined;
    const anythingRunning = (await compose.ps()).some((s) => s.state === 'running');
    if (!opts.skipBackup && (anythingRunning || existsSync(join(dir, '.env')))) {
        backup = await ui.task(
            'Backing up databases and configuration',
            () => createBackup(dir, compose, `before ${opts.kind}`, previous?.images),
            (b) => `Backup ${b.id} (${b.databases.join(', ') || 'configuration only'})`,
        );
    }

    // ------------------------------------------------------------- write
    const applied = applyPlan(dir, plan, state);
    saveConfig(dir, c);
    saveState(dir, state);
    if (applied.written.length) ui.success(`Wrote ${applied.written.join(', ')}`);
    if (applied.removed.length) ui.info(`Removed ${applied.removed.join(', ')}`);
    if (applied.kept.length) ui.warn(`Left untouched: ${applied.kept.join(', ')}`);

    const deployment: Deployment = {
        id: timestampId(),
        at: new Date().toISOString(),
        kind: opts.kind,
        images: opts.images,
        backup: backup?.id,
        status: 'failed',
    };
    let initialUserPassword: string | undefined;

    try {
        await ui.task('Checking the compose file', () => compose.validate());
        const key = await ensureRecoveryKey(dir, c, opts.images.store);
        if (key === 'generated') await handOverPrivateKey(dir);
        state.certificateHosts = await ensureCertificate(dir, c, d, compose, state.certificateHosts);

        await ui.task('Pulling images', () => compose.pull());
        if (c.proxy.type === 'caddy' && c.proxy.acme === 'cloudflare-dns' && c.proxy.build) {
            await ui.task('Building Caddy with the Cloudflare module', () => compose.build());
        }
        if (c.proxy.type === 'caddy' || c.proxy.type === 'cloudflare-tunnel') {
            await ui.task('Validating the Caddyfile', () => validateCaddy(dir, c, secrets.values));
        }

        const replaces = c.proxy.type === 'caddy' || c.proxy.type === 'nginx' ? c.proxy.replaces : [];
        const proxyWasRunning = await compose.isRunning('proxy');
        if (replaces.length && !proxyWasRunning) {
            // Everything else first, so the old proxy is stopped as briefly as possible.
            const others = (await compose.services()).filter((s) => s !== 'proxy');
            await ui.task('Starting services and waiting for them to be healthy', () =>
                compose.up({services: others}),
            );
            const replaced: ReplacedContainer[] = await ui.task(
                'Stopping the proxy being replaced',
                () => takeOver(c),
                (r) => (r.length ? `Stopped ${r.map((x) => x.name).join(', ')}` : 'Nothing left to stop'),
            );
            deployment.replaced = replaced;
            try {
                await ui.task('Starting the new proxy', () => compose.up());
            } catch (error) {
                await compose.run(['rm', '-sf', 'proxy'], {allowFail: true});
                await giveBack(replaced);
                ui.warn(`Started ${replaced.map((x) => x.name).join(', ')} again.`);
                deployment.replaced = undefined;
                throw error;
            }
        } else {
            await ui.task('Starting services and waiting for them to be healthy', () => compose.up());
        }
        // A changed config file does not recreate its container, so apply it explicitly.
        if (proxyWasRunning && applied.written.some((f) => /^(Caddyfile|caddy\/|nginx\/)/.test(f))) {
            await ui.task('Reloading the proxy configuration', () => reloadProxy(compose, c));
        }
        if (applied.written.includes('turnserver.conf') && (await compose.isRunning('coturn'))) {
            await ui.task('Restarting coturn', () => compose.run(['restart', 'coturn']));
        }

        if (c.identity.type === 'keycloak')
            initialUserPassword = await configureKeycloak(ctx, c, compose, state, opts);

        deployment.status = 'ok';
    } catch (error) {
        state.deployments.push(deployment);
        saveState(dir, state);
        if (backup && previous) {
            ui.error(`The ${opts.kind} failed: ${(error as Error).message}`);
            await automaticRollback(dir, compose, backup, deployment.replaced);
        } else if (deployment.replaced?.length) {
            await compose.run(['rm', '-sf', 'proxy'], {allowFail: true});
            await giveBack(deployment.replaced);
            ui.warn(`Started ${deployment.replaced.map((x) => x.name).join(', ')} again.`);
        }
        throw error;
    }

    state.deployments.push(deployment);
    state.installerVersion = INSTALLER_VERSION;
    saveState(dir, state);
    const pruned = pruneBackups(
        dir,
        c.backups.keep,
        new Set(
            state.deployments
                .slice(-3)
                .map((x) => x.backup)
                .filter((x): x is string => !!x),
        ),
    );
    if (pruned.length) ui.info(`Pruned old backups: ${pruned.join(', ')}`);
    return {changed: true, secrets, backup, initialUserPassword};
}

/** Puts the pre-change configuration back and starts it; databases are left as they are. */
async function automaticRollback(
    dir: string,
    compose: Compose,
    backup: BackupMeta,
    replaced?: ReplacedContainer[],
): Promise<void> {
    try {
        await ui.task(`Restoring the previous configuration from backup ${backup.id}`, async () => {
            await restoreConfigFiles(dir, backup);
            if (replaced?.length) {
                await compose.run(['rm', '-sf', 'proxy'], {allowFail: true});
                await giveBack(replaced);
            }
            await compose.up();
        });
        ui.warn(
            `The previous version is running again. Databases were not touched; if the failed version had already ` +
            `migrated the store's schema, restore them with: restore ${backup.id} --with-data`,
        );
    } catch (error) {
        ui.error(`Automatic rollback also failed: ${(error as Error).message}`);
        ui.error(`Your previous configuration and data are in ${join(dir, BACKUP_DIR, backup.id)}.`);
    }
}

/**
 * Extracts a backup's configuration over the install directory, keeping the
 * current deployment history but taking the file fingerprints from the
 * backup, so the restored files are not mistaken for hand edits.
 */
export async function restoreConfigFiles(dir: string, backup: BackupMeta): Promise<void> {
    const tmp = mkdtempSync(join(tmpdir(), 'sd-restore-'));
    try {
        await run('tar', ['-xzf', join(dir, BACKUP_DIR, backup.id, backup.configArchive), '-C', tmp]);
        const oldStatePath = join(tmp, STATE_DIR, 'state.json');
        const oldFiles = existsSync(oldStatePath)
            ? (JSON.parse(readFileSync(oldStatePath, 'utf8')) as State).files
            : {};
        rmSync(oldStatePath, {force: true});
        cpSync(tmp, dir, {recursive: true});
        const state = loadState(dir) ?? emptyState(INSTALLER_VERSION);
        state.files = oldFiles;
        saveState(dir, state);
    } finally {
        rmSync(tmp, {recursive: true, force: true});
    }
}

/**
 * Applies what realm import alone cannot: client settings on an existing
 * realm, groups, and the first user (who becomes a store administrator,
 * since their Keycloak id is the OIDC subject).
 */
async function configureKeycloak(
    ctx: Ctx,
    c: Config,
    compose: Compose,
    state: State,
    opts: DeployOptions,
): Promise<string | undefined> {
    if (c.identity.type !== 'keycloak') return undefined;
    const i = c.identity;
    const d = derive(c);
    const kc = new KeycloakAdmin(compose, c, d);

    await ui.task(
        'Reconciling the Keycloak client',
        () => kc.reconcileClient(i.clientId, d),
        (ch) =>
            ch.length ? `Keycloak client updated (${ch.join(', ')})` : 'Keycloak client is up to date',
    );
    const created = await kc.ensureGroups(i.groups);
    if (created.length) ui.success(`Created groups: ${created.join(', ')}`);

    let password: string | undefined;
    if (i.initialUser) {
        const u = i.initialUser;
        const result = await ui.task(`Ensuring user ${u.username}`, () => kc.ensureUser(u));
        password = result.password ?? undefined;
        if (u.admin) {
            const subject = `${d.keycloak!.issuer}#${result.id}`;
            if (!c.store.adminSubjects.includes(subject)) {
                c.store.adminSubjects = [...c.store.adminSubjects, subject];
                // Re-render with the new administrator; only the store's environment changes.
                const secrets = resolveSecrets(c, readEnvFile(join(ctx.dir, '.env')), {
                    databasesExist: true,
                });
                const plan = planFiles(
                    ctx.dir,
                    renderAll({config: c, secrets: secrets.values, images: opts.images}),
                    state,
                );
                applyPlan(ctx.dir, plan, state);
                saveConfig(ctx.dir, c);
                saveState(ctx.dir, state);
                await ui.task(`Making ${u.username} a store administrator`, () =>
                    compose.up({services: ['store']}),
                );
            }
        }
    }

    const demo = await kc.demoUsersPresent().catch(() => []);
    if (demo.length) {
        ui.warn(
            `Keycloak still has demo accounts from an earlier realm import: ${demo.join(', ')}. Remove them in the admin console (Users).`,
        );
    }
    return password;
}

/** What to tell the operator once everything is up. */
export function finalSummary(dir: string, c: Config, result: DeployResult): string {
    const d = derive(c);
    const lines = [`${pc.bold('Editor')}   ${d.afterLoginUrl}`];
    if (d.keycloak)
        lines.push(
            `${pc.bold('Keycloak')} ${d.keycloak.publicBase}/admin/  (admin / KEYCLOAK_ADMIN_PASSWORD in .env)`,
        );
    if (c.identity.type === 'keycloak' && c.identity.initialUser && result.initialUserPassword) {
        lines.push(
            `${pc.bold('First user')} ${c.identity.initialUser.username} / ${pc.yellow(result.initialUserPassword)}  (must change at first sign-in)`,
        );
    }
    if (result.secrets.generated.includes('KEYCLOAK_ADMIN_PASSWORD')) {
        lines.push(
            `${pc.bold('Keycloak admin password')} ${pc.yellow(result.secrets.values.KEYCLOAK_ADMIN_PASSWORD!)}  (shown once; also in .env)`,
        );
    }
    lines.push('');
    const todo: string[] = [];
    const p = c.proxy;
    if (p.type === 'cloudflare-tunnel') {
        todo.push(
            `In Cloudflare Zero Trust → your tunnel → Public Hostnames, route ${d.hosts.join(', ')} to ${pc.bold('http://proxy:80')}.`,
        );
    } else if (p.type === 'external') {
        todo.push(
            `Add the site blocks from ${pc.bold('proxy-snippets/')} to your proxy (Caddyfile or nginx.conf).`,
        );
    } else {
        const dns = c.ddns.enabled
            ? `Dynamic DNS keeps ${c.ddns.domains.length ? c.ddns.domains.join(', ') : d.hosts.join(', ')} pointed at this server`
            : `Point DNS for ${d.hosts.join(', ')} at this server`;
        todo.push(
            `${dns}; forward ports 80 and 443 to it${p.type === 'caddy' && p.acme === 'cloudflare-dns' ? ' (DNS validation needs no inbound port; 80 only serves redirects)' : ''}.`,
        );
    }
    if (c.turn.type === 'bundled') {
        todo.push(
            `Open ${c.turn.port}/udp, ${c.turn.port}/tcp and ${c.turn.minPort}-${c.turn.maxPort}/udp to this host for TURN.`,
        );
    }
    if (existsSync(join(dir, RECOVERY_PRIVATE)))
        todo.push(pc.yellow(`Move ${RECOVERY_PRIVATE} off this server.`));
    if (c.store.adminSubjects.length === 0)
        todo.push('After your first sign-in, run `promote-admin` to name a store administrator.');
    lines.push(...todo.map((t) => `• ${t}`));
    return lines.join('\n');
}

export function ensureDir(dir: string): void {
    mkdirSync(dir, {recursive: true});
}
