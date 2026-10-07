import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runWizard} from '../src/wizard.ts';
import {parseEnvFile, redactConfig, resolveSecrets} from '../src/config/secrets.ts';
import {derive} from '../src/config/derive.ts';
import {renderAll} from '../src/render/index.ts';
import {applyPlan, planFiles} from '../src/files.ts';
import {emptyState} from '../src/state.ts';
import {resolveImage} from '../src/registry.ts';
import {ui} from '../src/lib/ui.ts';
import type {Config} from '../src/config/schema.ts';

ui.interactive = false;
const dir = () => mkdtempSync(join(tmpdir(), 'sd-unit-'));
const images = {editor: 'e:1', relay: 'r:1', store: 's:1'};

async function config(extra: Record<string, unknown> = {}): Promise<Config> {
    return runWizard(
        {
            domain: 'design.example.com',
            project: 'sd',
            proxy: {type: 'caddy', acme: 'http'},
            identity: {type: 'keycloak'},
            ...extra,
        },
        dir(),
    );
}

test('non-interactive wizard applies defaults and validates', async () => {
    const c = await config();
    assert.equal(c.routing.mode, 'path');
    assert.equal(c.turn.type, 'none');
    assert.equal(c.recovery.mode, 'generate');
    assert.equal(c.store.retention, '30d');
    assert.equal(c.versions.store, 'latest');
    assert.equal(c.identity.type === 'keycloak' && c.identity.initialUser, undefined);
});

test('non-interactive wizard names every missing required value', async () => {
    await assert.rejects(
        runWizard({domain: 'design.example.com'}, dir()),
        (e: Error) => /proxy\.type/.test(e.message) && /identity\.type/.test(e.message),
    );
});

test('cloudflare DNS without a token is rejected', async () => {
    await assert.rejects(
        runWizard(
            {
        domain: 'a.example.com',
        project: 'x',
                proxy: {type: 'caddy', acme: 'cloudflare-dns'},
                identity: {type: 'keycloak'},
            },
            dir(),
        ),
        /cloudflareApiToken/,
    );
});

test('secrets: explicit beats stored beats generated, and DB passwords are protected', async () => {
    const c = await config({secrets: {relayTokenSecret: 'explicit-relay-secret'}});
    const first = resolveSecrets(c, {});
    assert.equal(first.values.RELAY_TOKEN_SECRET, 'explicit-relay-secret');
    assert.ok(first.generated.includes('POSTGRES_PASSWORD'));

    const again = resolveSecrets(c, first.values);
    assert.equal(
        again.values.POSTGRES_PASSWORD,
        first.values.POSTGRES_PASSWORD,
        'generate keeps the stored value',
    );
    assert.deepEqual(again.generated, []);

    const changed = await config({secrets: {postgresPassword: 'different'}});
    assert.throws(
        () => resolveSecrets(changed, first.values, {databasesExist: true}),
        /differs from the value the database was created with/,
    );
    assert.doesNotThrow(() =>
        resolveSecrets(changed, first.values, {databasesExist: true, allowInitOnlyChange: true}),
    );
});

test('secrets: postgres password must be URL-safe; quotes are refused', async () => {
    assert.throws(() => resolveSecrets(config0('p@ss/word'), {}), /database URL/);
    assert.throws(() => resolveSecrets(config0("it's"), {}), /single quote|database URL/);
});
function config0(pw: string): Config {
    return {
        proxy: {type: 'external', upstreamHost: '10.0.0.1', bindAddress: '0.0.0.0'},
        identity: {type: 'github', clientId: 'x', clientSecret: 'y'},
        turn: {type: 'none'},
        secrets: {postgresPassword: pw, relayTokenSecret: 'generate'},
    } as unknown as Config;
}

test('redacted config stores no secret values', async () => {
    const c = await config({secrets: {relayTokenSecret: 'super-secret-value'}});
    assert.ok(!JSON.stringify(redactConfig(c)).includes('super-secret-value'));
});

test('env file round trip', () => {
    const env = parseEnvFile('# c\nA=\'x y\'\nB="z"\nexport C=w\n\nbad line\n');
    assert.deepEqual(env, {A: 'x y', B: 'z', C: 'w'});
});

