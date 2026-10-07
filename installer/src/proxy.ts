import {existsSync, mkdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {Config} from './config/schema.ts';
import {derive} from './config/derive.ts';
import {type Compose, docker} from './docker.ts';
import type {Secrets} from './config/secrets.ts';
import {InstallerError} from './lib/util.ts';
import {pc, ui} from './lib/ui.ts';

/** Where a shared Caddy's operator-owned Caddyfile lives, beside the installer's snippet. */
export const SHARED_CADDYFILE = 'caddy/Caddyfile';
export const CADDY_SNIPPET = 'caddy/system-design.caddy';

export interface ReplacedContainer {
    name: string;
    /** Restart policy before the takeover, put back by rollback. */
    restart: string;
}

interface ContainerInfo {
    name: string;
    image: string;
    project: string;
    restart: string;
    running: boolean;
    mounts: { Type: string; Name?: string; Source: string; Destination: string }[];
}

export function proxyRunsHere(c: Config): boolean {
    return c.proxy.type === 'caddy' || c.proxy.type === 'nginx';
}

function replacesOf(c: Config): string[] {
    return c.proxy.type === 'caddy' || c.proxy.type === 'nginx' ? c.proxy.replaces : [];
}

async function inspect(name: string): Promise<ContainerInfo | null> {
    const r = await docker(['inspect', name, '--format', '{{json .}}'], {allowFail: true});
    if (r.code !== 0) return null;
    const j = JSON.parse(r.stdout) as {
        Name: string;
        Config: { Image: string; Labels?: Record<string, string> };
        HostConfig: { RestartPolicy?: { Name?: string } };
        State: { Running: boolean };
        Mounts?: ContainerInfo['mounts'];
    };
    return {
        name: j.Name.replace(/^\//, ''),
        image: j.Config.Image,
        project: j.Config.Labels?.['com.docker.compose.project'] ?? '',
        restart: j.HostConfig.RestartPolicy?.Name || 'no',
        running: j.State.Running,
        mounts: j.Mounts ?? [],
    };
}

/** Running containers outside this project that publish 80 or 443. */
export async function portConflicts(project: string): Promise<{ name: string; project: string }[]> {
    const r = await docker(
        ['ps', '--format', '{{.Names}}\t{{.Ports}}\t{{.Label "com.docker.compose.project"}}'],
        {allowFail: true},
    );
    return r.stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => l.split('\t'))
        .filter(([, ports = '', p = '']) => p !== project && /:(80|443)->/.test(ports))
        .map(([name = '', , p = '']) => ({name, project: p}));
}

async function projectContainers(project: string): Promise<string[]> {
    if (!project) return [];
    const r = await docker(
        ['ps', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.Names}}'],
        {allowFail: true},
    );
    return r.stdout.trim().split('\n').filter(Boolean);
}

/**
 * Before deploying a proxy that runs here: find whatever already holds
 * 80/443 and agree to stop it (with the rest of its compose project, such
 * as a DDNS updater), offer to keep an old Caddy's certificates, and seed a
 * shared Caddyfile from the one it was serving. Mutates `c.proxy`.
 */
export async function prepareProxy(dir: string, c: Config): Promise<void> {
    if (c.proxy.type !== 'caddy' && c.proxy.type !== 'nginx') return;
    const p = c.proxy;
    const conflicts = (await portConflicts(c.project)).filter((x) => !p.replaces.includes(x.name));

    if (conflicts.length) {
        const projects = [...new Set(conflicts.map((x) => x.project).filter(Boolean))];
        const siblings = (await Promise.all(projects.map(projectContainers)))
            .flat()
            .filter((n) => !conflicts.some((x) => x.name === n));
        ui.section('Ports 80 and 443 are taken');
        ui.message(
            `${conflicts.map((x) => pc.bold(x.name) + (x.project ? pc.dim(` (compose project ${x.project})`) : '')).join(', ')} already publish 80/443.\n` +
            'The new proxy can replace them. They are stopped only once everything else is healthy and the new\n' +
            'configuration has validated, set not to restart, and started again by rollback.',
        );
        if (!ui.interactive) {
            throw new InstallerError(
                `Ports 80/443 are held by ${conflicts.map((x) => x.name).join(', ')}.`,
                `To replace them, add to the manifest:\n  proxy:\n    replaces: [${[...conflicts.map((x) => x.name), ...siblings].join(', ')}]`,
            );
        }
        if (
            !(await ui.confirm(
                `Replace ${conflicts.map((x) => x.name).join(', ')} with the new proxy?`,
                true,
            ))
        ) {
            throw new InstallerError(
                'The proxy cannot start while 80/443 are in use.',
                'Stop those containers, or choose an external proxy.',
            );
        }
        p.replaces.push(...conflicts.map((x) => x.name));
        if (
            siblings.length &&
            (await ui.confirm(
                `Also stop the rest of ${projects.join(', ')}: ${siblings.join(', ')}?`,
                true,
            ))
        ) {
            p.replaces.push(...siblings);
        }
    }

    if (p.type !== 'caddy') return;
    // A Caddy being replaced: carry over its certificates and, for a shared setup, its sites.
    for (const name of p.replaces) {
        const info = await inspect(name);
        if (!info || !/caddy/i.test(info.image)) continue;
        const data = info.mounts.find((m) => m.Destination === '/data' && m.Type === 'volume');
        if (
            data?.Name &&
            !p.dataVolume &&
            (await ui.confirm(
                `Reuse ${name}'s certificates and ACME account (volume ${data.Name})?`,
                true,
            ))
        ) {
            p.dataVolume = data.Name;
        }
        const target = join(dir, SHARED_CADDYFILE);
        if (
            p.shared &&
            !existsSync(target) &&
            (await ui.confirm(`Start your Caddyfile from the one ${name} is serving?`, true))
        ) {
            mkdirSync(join(dir, 'caddy'), {recursive: true});
            await docker(['cp', `${name}:/etc/caddy/Caddyfile`, target]);
            ui.success(`Copied ${name}'s Caddyfile to ${SHARED_CADDYFILE}.`);
        }
    }
    if (p.shared) await requireSnippetImported(dir, c);
}

