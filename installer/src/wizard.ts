import {existsSync} from 'node:fs';
import {basename, join} from 'node:path';
import {type Config, ConfigSchema, describeIssues, HOSTNAME_RE, RETENTION_RE} from './config/schema.ts';
import {type Draft, getPath, InstallerError, setPath} from './lib/util.ts';
import {pc, ui} from './lib/ui.ts';

type Option = { value: string; label: string; hint?: string };

interface Question {
    path: string;
    section: string;
    message: string;
    kind: 'text' | 'select' | 'confirm' | 'secret' | 'list';
    when?: (d: Draft) => boolean;
    options?: Option[] | ((d: Draft) => Option[]);
    /** Used as the prompt's starting value, and as the answer in non-interactive runs. */
    default?: unknown | ((d: Draft) => unknown);
    /** Optional answers may be left blank; required ones without a default stop a non-interactive run. */
    optional?: boolean;
    validate?: (v: string) => string | undefined;
    /** Shown once, before the question. */
    help?: string | ((d: Draft) => string | undefined);
}

const is = (path: string, ...values: unknown[]) => (d: Draft) => values.includes(getPath(d, path));
const all = (...preds: ((d: Draft) => boolean)[]) => (d: Draft) => preds.every((p) => p(d));

const host = (v: string) => (HOSTNAME_RE.test(v) ? undefined : 'Enter a hostname like design.example.com');
const hostOrIp = (v: string) => (HOSTNAME_RE.test(v) || /^(\d{1,3}\.){3}\d{1,3}$/.test(v) ? undefined : 'Enter a hostname or IPv4 address');
const emailish = (v: string) => (!v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? undefined : 'Enter an email address');
const url = (v: string) => {
    try {
        new URL(v);
        return undefined;
    } catch {
        return 'Enter a full URL, starting with https://';
    }
};

