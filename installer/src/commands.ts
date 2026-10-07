import {accessSync, constants, cpSync, existsSync, mkdirSync, statfsSync} from 'node:fs';
import {join} from 'node:path';
import {lookup} from 'node:dns/promises';
import type {Config} from './config/schema.ts';
import {derive} from './config/derive.ts';
import {readEnvFile, resolveSecrets} from './config/secrets.ts';
import {type ImageRefs, renderAll} from './render/index.ts';
import {applyPlan, planFiles, resolveConflicts, showPlan} from './files.ts';
import {checkSamePathMount, Compose, docker} from './docker.ts';
import {backupSize, createBackup, getBackup, listBackups, restoreDatabases} from './backup.ts';
import {KeycloakAdmin} from './keycloak.ts';
import {RECOVERY_PRIVATE} from './provision.ts';
import {refsOf, repositoryFor, resolveAll, versionOf} from './registry.ts';
import {currentDeployment, emptyState, loadSavedConfig, loadState, saveConfig, saveState, STATE_DIR} from './state.ts';
import {runWizard, summarize} from './wizard.ts';
import {type Ctx, deploy, finalSummary, INSTALLER_VERSION, loadManifest, restoreConfigFiles} from './deploy.ts';
import {deepMerge, type Draft, getPath, InstallerError, setPath, timestampId} from './lib/util.ts';
import {pc, ui} from './lib/ui.ts';

export interface VersionFlags {
    to?: string;
    editor?: string;
    relay?: string;
    store?: string;
}

// ------------------------------------------------------------------ helpers

function applyVersionFlags(draft: Draft, v: VersionFlags): void {
    for (const k of ['editor', 'relay', 'store'] as const) {
        const value = v[k] ?? v.to;
        if (value) setPath(draft, `versions.${k}`, value);
    }
}

async function resolveImages(c: Config): Promise<ImageRefs> {
    const resolved = await ui.task(
        'Resolving image versions',
        () => resolveAll(c),
        (r) => `Versions: editor ${r.editor.version}, relay ${r.relay.version}, store ${r.store.version}`,
    );
    for (const r of Object.values(resolved)) if (r.note) ui.warn(r.note);
    return refsOf(resolved);
}

function requireInstalled(dir: string) {
    const state = loadState(dir);
    const saved = loadSavedConfig(dir);
    const current = currentDeployment(state);
    if (!state || !saved || !current) {
        throw new InstallerError(`No completed installation found in ${dir}.`, 'Run `install` first (or check --dir / the mounted path).');
    }
    return {state, saved, current};
}

function imagesFromEnv(dir: string): ImageRefs | null {
    const env = readEnvFile(join(dir, '.env'));
    return env.EDITOR_IMAGE && env.RELAY_IMAGE && env.STORE_IMAGE ? {
        editor: env.EDITOR_IMAGE,
        relay: env.RELAY_IMAGE,
        store: env.STORE_IMAGE
    } : null;
}

// ------------------------------------------------------------------ preflight

type Check = { name: string; status: 'ok' | 'warn' | 'fail'; detail: string };