test('derive: path mode keeps the URLs the original deployment used', async () => {
    const c = await config({domain: 'editor.home.jbraunsma.dev'});
    const d = derive(c);
    assert.equal(d.editorUrl, 'https://editor.home.jbraunsma.dev/editor');
    assert.equal(d.afterLoginUrl, 'https://editor.home.jbraunsma.dev/editor/');
    assert.equal(d.storeUrl, 'https://editor.home.jbraunsma.dev/store');
    assert.equal(d.relayUrl, 'wss://editor.home.jbraunsma.dev/relay');
    assert.equal(
        d.keycloak?.issuer,
        'https://editor.home.jbraunsma.dev/keycloak/realms/system-design',
    );
    assert.deepEqual(d.allowedOrigins, []);
});

test('derive: subdomain mode needs ALLOWED_ORIGINS and serves Keycloak at its root', async () => {
    const c = await config({routing: {mode: 'subdomain'}});
    const d = derive(c);
    assert.equal(d.storeUrl, 'https://store.design.example.com');
    assert.deepEqual(d.allowedOrigins, ['https://design.example.com']);
    assert.equal(d.keycloak?.relativePath, '/');
    assert.equal(d.keycloak?.issuer, 'https://auth.design.example.com/realms/system-design');
});

test("bundled TURN feeds ICE_SERVERS in the editor's url|user|pass format", async () => {
    const c = await config({turn: {type: 'bundled', host: 'turn.example.com'}});
    assert.match(
        derive(c).iceServers,
        /^stun:turn\.example\.com:3478,turn:turn\.example\.com:3478\?transport=udp\|webrtc\|\$\{TURN_PASSWORD\}/,
    );
});

test('realm file carries no demo users and no secret', async () => {
    const c = await config({identity: {type: 'keycloak', groups: ['team-a']}});
    const secrets = resolveSecrets(c, {}).values;
    const realm = renderAll({config: c, secrets, images}).find(
        (f) => f.path === 'keycloak-realm.json',
    )!;
    const parsed = JSON.parse(realm.content);
    assert.equal(parsed.users, undefined);
    assert.equal(parsed.clients[0].secret, '${OIDC_CLIENT_SECRET}');
    assert.deepEqual(parsed.groups, [{name: 'team-a'}]);
    assert.ok(!realm.content.includes(secrets.OIDC_CLIENT_SECRET!));
});

test('file plan: hand edits are conflicts, untouched files are updates, dropped files are stale', async () => {
    const d = dir();
    const c = await config();
    const secrets = resolveSecrets(c, {}).values;
    const state = emptyState('test');
    applyPlan(d, planFiles(d, renderAll({config: c, secrets, images}), state), state);

    writeFileSync(
        join(d, 'Caddyfile'),
        readFileSync(join(d, 'Caddyfile'), 'utf8') + '\n# my tweak\n',
    );
    const c2 = await config({
        domain: 'other.example.com',
        proxy: {type: 'nginx', tls: 'certbot-http'},
    });
    const plan = planFiles(d, renderAll({config: c2, secrets, images}), state);
    const by = Object.fromEntries(plan.map((p) => [p.path, p.status]));
    assert.equal(by['compose.yml'], 'update');
    assert.equal(by['nginx/default.conf'], 'new');
    assert.equal(by['Caddyfile'], 'stale-modified');
    assert.equal(by['.env'], 'unchanged');

    writeFileSync(join(d, 'compose.yml'), '# replaced by hand\n');
    const plan2 = planFiles(d, renderAll({config: c2, secrets, images}), state);
    assert.equal(plan2.find((p) => p.path === 'compose.yml')!.status, 'conflict');
});

// ------------------------------------------------------------- registry

function fakeRegistry(
    tags: Record<string, string>,
    opts: { requireToken?: boolean } = {},
): typeof fetch {
    return (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === '/token') return new Response(JSON.stringify({token: 'anon'}));
        const auth = new Headers(init?.headers).get('authorization');
        if (opts.requireToken && auth !== 'Bearer anon') {
            return new Response('', {
                status: 401,
                headers: {
                    'www-authenticate': `Bearer realm="https://${url.host}/token",service="${url.host}",scope="repository:x:pull"`,
                },
            });
        }
        if (url.pathname.endsWith('/tags/list'))
            return new Response(JSON.stringify({tags: Object.keys(tags)}));
        const tag = url.pathname.split('/manifests/')[1]!;
        return tags[tag]
            ? new Response(null, {status: 200, headers: {'docker-content-digest': tags[tag]!}})
            : new Response(null, {status: 404});
    }) as typeof fetch;
}