/** The order here is the order the wizard asks in. */
export function questions(dir: string): Question[] {
    const keysExist = existsSync(join(dir, 'keys', 'recovery-public.pem'));
    return [
        // ---------------------------------------------------------------- general
        {
            section: 'Site',
            path: 'domain',
            kind: 'text',
            message: 'Public hostname',
            validate: host,
            help: 'The name people type into the browser. DNS for it should point at this server (or at Cloudflare).'
        },
        {
            section: 'Site',
            path: 'routing.mode',
            kind: 'select',
            message: 'How should the services be laid out?',
            default: 'path',
            options: [
                {value: 'path', label: 'One hostname, paths', hint: '/editor /store /relay /keycloak'},
                {value: 'subdomain', label: 'A hostname per service', hint: 'store.…, relay.…, auth.…'},
            ],
        },
        {
            section: 'Site',
            path: 'routing.hosts.store',
            kind: 'text',
            message: 'Store hostname',
            when: is('routing.mode', 'subdomain'),
            default: (d: Draft) => `store.${d.domain}`,
            validate: host
        },
        {
            section: 'Site',
            path: 'routing.hosts.relay',
            kind: 'text',
            message: 'Relay hostname',
            when: is('routing.mode', 'subdomain'),
            default: (d: Draft) => `relay.${d.domain}`,
            validate: host
        },
        {
            section: 'Site', path: 'project', kind: 'text', message: 'Compose project name',
            default: () => basename(dir).toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^[^a-z0-9]+/, '') || 'system-design',
            help: 'Volume names derive from this. When adopting an existing setup, keep the name it already uses so its data is found.',
            validate: (v) => (/^[a-z0-9][a-z0-9_-]*$/.test(v) ? undefined : 'lowercase letters, digits, - and _'),
        },

        // ---------------------------------------------------------------- proxy
        {
            section: 'Reverse proxy', path: 'proxy.type', kind: 'select', message: 'What terminates HTTPS?',
            options: [
                {value: 'caddy', label: 'Caddy, run here', hint: 'automatic certificates'},
                {value: 'nginx', label: 'nginx, run here', hint: 'certbot, or certificates you provide'},
                {
                    value: 'cloudflare-tunnel',
                    label: 'Cloudflare Tunnel',
                    hint: 'no inbound ports; Cloudflare holds the certificate'
                },
                {
                    value: 'external',
                    label: 'A proxy I already run elsewhere',
                    hint: 'services publish ports; snippets are generated'
                },
            ],
        },
        {
            section: 'Reverse proxy',
            path: 'proxy.acme',
            kind: 'select',
            message: 'How should Caddy prove it owns the domain?',
            when: is('proxy.type', 'caddy'),
            default: 'http',
            options: [
                {value: 'http', label: 'HTTP challenge', hint: 'ports 80 and 443 reachable from the internet'},
                {
                    value: 'cloudflare-dns',
                    label: 'Cloudflare DNS challenge',
                    hint: 'works on private networks; needs an API token'
                },
            ],
        },
        {
            section: 'Reverse proxy',
            path: 'proxy.tls',
            kind: 'select',
            message: 'Where do nginx\'s certificates come from?',
            when: is('proxy.type', 'nginx'),
            default: 'certbot-http',
            options: [
                {value: 'certbot-http', label: "Let's Encrypt, HTTP challenge", hint: 'port 80 reachable'},
                {value: 'certbot-cloudflare', label: "Let's Encrypt, Cloudflare DNS", hint: 'needs an API token'},
                {value: 'provided', label: 'I have certificate files'},
            ],
        },
        {
            section: 'Reverse proxy',
            path: 'proxy.email',
            kind: 'text',
            message: 'Email for certificate expiry notices (optional)',
            optional: true,
            when: (d) => is('proxy.type', 'caddy')(d) || (is('proxy.type', 'nginx')(d) && getPath(d, 'proxy.tls') !== 'provided'),
            validate: emailish
        },
        {
            section: 'Reverse proxy', path: 'proxy.cloudflareApiToken', kind: 'secret', message: 'Cloudflare API token',
            when: (d) => is('proxy.acme', 'cloudflare-dns')(d) || is('proxy.tls', 'certbot-cloudflare')(d),
            help: 'Create one at dash.cloudflare.com → My Profile → API Tokens with Zone:DNS:Edit on this zone.',
        },
        {
            section: 'Reverse proxy',
            path: 'proxy.certPath',
            kind: 'text',
            message: 'Host path to the certificate chain (fullchain.pem)',
            when: is('proxy.tls', 'provided')
        },
        {
            section: 'Reverse proxy',
            path: 'proxy.keyPath',
            kind: 'text',
            message: 'Host path to the private key',
            when: is('proxy.tls', 'provided')
        },
        {
            section: 'Reverse proxy',
            path: 'proxy.token',
            kind: 'secret',
            message: 'Tunnel token',
            when: is('proxy.type', 'cloudflare-tunnel'),
            help: 'Zero Trust → Networks → Tunnels → Create (cloudflared). Copy the token from the docker command it shows.',
        },
        {
            section: 'Reverse proxy',
            path: 'proxy.upstreamHost',
            kind: 'text',
            message: 'Address your proxy uses to reach this server',
            when: is('proxy.type', 'external'),
            validate: hostOrIp,
            help: 'For example the LAN address your existing Caddy forwards to.',
        },
        {
            section: 'Reverse proxy',
            path: 'proxy.bindAddress',
            kind: 'text',
            message: 'Interface to publish service ports on',
            when: is('proxy.type', 'external'),
            default: (d: Draft) => (/^(\d{1,3}\.){3}\d{1,3}$/.test(String(getPath(d, 'proxy.upstreamHost'))) ? getPath(d, 'proxy.upstreamHost') : '0.0.0.0'),
            help: 'Binding to one address keeps the ports off other networks. 0.0.0.0 means every interface.',
        },

        // ---------------------------------------------------------------- identity
        {
            section: 'Sign-in', path: 'identity.type', kind: 'select', message: 'Who signs people in?',
            options: [
                {value: 'keycloak', label: 'Keycloak, run here'},
                {value: 'oidc', label: 'An existing OIDC provider', hint: 'Entra ID, Okta, Auth0, GitLab, Google…'},
                {value: 'github', label: 'GitHub'},
            ],
        },
        {
            section: 'Sign-in',
            path: 'routing.hosts.auth',
            kind: 'text',
            message: 'Keycloak hostname',
            when: all(is('routing.mode', 'subdomain'), is('identity.type', 'keycloak')),
            default: (d: Draft) => `auth.${d.domain}`,
            validate: host
        },
        {
            section: 'Sign-in',
            path: 'identity.groups',
            kind: 'list',
            message: 'Groups to create (comma separated, optional)',
            optional: true,
            when: is('identity.type', 'keycloak'),
            default: [],
            help: 'Group membership can grant workspace access automatically.'
        },
        {
            section: 'Sign-in',
            path: 'identity.createUser',
            kind: 'confirm',
            message: 'Create a first user account now?',
            when: is('identity.type', 'keycloak'),
            default: () => ui.interactive,
            help: 'They get a temporary password and are made a store administrator.'
        },
        {
            section: 'Sign-in',
            path: 'identity.initialUser.username',
            kind: 'text',
            message: 'Username',
            when: all(is('identity.type', 'keycloak'), is('identity.createUser', true)),
            validate: (v) => (/^[a-zA-Z0-9._@-]{1,64}$/.test(v) ? undefined : 'letters, digits, . _ @ - only')
        },
        {
            section: 'Sign-in',
            path: 'identity.initialUser.email',
            kind: 'text',
            message: 'Their email',
            when: all(is('identity.type', 'keycloak'), is('identity.createUser', true)),
            validate: (v) => (v ? emailish(v) : 'Required: Keycloak asks users without one to complete their profile')
        },
        {
            section: 'Sign-in',
            path: 'identity.initialUser.groups',
            kind: 'list',
            message: 'Their groups (comma separated, optional)',
            optional: true,
            default: [],
            when: all(is('identity.type', 'keycloak'), is('identity.createUser', true), (d) => ((getPath(d, 'identity.groups') as unknown[]) ?? []).length > 0)
        },
        {
            section: 'Sign-in',
            path: 'identity.issuer',
            kind: 'text',
            message: 'Issuer URL (serves /.well-known/openid-configuration)',
            when: is('identity.type', 'oidc'),
            validate: url,
            help: (d) => `Register a confidential client with redirect URI ${pc.bold(`${storeUrlOf(d)}/v1/auth/callback`)}`
        },
        {
            section: 'Sign-in',
            path: 'identity.clientId',
            kind: 'text',
            message: 'Client id',
            when: is('identity.type', 'oidc', 'github'),
            default: (d: Draft) => (getPath(d, 'identity.type') === 'oidc' ? 'system-design-store' : undefined)
        },
        {
            section: 'Sign-in',
            path: 'identity.clientSecret',
            kind: 'secret',
            message: 'Client secret',
            when: is('identity.type', 'oidc', 'github'),
            help: (d) => (getPath(d, 'identity.type') === 'github' ? `GitHub → Settings → Developer settings → OAuth Apps. Callback URL: ${pc.bold(`${storeUrlOf(d)}/v1/auth/callback`)}` : undefined)
        },
        {
            section: 'Sign-in',
            path: 'identity.internalUrl',
            kind: 'text',
            message: 'Address the store uses to reach the provider, if different (optional)',
            optional: true,
            when: is('identity.type', 'oidc'),
            validate: (v) => (v ? url(v) : undefined)
        },

        // ---------------------------------------------------------------- turn
        {
            section: 'Collaboration',
            path: 'turn.type',
            kind: 'select',
            message: 'TURN server for peers behind strict NATs?',
            default: 'none',
            help: (d) => (getPath(d, 'proxy.type') === 'cloudflare-tunnel' ? pc.yellow('Cloudflare Tunnel cannot carry TURN (UDP). A bundled TURN server needs its own DNS-only record and open ports.') : 'Peers on the same network, or behind ordinary home routers, connect without one.'),
            options: [
                {value: 'none', label: 'None'},
                {value: 'bundled', label: 'Run coturn here', hint: 'opens 3478 and a UDP range'},
                {value: 'external', label: 'Use servers I already have'},
            ],
        },
        {
            section: 'Collaboration',
            path: 'turn.host',
            kind: 'text',
            message: 'Hostname or IP browsers use for TURN',
            when: is('turn.type', 'bundled'),
            default: (d: Draft) => d.domain,
            validate: hostOrIp,
            help: 'If DNS goes through Cloudflare, this record must be DNS-only (grey cloud).'
        },
        {
            section: 'Collaboration',
            path: 'turn.externalIp',
            kind: 'text',
            message: 'Public IP, if this server is behind NAT (optional; public/private for 1:1 NAT)',
            optional: true,
            when: is('turn.type', 'bundled')
        },
        {
            section: 'Collaboration',
            path: 'turn.denyPrivatePeers',
            kind: 'confirm',
            message: 'Stop TURN relaying into private address ranges?',
            when: is('turn.type', 'bundled'),
            default: true,
            help: 'Recommended: otherwise anyone with the credential can use TURN to reach your LAN.'
        },
        {
            section: 'Collaboration',
            path: 'turn.iceServers',
            kind: 'text',
            message: 'ICE servers (url|user|pass, comma separated)',
            when: is('turn.type', 'external')
        },

        // ---------------------------------------------------------------- recovery
        {
            section: 'Recovery key',
            path: 'recovery.mode',
            kind: 'select',
            message: 'Organization recovery key',
            default: keysExist ? 'existing' : 'generate',
            help: 'Every document is also encrypted to this key, so it can be recovered when people lose theirs. The store refuses documents without it.',
            options: [
                {
                    value: 'generate',
                    label: 'Generate a new key pair now',
                    hint: 'you will move the private half off this server'
                },
                {
                    value: 'existing',
                    label: 'Use a public key I already have',
                    hint: keysExist ? 'keys/recovery-public.pem is present' : undefined
                },
            ],
        },
        {
            section: 'Recovery key',
            path: 'recovery.publicKeyPath',
            kind: 'text',
            message: 'Path to the public key (PEM)',
            when: is('recovery.mode', 'existing'),
            default: keysExist ? join(dir, 'keys', 'recovery-public.pem') : undefined
        },

        // ---------------------------------------------------------------- policy
        {
            section: 'Policy',
            path: 'store.retention',
            kind: 'text',
            message: 'How long deleted documents stay restorable',
            default: '30d',
            validate: (v) => (RETENTION_RE.test(v) ? undefined : 'immediate, indefinite, or e.g. 30d, 12w, 6m, 7y'),
            help: 'Set what your records schedule requires before the first document is stored; changes only affect later deletions.'
        },
        {
            section: 'Policy',
            path: 'store.relayAuth',
            kind: 'confirm',
            message: 'Only let signed-in members join collaboration sessions?',
            default: true,
            help: 'Without this, anyone who can reach the relay and knows a room name can join.'
        },
    ];
}