/** Problems with an operator-owned Caddyfile's use of the snippet, or [] if it is wired in. */
export function sharedCaddyfileProblems(dir: string): string[] {
    const path = join(dir, SHARED_CADDYFILE);
    if (!existsSync(path)) return []; // will be seeded with both imports
    const text = readFileSync(path, 'utf8').replace(/#.*$/gm, '');
    const problems: string[] = [];
    if (!/^\s*import\s+system-design\.caddy\s*$/m.test(text))
        problems.push('the snippet file is not imported (import system-design.caddy)');
    if (!/^\s*import\s+system-design\s*$/m.test(text))
        problems.push('no site block uses it (import system-design)');
    return problems;
}

function snippetInstructions(c: Config): string {
    const d = derive(c);
    return [
        `Edit ${pc.bold(SHARED_CADDYFILE)}:`,
        '',
        `  1. Near the top, after any global options block:   ${pc.cyan('import system-design.caddy')}`,
        `  2. Inside the site block serving ${d.hosts.join(', ')}:   ${pc.cyan('import system-design')}`,
        '  3. Remove routes there that already point at the editor, store, relay or Keycloak',
        '     (the snippet provides them, reaching the services by name).',
    ].join('\n');
}

async function requireSnippetImported(dir: string, c: Config): Promise<void> {
    for (; ;) {
        const problems = sharedCaddyfileProblems(dir);
        if (!problems.length) return;
        ui.note(
            `${problems.map((p) => pc.yellow(`• ${p}`)).join('\n')}\n\n${snippetInstructions(c)}`,
            'Your Caddyfile needs two lines',
        );
        if (!ui.interactive)
            throw new InstallerError(
                `${SHARED_CADDYFILE} does not import the installer's routes.`,
                'Make the edit above and run again.',
            );
        const next = await ui.select({
            message: 'Edit the file in another terminal, then:',
            options: [
                {value: 'check', label: 'Check again'},
                {value: 'abort', label: 'Stop here'},
            ],
        });
        if (next === 'abort') throw new InstallerError('Stopped before changing anything.');
    }
}

/** Mount arguments that present this deployment's Caddy configuration at /etc/caddy. */
function caddyMount(dir: string, c: Config): string[] {
    return c.proxy.type === 'caddy' && c.proxy.shared
        ? ['-v', `${join(dir, 'caddy')}:/etc/caddy:ro`]
        : ['-v', `${join(dir, 'Caddyfile')}:/etc/caddy/Caddyfile:ro`];
}

export function caddyImage(c: Config): string | null {
    const p = c.proxy;
    if (p.type === 'cloudflare-tunnel') return c.images.caddy;
    if (p.type !== 'caddy') return null;
    if (p.acme !== 'cloudflare-dns') return c.images.caddy;
    return p.build ? `${c.project}-caddy:local` : c.images.caddyCloudflare;
}

/**
 * Checks the Caddyfile with the exact image that will run it, before any
 * running proxy is touched. With a shared Caddyfile a mistake would take
 * down every site it serves, not only this one.
 */
export async function validateCaddy(dir: string, c: Config, secrets: Secrets): Promise<void> {
    const image = caddyImage(c);
    if (!image) return;
    const r = await docker(
        [
            'run',
            '--rm',
            ...caddyMount(dir, c),
            '-e',
            'CLOUDFLARE_API_TOKEN',
            image,
            'caddy',
            'adapt',
            '--config',
            '/etc/caddy/Caddyfile',
            '--adapter',
            'caddyfile',
            '--validate',
        ],
        {
            env: {CLOUDFLARE_API_TOKEN: secrets.CLOUDFLARE_API_TOKEN ?? 'unused'},
            allowFail: true,
        },
    );
    if (r.code !== 0) {
        const detail = (r.stderr || r.stdout)
            .trim()
            .split('\n')
            .filter((l) => !/^\{"level":"(info|warn)"/.test(l))
            .slice(-6)
            .join('\n');
        throw new InstallerError(
            'The Caddyfile does not validate; nothing running was changed.',
            detail,
        );
    }
}

/** Gracefully applies a changed configuration to a running proxy. */
export async function reloadProxy(compose: Compose, c: Config): Promise<void> {
    if (!(await compose.isRunning('proxy'))) return;
    if (c.proxy.type === 'nginx')
        await compose.exec('proxy', ['sh', '-c', 'nginx -t -q && nginx -s reload']);
    else
        await compose.exec('proxy', [
            'caddy',
            'reload',
            '--config',
            '/etc/caddy/Caddyfile',
            '--adapter',
            'caddyfile',
        ]);
}

/** Stops containers being replaced, remembering how to bring them back. */
export async function takeOver(c: Config): Promise<ReplacedContainer[]> {
    const done: ReplacedContainer[] = [];
    for (const name of replacesOf(c)) {
        const info = await inspect(name);
        if (!info?.running) continue;
        await docker(['update', '--restart=no', name]);
        await docker(['stop', name]);
        done.push({name, restart: info.restart});
    }
    return done;
}

export async function giveBack(replaced: ReplacedContainer[]): Promise<void> {
    for (const r of replaced) {
        await docker(['update', `--restart=${r.restart}`, r.name], {allowFail: true});
        await docker(['start', r.name], {allowFail: true});
    }
}