export async function preflight(ctx: Ctx, opts: { skipMountCheck?: boolean; config?: Config } = {}): Promise<Check[]> {
    const checks: Check[] = [];
    const add = (name: string, status: Check['status'], detail: string) => checks.push({name, status, detail});

    const server = await docker(['version', '--format', '{{.Server.Version}}'], {allowFail: true}).catch(() => null);
    if (!server || server.code !== 0) {
        add('Docker', 'fail', 'cannot reach the Docker daemon — mount it with -v /var/run/docker.sock:/var/run/docker.sock');
        return checks;
    }
    add('Docker', 'ok', `engine ${server.stdout.trim()}`);

    const cv = await docker(['compose', 'version', '--short'], {allowFail: true});
    const [major = 0, minor = 0] = cv.stdout.trim().replace(/^v/, '').split('.').map(Number);
    if (cv.code !== 0) add('Compose', 'fail', 'docker compose plugin not available');
    else if (major < 2 || (major === 2 && minor < 20)) add('Compose', 'fail', `${cv.stdout.trim()} is too old; 2.20 or later is needed`);
    else add('Compose', 'ok', cv.stdout.trim());

    if (opts.skipMountCheck) add('Install path', 'warn', 'same-path mount check skipped');
    else {
        const m = await checkSamePathMount(ctx.dir);
        add('Install path', m.ok ? 'ok' : 'fail', m.detail);
    }

    try {
        mkdirSync(ctx.dir, {recursive: true});
        accessSync(ctx.dir, constants.W_OK);
        const fs = statfsSync(ctx.dir);
        const freeGb = (fs.bavail * fs.bsize) / 2 ** 30;
        add('Disk', freeGb < 2 ? 'warn' : 'ok', `${freeGb.toFixed(1)} GiB free in ${ctx.dir}`);
    } catch {
        add('Disk', 'fail', `${ctx.dir} is not writable`);
    }

    if (existsSync(join(ctx.dir, RECOVERY_PRIVATE))) add('Recovery key', 'warn', `${RECOVERY_PRIVATE} is still on this server — move it offline`);

    const c = opts.config;
    if (c) {
        const d = derive(c);
        for (const host of d.hosts) {
            try {
                const {address} = await lookup(host);
                add(`DNS ${host}`, 'ok', address);
            } catch {
                add(`DNS ${host}`, 'warn', 'does not resolve yet');
            }
        }
        if (c.proxy.type === 'caddy' || c.proxy.type === 'nginx') {
            const ps = await docker(['ps', '--format', '{{.Label "com.docker.compose.project"}}\t{{.Names}}\t{{.Ports}}'], {allowFail: true});
            for (const line of ps.stdout.trim().split('\n').filter(Boolean)) {
                const [project, name, ports = ''] = line.split('\t');
                if (project === c.project) continue;
                if (/:(80|443)->/.test(ports)) add('Ports 80/443', 'fail', `already published by container ${name}`);
            }
        }
    }
    return checks;
}

function printChecks(checks: Check[]): void {
    const icon = {ok: pc.green('✔'), warn: pc.yellow('!'), fail: pc.red('✖')};
    ui.note(checks.map((c) => `${icon[c.status]} ${c.name.padEnd(16)} ${pc.dim(c.detail)}`).join('\n'), 'Checks');
}

async function requirePreflight(ctx: Ctx, skipMountCheck: boolean, config?: Config): Promise<void> {
    const checks = await preflight(ctx, {skipMountCheck, config});
    const failed = checks.filter((c) => c.status === 'fail');
    if (failed.length || checks.some((c) => c.status === 'warn')) printChecks(checks);
    if (failed.length) throw new InstallerError('Preflight checks failed; nothing was changed.', failed.map((f) => `${f.name}: ${f.detail}`).join('\n'));
}

// ------------------------------------------------------------------ install

const ADOPT_FILES = ['compose.yml', 'compose.yaml', 'docker-compose.yml', '.env', 'Caddyfile', 'keycloak-realm.json', 'turnserver.conf'];