function storeUrlOf(d: Draft): string {
    const domain = String(d.domain ?? 'example.com');
    return getPath(d, 'routing.mode') === 'subdomain' ? `https://${getPath(d, 'routing.hosts.store') ?? `store.${domain}`}` : `https://${domain}/store`;
}

/** Wizard-only keys that are not part of the configuration. */
const WIZARD_ONLY = ['identity.createUser'];

/**
 * Walks the question table. Anything the draft already holds (from a
 * manifest or a previous install) is not asked again. Returns a validated
 * configuration.
 */
export async function runWizard(draft: Draft, dir: string, opts: { reask?: boolean } = {}): Promise<Config> {
    const d = structuredClone(draft);
    // A manifest that names an initial user implies the wizard's "create one?" question.
    if (getPath(d, 'identity.initialUser') !== undefined && getPath(d, 'identity.createUser') === undefined) setPath(d, 'identity.createUser', true);

    const missing: string[] = [];
    let lastSection = '';
    for (const q of questions(dir)) {
        if (q.when && !q.when(d)) continue;
        const present = getPath(d, q.path);
        const def = typeof q.default === 'function' ? (q.default as (d: Draft) => unknown)(d) : q.default;
        if (present !== undefined && !(opts.reask && ui.interactive && q.kind !== 'secret')) continue;

        if (!ui.interactive) {
            if (def !== undefined) setPath(d, q.path, def);
            else if (!q.optional) missing.push(q.path);
            continue;
        }

        if (q.section !== lastSection) {
            ui.section(q.section);
            lastSection = q.section;
        }
        const help = typeof q.help === 'function' ? q.help(d) : q.help;
        if (help) ui.message(pc.dim(help));
        const answer = await ask(q, present ?? def, d);
        if (answer !== undefined) setPath(d, q.path, answer);
    }

    if (missing.length) {
        throw new InstallerError(
            `The manifest is missing values the installer cannot choose for you:\n${missing.map((m) => `  ${m}`).join('\n')}`,
            'Add them to the manifest, or run interactively (docker run -it) to be asked.',
        );
    }

    const identity = d.identity as Draft | undefined;
    if (identity && (identity.createUser === false || identity.type !== 'keycloak')) delete identity.initialUser;
    for (const key of WIZARD_ONLY) {
        const parts = key.split('.');
        const parent = getPath(d, parts.slice(0, -1).join('.')) as Draft | undefined;
        if (parent) delete parent[parts.at(-1)!];
    }

    const parsed = ConfigSchema.safeParse(d);
    if (!parsed.success) throw new InstallerError(`The configuration is not valid:\n${describeIssues(parsed.error)}`);
    return parsed.data;
}

