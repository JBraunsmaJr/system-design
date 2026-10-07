import type {Config} from './config/schema.ts';
import type {ImageRefs} from './render/index.ts';
import {InstallerError} from './lib/util.ts';

/**
 * The publish workflows tag each image with the UTC date it was built and,
 * for non-prereleases, `latest`. The three images are built by separate
 * workflows, so their dates can differ: each is resolved on its own.
 *
 * "latest" resolves to the dated tag sharing latest's digest, so what gets
 * written to .env is a fixed reference that rollback can return to.
 */

const DATE_TAG = /^\d{4}-\d{2}-\d{2}$/;
const MANIFEST_ACCEPT = [
    'application/vnd.oci.image.index.v1+json',
    'application/vnd.docker.distribution.manifest.list.v2+json',
    'application/vnd.oci.image.manifest.v1+json',
    'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

export const IMAGE_NAMES: Record<keyof ImageRefs, string> = {
    editor: 'system-design',
    relay: 'system-design-relay',
    store: 'system-design-store',
};

export function repositoryFor(c: Config, which: keyof ImageRefs): string {
    return `${c.images.registry.replace(/\/+$/, '')}/${IMAGE_NAMES[which]}`;
}

interface Repo {
    host: string;
    path: string;
}

function parseRepo(repository: string): Repo {
    const [first, ...rest] = repository.split('/');
    if (!first || !rest.length || !/[.:]/.test(first)) {
        // Docker Hub shorthand.
        return {
            host: 'registry-1.docker.io',
            path: rest.length ? repository : `library/${repository}`,
        };
    }
    return {host: first, path: rest.join('/')};
}

class RegistryClient {
    private token: string | null = null;
    private readonly repo: Repo;
    private readonly fetcher: typeof fetch;

    constructor(repository: string, fetcher: typeof fetch = fetch) {
        this.repo = parseRepo(repository);
        this.fetcher = fetcher;
    }

    private async request(path: string, init: RequestInit = {}): Promise<Response> {
        const url = `https://${this.repo.host}/v2/${this.repo.path}${path}`;
        const headers = new Headers(init.headers);
        if (this.token) headers.set('Authorization', `Bearer ${this.token}`);
        let response = await this.fetcher(url, {
            ...init,
            headers,
            signal: AbortSignal.timeout(15000),
        });
        if (response.status === 401 && !this.token) {
            await this.authenticate(response.headers.get('www-authenticate') ?? '');
            headers.set('Authorization', `Bearer ${this.token}`);
            response = await this.fetcher(url, {...init, headers, signal: AbortSignal.timeout(15000)});
        }
        return response;
    }

    /** Anonymous bearer token, from the challenge the registry sent back. */
    private async authenticate(challenge: string): Promise<void> {
        const params = Object.fromEntries(
            [...challenge.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
        );
        if (!params.realm)
            throw new InstallerError(
                `${this.repo.host} asked for authentication this installer cannot provide.`,
            );
        const url = new URL(params.realm);
        if (params.service) url.searchParams.set('service', params.service);
        url.searchParams.set('scope', params.scope ?? `repository:${this.repo.path}:pull`);
        const r = await this.fetcher(url, {signal: AbortSignal.timeout(15000)});
        if (!r.ok)
            throw new InstallerError(`Could not get a pull token from ${url.host} (${r.status}).`);
        const body = (await r.json()) as { token?: string; access_token?: string };
        this.token = body.token ?? body.access_token ?? null;
    }

    async tags(): Promise<string[]> {
        const all: string[] = [];
        let next: string | null = '/tags/list?n=1000';
        while (next) {
            const r = await this.request(next);
            if (!r.ok)
                throw new InstallerError(`Listing tags for ${this.repo.path} failed (${r.status}).`);
            const body = (await r.json()) as { tags?: string[] | null };
            all.push(...(body.tags ?? []));
            const link = r.headers.get('link');
            const m = link?.match(/<[^>]*\/tags\/list(\?[^>]*)>/);
            next = m ? `/tags/list${m[1]}` : null;
        }
        return all;
    }

    async digest(tag: string): Promise<string | null> {
        const r = await this.request(`/manifests/${tag}`, {
            method: 'HEAD',
            headers: {Accept: MANIFEST_ACCEPT},
        });
        if (r.status === 404) return null;
        if (!r.ok) throw new InstallerError(`Reading ${this.repo.path}:${tag} failed (${r.status}).`);
        return r.headers.get('docker-content-digest');
    }
}

export interface Resolution {
    ref: string;
    /** Human-facing version: the date tag, or the digest when no tag matched. */
    version: string;
    note?: string;
}

export async function resolveImage(
    repository: string,
    wanted: string,
    fetcher?: typeof fetch,
): Promise<Resolution> {
    if (wanted.startsWith('sha256:'))
        return {ref: `${repository}@${wanted}`, version: wanted.slice(0, 19)};
    if (wanted !== 'latest') return {ref: `${repository}:${wanted}`, version: wanted};

    const client = new RegistryClient(repository, fetcher);
    let latestDigest: string | null;
    let dated: string[];
    try {
        latestDigest = await client.digest('latest');
        dated = (await client.tags())
            .filter((t) => DATE_TAG.test(t))
            .sort()
            .reverse();
    } catch (error) {
        if (error instanceof InstallerError) throw error;
        throw new InstallerError(
            `Could not reach the registry for ${repository}: ${(error as Error).message}`,
            'Check outbound HTTPS, or pin versions in the manifest (versions.store: 2026-10-03) to skip the lookup.',
        );
    }
    if (!latestDigest) throw new InstallerError(`${repository} has no "latest" tag.`);
    // The newest dated tag almost always matches; look a little further for a same-day rebuild.
    for (const tag of dated.slice(0, 14)) {
        if ((await client.digest(tag)) === latestDigest)
            return {ref: `${repository}:${tag}`, version: tag};
    }
    return {
        ref: `${repository}@${latestDigest}`,
        version: latestDigest.slice(0, 19),
        note: `no dated tag of ${repository} matches latest; pinned by digest instead`,
    };
}

export async function resolveAll(
    c: Config,
    wanted: Partial<ImageRefs> = {},
    fetcher?: typeof fetch,
): Promise<Record<keyof ImageRefs, Resolution>> {
    const which = Object.keys(IMAGE_NAMES) as (keyof ImageRefs)[];
    const results = await Promise.all(
        which.map((w) => resolveImage(repositoryFor(c, w), wanted[w] ?? c.versions[w], fetcher)),
    );
    return Object.fromEntries(which.map((w, i) => [w, results[i]!])) as Record<
        keyof ImageRefs,
        Resolution
    >;
}

export function refsOf(r: Record<keyof ImageRefs, Resolution>): ImageRefs {
    return {editor: r.editor.ref, relay: r.relay.ref, store: r.store.ref};
}

/** "ghcr.io/x/system-design-store:2026-10-03" → "2026-10-03". */
export function versionOf(ref: string): string {
    const at = ref.indexOf('@');
    if (at >= 0) return ref.slice(at + 1, at + 20);
    return ref.slice(ref.lastIndexOf(':') + 1);
}