export async function install(ctx: Ctx, v: VersionFlags, skipMountCheck: boolean): Promise<void> {
    ui.intro('System Design · install');
    await requirePreflight(ctx, skipMountCheck);

    if (currentDeployment(loadState(ctx.dir))) {
        throw new InstallerError(`${ctx.dir} already has an installation.`, 'Use `upgrade` for new versions, or `reconfigure` to change answers.');
    }

    const draft = loadManifest(ctx.manifest);
    applyVersionFlags(draft, v);

    // An existing hand-made deployment: keep its secrets and volumes, set its files aside.
    const found = ADOPT_FILES.filter((f) => existsSync(join(ctx.dir, f)));
    let adopted = false;
    if (found.length && !loadState(ctx.dir)) {
        ui.section('Existing deployment found');
        ui.message(`${found.join(', ')} already exist in ${ctx.dir}.`);
        ui.message('Secrets in .env are reused, so databases keep working. Volumes are found again as long as the project name matches.');
        await ui.confirmOrAbort('Take over this deployment? Originals are copied aside first.');
        const aside = join(ctx.dir, STATE_DIR, `adopted-${timestampId()}`);
        mkdirSync(aside, {recursive: true});
        for (const f of found) cpSync(join(ctx.dir, f), join(aside, f));
        ui.success(`Originals copied to ${aside}`);
        const env = readEnvFile(join(ctx.dir, '.env'));
        if (env.DOMAIN && getPath(draft, 'domain') === undefined) setPath(draft, 'domain', env.DOMAIN);
        adopted = true;
    }

    const config = await runWizard(draft, ctx.dir);
    ui.note(summarize(config), 'Summary');
    const images = await resolveImages(config);
    const result = await deploy(ctx, {
        kind: 'install',
        config,
        images,
        overwriteConflicts: adopted,
        skipBackup: !adopted
    });
    if (!result.changed) return ui.outro('Nothing was installed.');
    ui.note(finalSummary(ctx.dir, config, result), pc.green('Installed'));
    ui.outro(`Next time, run ${pc.cyan('upgrade')} from the same directory.`);
}

// ------------------------------------------------------------------ upgrade / reconfigure

export async function upgrade(ctx: Ctx, v: VersionFlags, skipMountCheck: boolean): Promise<void> {
    ui.intro('System Design · upgrade');
    const {saved} = requireInstalled(ctx.dir);
    const draft = deepMerge(saved, loadManifest(ctx.manifest));
    applyVersionFlags(draft, v);
    const config = await runWizard(draft, ctx.dir);
    await requirePreflight(ctx, skipMountCheck, config);
    const images = await resolveImages(config);
    const result = await deploy(ctx, {kind: 'upgrade', config, images});
    if (result.changed) ui.outro(pc.green(`Upgraded. Undo with ${pc.cyan('rollback')}.`));
    else ui.outro('Done.');
}

export async function reconfigure(ctx: Ctx, v: VersionFlags, skipMountCheck: boolean): Promise<void> {
    ui.intro('System Design · reconfigure');
    const {saved, current} = requireInstalled(ctx.dir);
    const draft = deepMerge(saved, loadManifest(ctx.manifest));
    applyVersionFlags(draft, v);
    // Interactive runs offer every answer again, pre-filled; manifests change only what they name.
    const config = await runWizard(draft, ctx.dir, {reask: true});
    await requirePreflight(ctx, skipMountCheck, config);
    const images = v.to || v.editor || v.relay || v.store ? await resolveImages(config) : current.images;
    const result = await deploy(ctx, {kind: 'reconfigure', config, images});
    if (result.changed) ui.note(finalSummary(ctx.dir, config, result), pc.green('Reconfigured'));
    ui.outro('Done.');
}

// ------------------------------------------------------------------ render

export async function render(ctx: Ctx): Promise<void> {
    ui.intro('System Design · render');
    const state = loadState(ctx.dir) ?? emptyState(INSTALLER_VERSION);
    const saved = loadSavedConfig(ctx.dir) ?? {};
    const config = await runWizard(deepMerge(saved, loadManifest(ctx.manifest)), ctx.dir);
    const images: ImageRefs =
        currentDeployment(state)?.images ??
        imagesFromEnv(ctx.dir) ?? {
            editor: `${repositoryFor(config, 'editor')}:${config.versions.editor}`,
            relay: `${repositoryFor(config, 'relay')}:${config.versions.relay}`,
            store: `${repositoryFor(config, 'store')}:${config.versions.store}`,
        };
    const secrets = resolveSecrets(config, readEnvFile(join(ctx.dir, '.env')));
    const plan = planFiles(ctx.dir, renderAll({config, secrets: secrets.values, images}), state);
    showPlan(plan, {diffs: ctx.diffs});
    if (ctx.dryRun) return ui.outro('Dry run: nothing was written.');
    await resolveConflicts(plan, {force: ctx.force});
    const r = applyPlan(ctx.dir, plan, state);
    saveConfig(ctx.dir, config);
    saveState(ctx.dir, state);
    ui.outro(r.written.length ? `Wrote ${r.written.join(', ')}. Nothing was started.` : 'All files already up to date.');
}

