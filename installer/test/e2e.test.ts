// End-to-end: runs the real CLI with a fake `docker` on PATH (test/fake-docker).
// `compose config` is forwarded to a real compose binary named by REAL_COMPOSE;
// the test is skipped when that is not set.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const realCompose = process.env.REAL_COMPOSE;
// The hand-made deployment the installer adopts: compose, Caddyfile, realm and TURN config as they were.
process.env.PROD_FIXTURE ??= join(root, 'test/fixtures/prod');

function cli(dir: string, state: string, args: string[], env: Record<string, string> = {}) {
    const r = spawnSync(
        process.execPath,
        [
            join(root, 'src/main.ts'),
            ...args,
            '--dir',
            dir,
            '--non-interactive',
            '--yes',
            '--skip-mount-check',
            '--no-diff',
        ],
        {
            env: {
                ...process.env,
                PATH: `${join(root, 'test/fake-docker')}:${process.env.PATH}`,
                FAKE_DOCKER_STATE: state,
                REAL_COMPOSE: realCompose!,
                REAL_CADDY: process.env.REAL_CADDY ?? 'caddy',
                NO_COLOR: '1',
                ...env,
            },
            encoding: 'utf8',
        },
    );
    return {code: r.status, out: `${r.stdout}\n${r.stderr}`};
}
const env = (dir: string) => readFileSync(join(dir, '.env'), 'utf8');
const state = (dir: string) =>
    JSON.parse(readFileSync(join(dir, '.sd-install/state.json'), 'utf8'));
const kc = (s: string) => JSON.parse(readFileSync(join(s, 'keycloak.json'), 'utf8'));

