import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import YAML from 'yaml';
import type {Config} from './config/schema.ts';
import {redactConfig} from './config/secrets.ts';
import type {ImageRefs} from './render/index.ts';
import type {Draft} from './lib/util.ts';

export const STATE_DIR = '.sd-install';

export interface Deployment {
    id: string;
    at: string;
    kind: 'install' | 'upgrade' | 'reconfigure' | 'rollback';
    images: ImageRefs;
    /** Backup taken immediately before this deployment, if any. */
    backup?: string;
    status: 'ok' | 'failed' | 'rolled-back';
}

export interface State {
    schema: 1;
    installerVersion: string;
    /** sha256 of each generated file as last written, keyed by relative path. */
    files: Record<string, string>;
    deployments: Deployment[];
    /** Hostnames the current certificate was issued for (nginx + certbot). */
    certificateHosts?: string[];
}

export function statePaths(dir: string) {
    return {
        dir: join(dir, STATE_DIR),
        state: join(dir, STATE_DIR, 'state.json'),
        config: join(dir, STATE_DIR, 'config.yml'),
    };
}

export function loadState(dir: string): State | null {
    const {state} = statePaths(dir);
    if (!existsSync(state)) return null;
    return JSON.parse(readFileSync(state, 'utf8')) as State;
}

export function emptyState(installerVersion: string): State {
    return {schema: 1, installerVersion, files: {}, deployments: []};
}

function atomicWrite(path: string, content: string, mode = 0o644): void {
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, content, {mode});
    renameSync(tmp, path);
}

export function saveState(dir: string, state: State): void {
    const paths = statePaths(dir);
    mkdirSync(paths.dir, {recursive: true});
    atomicWrite(paths.state, JSON.stringify(state, null, 2) + '\n');
}

/** The answers, with secrets replaced by "stored"; used as the manifest for later runs. */
export function loadSavedConfig(dir: string): Draft | null {
    const {config} = statePaths(dir);
    if (!existsSync(config)) return null;
    return YAML.parse(readFileSync(config, 'utf8')) as Draft;
}

export function saveConfig(dir: string, config: Config): void {
    const paths = statePaths(dir);
    mkdirSync(paths.dir, {recursive: true});
    const header =
        '# Saved by system-design-installer: the answers this installation was made with.\n' +
        '# Secrets read "stored" and live in ../.env. Usable as a manifest elsewhere.\n';
    atomicWrite(paths.config, header + YAML.stringify(redactConfig(config)));
}

export function currentDeployment(state: State | null): Deployment | undefined {
    return state?.deployments.filter((d) => d.status === 'ok').at(-1);
}
