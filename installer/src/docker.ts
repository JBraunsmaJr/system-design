import {spawn} from 'node:child_process';
import {closeSync, existsSync, openSync, readFileSync} from 'node:fs';
import {hostname} from 'node:os';
import {join} from 'node:path';
import {InstallerError} from './lib/util.ts';

export interface RunResult {
    code: number;
    stdout: string;
    stderr: string;
}

export interface RunOptions {
    cwd?: string;
    input?: string;
    /** Stream stdout to this file instead of capturing it (for dumps). */
    stdoutFile?: string;
    /** Feed this file to stdin (for restores). */
    stdinFile?: string;
    env?: Record<string, string>;
    /** Return non-zero exits instead of throwing. */
    allowFail?: boolean;
}

export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
    return new Promise((resolve, reject) => {
        const outFd = opts.stdoutFile ? openSync(opts.stdoutFile, 'w', 0o600) : null;
        const inFd = opts.stdinFile ? openSync(opts.stdinFile, 'r') : null;
        const child = spawn(cmd, args, {
            cwd: opts.cwd,
            env: {...process.env, ...opts.env},
            stdio: [inFd ?? 'pipe', outFd ?? 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (d) => (stdout += d));
        child.stderr?.on('data', (d) => (stderr += d));
        if (opts.input !== undefined) child.stdin?.end(opts.input);
        else child.stdin?.end();
        child.on('error', (error) => {
            if (outFd !== null) closeSync(outFd);
            if (inFd !== null) closeSync(inFd);
            reject(
                (error as NodeJS.ErrnoException).code === 'ENOENT'
                    ? new InstallerError(`${cmd} is not available in this container.`)
                    : error,
            );
        });
        child.on('close', (code) => {
            if (outFd !== null) closeSync(outFd);
            if (inFd !== null) closeSync(inFd);
            const result = {code: code ?? 1, stdout, stderr};
            if (result.code !== 0 && !opts.allowFail) {
                const tail = (stderr || stdout).trim().split('\n').slice(-15).join('\n');
                reject(
                    new InstallerError(
                        `${cmd} ${args.slice(0, 4).join(' ')}… exited with ${result.code}`,
                        tail || undefined,
                    ),
                );
            } else resolve(result);
        });
    });
}

export const docker = (args: string[], opts?: RunOptions) => run('docker', args, opts);

export interface ServiceStatus {
    service: string;
    state: string;
    health: string;
    image: string;
}

/** `docker compose` bound to one install directory and project. */
export class Compose {
    readonly dir: string;
    readonly project: string;

    constructor(dir: string, project: string) {
        this.dir = dir;
        this.project = project;
    }

    private base(): string[] {
        return [
            'compose',
            '-p',
            this.project,
            '--project-directory',
            this.dir,
            '-f',
            join(this.dir, 'compose.yml'),
            '--env-file',
            join(this.dir, '.env'),
        ];
    }

    run(args: string[], opts?: RunOptions): Promise<RunResult> {
        return docker([...this.base(), ...args], {cwd: this.dir, ...opts});
    }

    validate(): Promise<RunResult> {
        return this.run(['config', '--quiet']);
    }

    pull(): Promise<RunResult> {
        return this.run(['pull', '--quiet', '--ignore-buildable']);
    }

    build(): Promise<RunResult> {
        return this.run(['build', '--pull']);
    }

    up(opts: { services?: string[]; timeoutSeconds?: number } = {}): Promise<RunResult> {
        return this.run([
            'up',
            '-d',
            '--remove-orphans',
            '--wait',
            '--wait-timeout',
            String(opts.timeoutSeconds ?? 300),
            ...(opts.services ?? []),
        ]);
    }

    stop(services: string[]): Promise<RunResult> {
        return this.run(['stop', ...services]);
    }

    start(services: string[]): Promise<RunResult> {
        return this.run(['up', '-d', '--wait', ...services]);
    }

    exec(
        service: string,
        command: string[],
        opts: RunOptions & { env?: Record<string, string> } = {},
    ): Promise<RunResult> {
        const envArgs = Object.entries(opts.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
        return this.run(['exec', '-T', ...envArgs, service, ...command], {...opts, env: undefined});
    }

    /** Handles both output styles: one JSON object per line (newer) and a JSON array (older). */
    async ps(): Promise<ServiceStatus[]> {
        if (!existsSync(join(this.dir, 'compose.yml'))) return [];
        const {stdout} = await this.run(['ps', '--all', '--format', 'json'], {allowFail: true});
        const text = stdout.trim();
        if (!text) return [];
        const rows: Record<string, string>[] = text.startsWith('[')
            ? JSON.parse(text)
            : text.split('\n').map((l) => JSON.parse(l));
        return rows.map((r) => ({
            service: r.Service ?? '',
            state: r.State ?? '',
            health: r.Health ?? '',
            image: r.Image ?? '',
        }));
    }

    async services(): Promise<string[]> {
        const {stdout} = await this.run(['config', '--services']);
        return stdout.trim().split('\n').filter(Boolean);
    }

    async isRunning(service: string): Promise<boolean> {
        return (await this.ps()).some((s) => s.service === service && s.state === 'running');
    }

    async volumeExists(name: string): Promise<boolean> {
        const r = await docker(['volume', 'inspect', `${this.project}_${name}`], {allowFail: true});
        return r.code === 0;
    }
}

export function inContainer(): boolean {
    return (
        existsSync('/.dockerenv') ||
        (existsSync('/proc/1/cgroup') &&
            /docker|containerd|kubepods/.test(readFileSync('/proc/1/cgroup', 'utf8')))
    );
}

/**
 * Compose resolves "./keys/…" against the *host's* filesystem, because the
 * daemon does the mounting. So the install directory must appear at the same
 * path inside this container as on the host, or bind mounts silently end up
 * as empty directories.
 */
export async function checkSamePathMount(dir: string): Promise<{ ok: boolean; detail: string }> {
    if (!inContainer()) return {ok: true, detail: 'running directly on the host'};
    const r = await docker(['inspect', hostname(), '--format', '{{json .Mounts}}'], {
        allowFail: true,
    });
    if (r.code !== 0)
        return {ok: true, detail: 'could not inspect this container; assuming the mount is correct'};
    const mounts = JSON.parse(r.stdout.trim() || '[]') as { Source: string; Destination: string }[];
    const mount = mounts
        .filter((m) => dir === m.Destination || dir.startsWith(m.Destination.replace(/\/?$/, '/')))
        .sort((a, b) => b.Destination.length - a.Destination.length)[0];
    if (!mount)
        return {
            ok: false,
            detail: `${dir} is not a mounted directory, so nothing written there would survive or be visible to compose`,
    };
    const hostPath = mount.Source + dir.slice(mount.Destination.length);
    return hostPath === dir
        ? {ok: true, detail: `${dir} is mounted at the same path`}
        : {
            ok: false,
            detail: `${dir} is ${hostPath} on the host; mount it as -v ${hostPath}:${hostPath} -w ${hostPath}`,
        };
}