// ------------------------------------------------------------------ status

export async function status(ctx: Ctx, checkUpdates: boolean): Promise<void> {
    ui.intro('System Design · status');
    const {saved, state, current} = requireInstalled(ctx.dir);
    const config = await runWizard(saved, ctx.dir);
    const compose = new Compose(ctx.dir, config.project);
    const d = derive(config);

    ui.note(
        [
            `${pc.dim('url')}        ${d.afterLoginUrl}`,
            `${pc.dim('deployed')}   ${current.at} (${current.kind})`,
            ...(['editor', 'relay', 'store'] as const).map((k) => `${pc.dim(k.padEnd(10))} ${versionOf(current.images[k])}`),
        ].join('\n'),
        'Installation',
    );

    const services = await compose.ps();
    const colour = (s: string) => (s === 'running' || s === 'healthy' ? pc.green(s) : s ? pc.yellow(s) : pc.dim('-'));
    ui.note(services.map((s) => `${s.service.padEnd(12)} ${colour(s.state).padEnd(18)} ${colour(s.health)}`).join('\n') || pc.yellow('no containers'), 'Services');

    if (checkUpdates) {
        try {
            const latest = await resolveAll({
                ...config,
                versions: {editor: 'latest', relay: 'latest', store: 'latest'}
            });
            const newer = (['editor', 'relay', 'store'] as const).filter((k) => latest[k].ref !== current.images[k]);
            if (newer.length) ui.info(`Updates available: ${newer.map((k) => `${k} ${latest[k].version}`).join(', ')}. Run ${pc.cyan('upgrade')}.`);
            else ui.success('All images are the latest release.');
        } catch (e) {
            ui.warn(`Could not check for updates: ${(e as Error).message}`);
        }
    }
    const backups = listBackups(ctx.dir);
    ui.info(`${backups.length} backup(s); newest ${backups.at(-1)?.id ?? 'none'}. ${state.deployments.length} deployment(s) recorded.`);
    if (existsSync(join(ctx.dir, RECOVERY_PRIVATE))) ui.warn(`${RECOVERY_PRIVATE} is still on this server.`);
    ui.outro('');
}

// ------------------------------------------------------------------ backup / restore / rollback

export async function backup(ctx: Ctx, list: boolean): Promise<void> {
    ui.intro('System Design · backup');
    if (list) {
        const all = listBackups(ctx.dir);
        ui.note(
            all.map((b) => `${b.id}  ${pc.dim(b.reason.padEnd(22))} ${(b.databases.join('+') || 'config').padEnd(16)} ${(backupSize(ctx.dir, b.id) / 2 ** 20).toFixed(1)} MiB`).join('\n') || 'No backups yet.',
            'Backups',
        );
        return ui.outro('');
    }
    const {saved, current} = requireInstalled(ctx.dir);
    const compose = new Compose(ctx.dir, String(saved.project));
    const meta = await ui.task('Backing up', () => createBackup(ctx.dir, compose, 'manual', current.images), (m) => `Backup ${m.id}`);
    ui.outro(`Saved to ${join(ctx.dir, 'backups', meta.id)}. Copy it off this server for real protection.`);
}