test(
    'install → upgrade → failed upgrade rolls back → rollback → hand edits',
    {skip: !realCompose && 'set REAL_COMPOSE'},
    () => {
    const dir = mkdtempSync(join(tmpdir(), 'sd-e2e-'));
    const s = mkdtempSync(join(tmpdir(), 'sd-fake-'));
    const manifest = join(root, 'examples/caddy-cloudflare.yml');
        const cf = {CLOUDFLARE_API_TOKEN: 'cf-token'};

    // ---- install
    let r = cli(dir, s, ['install', '-m', manifest, '--to', '2026-10-01'], cf);
    assert.equal(r.code, 0, r.out);
        for (const f of [
            'compose.yml',
            '.env',
            'Caddyfile',
            'keycloak-realm.json',
            'keys/recovery-public.pem',
            '.sd-install/config.yml',
        ]) {
            assert.ok(existsSync(join(dir, f)), `${f} missing\n${r.out}`);
    }
    assert.match(env(dir), /STORE_IMAGE='ghcr\.io\/jbraunsmajr\/system-design-store:2026-10-01'/);
    assert.match(env(dir), /CLOUDFLARE_API_TOKEN='cf-token'/);
        const composeText = readFileSync(join(dir, 'compose.yml'), 'utf8');
        assert.match(
            composeText,
            /image: slothcroissant\/caddy-cloudflaredns:2\.11\.2/,
            'prebuilt Cloudflare Caddy image',
        );
        assert.ok(
            !composeText.includes('build:') && !existsSync(join(dir, 'caddy/Dockerfile')),
            'nothing to build',
        );
        assert.match(composeText, /ddns:[\s\S]*DOMAINS: editor\.example\.com/, 'dynamic DNS service');
        assert.equal(
            (env(dir).match(/CLOUDFLARE_API_TOKEN=/g) ?? []).length,
            1,
            'one token shared by Caddy and DDNS',
        );
        assert.ok(
            !readFileSync(join(s, 'calls.log'), 'utf8').includes(' build'),
            'no image build was run',
        );
        assert.ok(
            !readFileSync(join(dir, '.sd-install/config.yml'), 'utf8').includes('cf-token'),
            'secret leaked into config.yml',
        );
    assert.match(r.out, /recovery-private\.pem/, 'operator told about the private key');
    const k = kc(s);
        assert.ok(
            k.users.some((u: { username: string }) => u.username === 'jdoe'),
            'first user created',
        );
        assert.ok(
            k.groups.some((g: { name: string }) => g.name === 'design-team-a'),
            'group created',
        );
    assert.ok(k.updates.length >= 1, 'client reconciled');
        assert.match(
            readFileSync(join(dir, 'compose.yml'), 'utf8'),
            /ADMIN_SUBJECTS: https:\/\/editor\.example\.com\/keycloak\/realms\/system-design#uid-jdoe/,
        );
    assert.match(r.out, /demo/, 'warns about demo accounts');
    assert.equal(state(dir).deployments.at(-1).status, 'ok');

    // ---- installing twice is refused
    r = cli(dir, s, ['install', '-m', manifest], cf);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /already has an installation/);

    // ---- upgrade
    r = cli(dir, s, ['upgrade', '--to', '2026-10-05']);
    assert.equal(r.code, 0, r.out);
    assert.match(env(dir), /system-design-store:2026-10-05/);
    const upgraded = state(dir).deployments.at(-1);
    assert.equal(upgraded.kind, 'upgrade');
        assert.ok(
            upgraded.backup && existsSync(join(dir, 'backups', upgraded.backup, 'store.dump')),
            'pre-upgrade backup with a dump',
        );

    // ---- nothing to do
    r = cli(dir, s, ['upgrade', '--to', '2026-10-05']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Nothing to change/);

    // ---- failing upgrade restores the previous configuration
    r = cli(dir, s, ['upgrade', '--store', 'broken-build']);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /previous version is running again/);
    assert.match(env(dir), /system-design-store:2026-10-05/);
    assert.equal(state(dir).deployments.at(-1).status, 'failed');

    // ---- rollback the successful upgrade, with data
    r = cli(dir, s, ['rollback', '--with-data']);
    assert.equal(r.code, 0, r.out);
    assert.match(env(dir), /system-design-store:2026-10-01/);
    assert.match(readFileSync(join(s, 'restores.log'), 'utf8'), /postgres/);
    const after = state(dir).deployments;
    assert.equal(after.at(-1).kind, 'rollback');
    assert.equal(after.find((d: { id: string }) => d.id === upgraded.id).status, 'rolled-back');

    // ---- a hand edit blocks a non-interactive upgrade until --force
        writeFileSync(
            join(dir, 'Caddyfile'),
            readFileSync(join(dir, 'Caddyfile'), 'utf8') + '\n# local tweak\n',
        );
        r = cli(dir, s, ['reconfigure', '-m', join(root, 'examples/caddy-cloudflare.yml')], {...cf});
    // Same answers: nothing to re-render except the edited file going back.
    r = cli(dir, s, ['upgrade', '--to', '2026-10-07']);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /edited by hand/);
    r = cli(dir, s, ['upgrade', '--to', '2026-10-07', '--force']);
    assert.equal(r.code, 0, r.out);
    assert.ok(!readFileSync(join(dir, 'Caddyfile'), 'utf8').includes('local tweak'));

    // ---- status and backup listing work
    r = cli(dir, s, ['status', '--no-updates']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /2026-10-07/);
    r = cli(dir, s, ['backup', '--list']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /before upgrade/);
    },
);

test(
    'adopting the hand-made Prod deployment keeps its secrets and volumes',
    {skip: !realCompose && 'set REAL_COMPOSE'},
    () => {
    const prod = process.env.PROD_FIXTURE;
    if (!prod) return;
    const dir = join(mkdtempSync(join(tmpdir(), 'sd-adopt-')), 'Prod');
    const s = mkdtempSync(join(tmpdir(), 'sd-fake-'));
        cpSync(prod, dir, {recursive: true});
        mkdirSync(join(dir, 'keys'), {recursive: true});
        writeFileSync(
            join(dir, 'keys/recovery-public.pem'),
            '-----BEGIN PUBLIC KEY-----\nOLD\n-----END PUBLIC KEY-----\n',
        );
        writeFileSync(
            join(dir, '.env'),
            'DOMAIN=editor.home.jbraunsma.dev\nPOSTGRES_PASSWORD=existingpw\nKEYCLOAK_DB_PASSWORD=existingkc\nKEYCLOAK_ADMIN_PASSWORD=adminpw\nOIDC_CLIENT_SECRET=existingsecret\nRELAY_TOKEN_SECRET=existingrelay\nVERSION=latest\n',
        );
        writeFileSync(
            join(s, 'world.json'),
            JSON.stringify({running: ['postgres', 'keycloak-db', 'keycloak'], volumes: true}),
        );

        const r = cli(dir, s, [
            'install',
            '-m',
            join(root, 'examples/external-caddy.yml'),
            '--to',
            '2026-10-01',
        ]);
    assert.equal(r.code, 0, r.out);
    const e = env(dir);
        for (const v of ['existingpw', 'existingkc', 'existingsecret', 'existingrelay', 'adminpw'])
            assert.ok(e.includes(v), `${v} not kept`);
        const adopted = readFileSync(
            join(dir, '.sd-install', readdirOne(join(dir, '.sd-install'), 'adopted-'), 'compose.yml'),
            'utf8',
        );
    assert.match(adopted, /VERSION:-latest/, 'original compose kept aside');
    assert.match(readFileSync(join(dir, 'compose.yml'), 'utf8'), /^name: prod$/m);
    assert.match(readFileSync(join(dir, 'compose.yml'), 'utf8'), /"192\.168\.2\.146:8889:8080"/);
        assert.ok(
            !readFileSync(join(dir, 'compose.yml'), 'utf8').includes('5433'),
            'postgres no longer published',
        );
    assert.ok(existsSync(join(dir, 'proxy-snippets/Caddyfile')));
        assert.ok(
            !readFileSync(join(dir, 'turnserver.conf'), 'utf8').includes('fixture-password'),
            'old TURN credential gone',
        );
        assert.ok(
            state(dir).deployments.at(-1).backup,
            'adoption backed up the running databases first',
        );
    },
);