test('registry: latest resolves to the dated tag with the same digest, authenticating anonymously', async () => {
    const f = fakeRegistry(
        {
            latest: 'sha256:bbb',
            '2026-10-03': 'sha256:bbb',
            '2026-09-20': 'sha256:aaa',
            'pr-12': 'sha256:ccc',
        },
        {requireToken: true},
    );
    const r = await resolveImage('ghcr.io/jbraunsmajr/system-design-store', 'latest', f);
    assert.equal(r.ref, 'ghcr.io/jbraunsmajr/system-design-store:2026-10-03');
});

test('registry: a prerelease newer than latest is skipped', async () => {
    const f = fakeRegistry({
        latest: 'sha256:aaa',
        '2026-10-05': 'sha256:pre',
        '2026-10-01': 'sha256:aaa',
    });
    const r = await resolveImage('ghcr.io/x/system-design', 'latest', f);
    assert.equal(r.version, '2026-10-01');
});

test('registry: no matching dated tag falls back to the digest', async () => {
    const f = fakeRegistry({latest: 'sha256:0123456789abcdef0123', '2026-10-01': 'sha256:other'});
    const r = await resolveImage('ghcr.io/x/system-design', 'latest', f);
    assert.equal(r.ref, 'ghcr.io/x/system-design@sha256:0123456789abcdef0123');
    assert.ok(r.note);
});

test('registry: pinned versions need no network', async () => {
    const r = await resolveImage('ghcr.io/x/system-design', '2026-09-01', (() => {
        throw new Error('no network');
    }) as unknown as typeof fetch);
    assert.equal(r.ref, 'ghcr.io/x/system-design:2026-09-01');
});

test('Cloudflare DNS uses the prebuilt image unless asked to build', async () => {
    const base = {proxy: {type: 'caddy', acme: 'cloudflare-dns', cloudflareApiToken: 'cf'}};
    const prebuilt = await config(base);
    const files = renderAll({
        config: prebuilt,
        secrets: resolveSecrets(prebuilt, {}).values,
        images,
    });
    const compose = files.find((f) => f.path === 'compose.yml')!.content;
    assert.match(compose, /image: slothcroissant\/caddy-cloudflaredns:2\.11\.2/);
    assert.ok(!compose.includes('build:'));
    assert.ok(!files.some((f) => f.path === 'caddy/Dockerfile'));

    const built = await config({proxy: {...base.proxy, build: true}});
    const bfiles = renderAll({config: built, secrets: resolveSecrets(built, {}).values, images});
    assert.match(
        bfiles.find((f) => f.path === 'compose.yml')!.content,
        /build:\n\s+context: \.\/caddy/,
    );
    assert.match(
        bfiles.find((f) => f.path === 'caddy/Dockerfile')!.content,
        /xcaddy build --with github\.com\/caddy-dns\/cloudflare/,
    );
});

test('dynamic DNS shares the DNS-01 token, or needs its own', async () => {
    const shared = await config({
        proxy: {type: 'caddy', acme: 'cloudflare-dns', cloudflareApiToken: 'cf'},
        ddns: {enabled: true},
        turn: {type: 'bundled', host: 'turn.example.com'},
    });
    const env = renderAll({
        config: shared,
        secrets: resolveSecrets(shared, {}).values,
        images,
    }).find((f) => f.path === '.env')!.content;
    assert.equal((env.match(/CLOUDFLARE_API_TOKEN=/g) ?? []).length, 1);
    const compose = renderAll({
        config: shared,
        secrets: resolveSecrets(shared, {}).values,
        images,
    }).find((f) => f.path === 'compose.yml')!.content;
    assert.match(compose, /DOMAINS: design\.example\.com,turn\.example\.com/);
    assert.match(compose, /PROXIED: "false"/);

    await assert.rejects(config({ddns: {enabled: true}}), /ddns\.cloudflareApiToken/);
    const own = await config({ddns: {enabled: true, cloudflareApiToken: 'ddns-only'}});
    assert.equal(resolveSecrets(own, {}).values.CLOUDFLARE_API_TOKEN, 'ddns-only');

    await assert.rejects(
        config({
            proxy: {type: 'external', upstreamHost: '10.0.0.2'},
            ddns: {enabled: true, cloudflareApiToken: 'x'},
        }),
        /dynamic DNS belongs with the proxy/,
    );
});