async function restoreFrom(ctx: Ctx, id: string, withData: boolean, kind: 'rollback'): Promise<void> {
    const {state, saved} = requireInstalled(ctx.dir);
    const meta = getBackup(ctx.dir, id);
    const compose = new Compose(ctx.dir, String(saved.project));
    ui.note(
        [
            `Configuration from ${meta.at} (${meta.reason}) will replace the current files.`,
            withData
                ? pc.yellow(`Databases (${meta.databases.join(', ')}) will be restored: anything written since ${meta.at} is lost.`)
                : 'Databases are left as they are.',
        ].join('\n'),
        `Restore ${meta.id}`,
    );
    if (withData && !meta.databases.length) throw new InstallerError('That backup holds no database dumps.');
    await ui.confirmOrAbort('Restore?');

    const safety = await ui.task('Backing up the current state first', () => createBackup(ctx.dir, compose, `before restore of ${id}`, currentDeployment(state)?.images), (m) => `Safety backup ${m.id}`);
    await ui.task('Restoring configuration', () => restoreConfigFiles(ctx.dir, meta));
    if (withData) await ui.task('Restoring databases', () => restoreDatabases(ctx.dir, compose, meta));
    await ui.task('Starting services', () => compose.up());

    const after = loadState(ctx.dir)!;
    const cur = currentDeployment(after);
    if (cur) cur.status = 'rolled-back';
    after.deployments.push({
        id: timestampId(),
        at: new Date().toISOString(),
        kind,
        images: imagesFromEnv(ctx.dir) ?? meta.images!,
        backup: safety.id,
        status: 'ok'
    });
    saveState(ctx.dir, after);
    ui.outro(pc.green(`Restored ${meta.id}. The state just before this is in backup ${safety.id}.`));
}

export async function restore(ctx: Ctx, id: string | undefined, withData: boolean): Promise<void> {
    ui.intro('System Design · restore');
    if (!id) throw new InstallerError('Which backup? Pass its id.', 'List them with `backup --list`.');
    await restoreFrom(ctx, id, withData, 'rollback');
}

export async function rollback(ctx: Ctx, withData: boolean): Promise<void> {
    ui.intro('System Design · rollback');
    const {current} = requireInstalled(ctx.dir);
    if (!current.backup) throw new InstallerError('The current deployment has no backup from before it, so there is nothing to roll back to.');
    ui.info(`Rolling back the ${current.kind} of ${current.at} to the state saved just before it.`);
    if (!withData && ui.interactive) {
        withData = await ui.confirm('Also restore the databases? Only needed if the newer version changed the schema; data written since is lost.', false);
    }
    await restoreFrom(ctx, current.backup, withData, 'rollback');
}

// ------------------------------------------------------------------ doctor

export async function doctor(ctx: Ctx, skipMountCheck: boolean): Promise<boolean> {
    ui.intro('System Design · doctor');
    const saved = loadSavedConfig(ctx.dir);
    const config = saved ? await runWizard(saved, ctx.dir).catch(() => undefined) : undefined;
    const checks = await preflight(ctx, {skipMountCheck, config});
    if (config) {
        try {
            const r = await resolveAll(config);
            checks.push({name: 'Registry', status: 'ok', detail: `latest store is ${r.store.version}`});
        } catch (e) {
            checks.push({name: 'Registry', status: 'warn', detail: (e as Error).message});
        }
    }
    printChecks(checks);
    const ok = !checks.some((c) => c.status === 'fail');
    ui.outro(ok ? pc.green('Ready.') : pc.red('Fix the failures above before installing or upgrading.'));
    return ok;
}

// ------------------------------------------------------------------ promote-admin

export async function promoteAdmin(ctx: Ctx, username: string | undefined, subject: string | undefined): Promise<void> {
    ui.intro('System Design · promote-admin');
    const {saved, current} = requireInstalled(ctx.dir);
    const config = await runWizard(saved, ctx.dir);
    const d = derive(config);

    let sub = subject;
    if (!sub) {
        if (config.identity.type !== 'keycloak') {
            throw new InstallerError('Pass --subject issuer#subject.', `Sign in, then open ${d.storeUrl}/v1/users/me to see your subject.`);
        }
        const name = username ?? (await ui.text({message: 'Keycloak username to make an administrator'}));
        const id = await new KeycloakAdmin(new Compose(ctx.dir, config.project), config, d).findUserId(name);
        if (!id) throw new InstallerError(`No Keycloak user named ${name} in realm ${config.identity.realm}.`);
        sub = `${d.keycloak!.issuer}#${id}`;
    }
    if (config.store.adminSubjects.includes(sub)) return ui.outro(`${sub} is already an administrator.`);
    config.store.adminSubjects.push(sub);
    await deploy(ctx, {kind: 'reconfigure', config, images: current.images});
    ui.outro(pc.green(`Added ${sub} to ADMIN_SUBJECTS.`));
}