test(
    'one shared Caddy replaces an existing Caddy + DDNS stack, and rollback hands 80/443 back',
    {
        skip:
            (!realCompose || !process.env.REAL_CADDY || !process.env.PROD_FIXTURE) &&
            'set REAL_COMPOSE, REAL_CADDY, PROD_FIXTURE',
    },
    () => {
        const prod = process.env.PROD_FIXTURE!;
        const dir = join(mkdtempSync(join(tmpdir(), 'sd-shared-')), 'Prod');
        const s = mkdtempSync(join(tmpdir(), 'sd-fake-'));
        cpSync(prod, dir, {recursive: true});
        mkdirSync(join(dir, 'keys'), {recursive: true});
        writeFileSync(
            join(dir, 'keys/recovery-public.pem'),
            '-----BEGIN PUBLIC KEY-----\nOLD\n-----END PUBLIC KEY-----\n',
        );
        writeFileSync(
            join(dir, '.env'),
            'POSTGRES_PASSWORD=existingpw\nKEYCLOAK_DB_PASSWORD=existingkc\nKEYCLOAK_ADMIN_PASSWORD=adminpw\nOIDC_CLIENT_SECRET=existingsecret\nRELAY_TOKEN_SECRET=existingrelay\nCLOUDFLARE_API_TOKEN=cf-token\n',
        );
        // The separate stack as it runs today, serving the original wildcard Caddyfile.
        const liveCaddyfile = readFileSync(join(prod, 'Caddyfile'), 'utf8').replace(/\r/g, '');
        writeFileSync(
            join(s, 'world.json'),
            JSON.stringify({
                running: ['postgres', 'keycloak-db', 'keycloak'],
                volumes: true,
                foreign: [
                    {
                        name: 'caddy-caddy-1',
                        project: 'caddy',
                        image: 'slothcroissant/caddy-cloudflaredns:latest',
                        ports: '0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp',
                        running: true,
                        restart: 'unless-stopped',
                        mounts: [
                            {
                                Type: 'volume',
                                Name: 'caddy_caddy_data',
                                Source: '/var/lib/docker/volumes/caddy_caddy_data/_data',
                                Destination: '/data',
                            },
                        ],
                        caddyfile: liveCaddyfile,
                    },
                    {
                        name: 'caddy-cloudflare-ddns-1',
                        project: 'caddy',
                        image: 'favonia/cloudflare-ddns:latest',
                        ports: '',
                        running: true,
                        restart: 'unless-stopped',
                        mounts: [],
                    },
                ],
            }),
        );
        const manifest = join(root, 'examples/caddy-shared.yml');
        const env = {CLOUDFLARE_API_TOKEN: 'cf-token'};
        const world = () => JSON.parse(readFileSync(join(s, 'world.json'), 'utf8'));

        // 1. The copied Caddyfile still has the old hand-written routes and no import: stop before touching anything.
        let r = cli(dir, s, ['install', '-m', manifest, '--to', '2026-10-01'], env);
        assert.notEqual(r.code, 0, r.out);
        assert.match(r.out, /does not import the installer's routes/);
        assert.match(r.out, /import system-design\.caddy/);
        assert.equal(
            readFileSync(join(dir, 'caddy/Caddyfile'), 'utf8'),
            liveCaddyfile,
            'live Caddyfile copied in as the starting point',
        );
        assert.ok(
            world().foreign.every((c: { running: boolean }) => c.running),
            'nothing stopped yet',
        );

        // 2. The operator swaps the app's routes for the import, keeping another service on the same wildcard.
        writeFileSync(
            join(dir, 'caddy/Caddyfile'),
            [
                'import system-design.caddy',
                '',
                '*.home.jbraunsma.dev {',
                '\ttls {',
                '\t\tdns cloudflare {env.CLOUDFLARE_API_TOKEN}',
                '\t\tresolvers clyde.ns.cloudflare.com mckenzie.ns.cloudflare.com',
                '\t}',
                '\t@nas host nas.home.jbraunsma.dev',
                '\thandle @nas {',
                '\t\treverse_proxy 192.168.2.146:5000',
                '\t}',
                '\timport system-design',
                '}',
                '',
            ].join('\n'),
        );
        r = cli(dir, s, ['install', '-m', manifest, '--to', '2026-10-01'], env);
        assert.equal(r.code, 0, r.out);
        const w = world();
        assert.ok(
            w.foreign.every(
                (c: { running: boolean; restart: string }) => !c.running && c.restart === 'no',
            ),
            'old stack stopped and kept from restarting',
        );
        assert.ok(w.running.includes('proxy') && w.running.includes('ddns'));
        const compose = readFileSync(join(dir, 'compose.yml'), 'utf8');
        assert.match(compose, /- \.\/caddy:\/etc\/caddy:ro/);
        assert.match(compose, /caddy_caddy_data:\n\s+external: true/);
        assert.match(compose, /DOMAINS: home\.jbraunsma\.dev/);
        assert.match(
            readFileSync(join(dir, 'caddy/Caddyfile'), 'utf8'),
            /@nas host/,
            'operator file untouched',
        );
        assert.equal(state(dir).files['caddy/Caddyfile'], undefined, 'operator file not tracked');
        const calls = readFileSync(join(s, 'calls.log'), 'utf8');
        assert.match(
            calls,
            /-v [^ ]+\/caddy:\/etc\/caddy:ro .* caddy adapt/,
            'validated with the operator Caddyfile and snippet',
        );
        assert.ok(
            calls.indexOf('caddy adapt') < calls.indexOf('stop caddy-caddy-1'),
            'validated before stopping the old proxy',
        );
        assert.equal(state(dir).deployments.at(-1).replaced.length, 2);

        // 3. Editing the operator file later: proxy-reload validates and reloads; a broken edit is refused.
        const good = readFileSync(join(dir, 'caddy/Caddyfile'), 'utf8');
        writeFileSync(
            join(dir, 'caddy/Caddyfile'),
            good.replace('reverse_proxy 192.168.2.146:5000', 'reverse_proxi 192.168.2.146:5000'),
        );
        r = cli(dir, s, ['proxy-reload']);
        assert.notEqual(r.code, 0);
        assert.match(r.out, /does not validate/);
        assert.match(r.out, /reverse_proxi/, "Caddy's own error is shown");
        assert.ok(
            !/exec -T proxy caddy reload/.test(readFileSync(join(s, 'calls.log'), 'utf8')),
            'nothing reloaded',
        );
        writeFileSync(join(dir, 'caddy/Caddyfile'), good);
        r = cli(dir, s, ['proxy-reload']);
        assert.equal(r.code, 0, r.out);
        assert.match(readFileSync(join(s, 'calls.log'), 'utf8'), /exec -T proxy caddy reload/);

        // 4. Rolling back the takeover gives 80/443 back to the old stack, with its restart policy.
        r = cli(dir, s, ['rollback']);
        assert.equal(r.code, 0, r.out);
        assert.ok(
            world().foreign.every(
                (c: { running: boolean; restart: string }) => c.running && c.restart === 'unless-stopped',
            ),
            'old stack running again',
        );
    },
);

function readdirOne(dir: string, prefix: string): string {
    return spawnSync('ls', [dir], {encoding: 'utf8'})
        .stdout.split('\n')
        .find((n) => n.startsWith(prefix))!;
}