async function ask(q: Question, initial: unknown, d: Draft): Promise<unknown> {
    switch (q.kind) {
        case 'text': {
            const v = await ui.text({
                message: q.message,
                defaultValue: initial === undefined ? undefined : String(initial),
                validate: (v) => (!v ? (q.optional ? undefined : 'A value is required') : q.validate?.(v)),
            });
            return v === '' ? undefined : v;
        }
        case 'list': {
            const v = await ui.text({
                message: q.message,
                defaultValue: Array.isArray(initial) ? initial.join(', ') : undefined
            });
            return v.split(',').map((s) => s.trim()).filter(Boolean);
        }
        case 'confirm':
            return ui.confirm(q.message, initial === undefined ? true : Boolean(initial));
        case 'select': {
            const options = typeof q.options === 'function' ? q.options(d) : q.options!;
            return ui.select({message: q.message, options, initialValue: (initial as string) ?? options[0]!.value});
        }
        case 'secret':
            return ui.password({message: q.message});
    }
}

/** One-screen summary for the operator to confirm. */
export function summarize(c: Config): string {
    const lines = [
        `${pc.dim('domain')}      ${c.domain} (${c.routing.mode === 'path' ? 'paths' : 'subdomains'})`,
        `${pc.dim('proxy')}       ${c.proxy.type}${c.proxy.type === 'caddy' ? `, ${c.proxy.acme} challenge` : c.proxy.type === 'nginx' ? `, ${c.proxy.tls}` : c.proxy.type === 'external' ? ` → ${c.proxy.upstreamHost}` : ''}`,
        `${pc.dim('sign-in')}     ${c.identity.type}${c.identity.type === 'keycloak' && c.identity.initialUser ? `, first user ${c.identity.initialUser.username}` : ''}`,
        `${pc.dim('turn')}        ${c.turn.type}${c.turn.type === 'bundled' ? ` at ${c.turn.host}` : ''}`,
        `${pc.dim('recovery')}    ${c.recovery.mode === 'generate' ? 'generate a new key pair' : c.recovery.publicKeyPath}`,
        `${pc.dim('retention')}   ${c.store.retention}, relay auth ${c.store.relayAuth ? 'on' : 'off'}`,
        `${pc.dim('versions')}    editor ${c.versions.editor}, relay ${c.versions.relay}, store ${c.versions.store}`,
        `${pc.dim('project')}     ${c.project}`,
    ];
    return lines.join('\n');
}
