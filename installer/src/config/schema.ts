import {z} from 'zod';

/**
 * The complete, validated configuration. A manifest is any subset of this;
 * the wizard fills the rest. Secret-valued fields hold a *reference*, never
 * necessarily the secret itself:
 *
 *   generate        make one on first install, then keep the stored value
 *   stored          must already be in the install directory's .env
 *   env:NAME        read from the installer's environment
 *   file:/path      read from a file visible to the installer
 *   anything else   the literal value
 *
 * Secrets are always written to .env, never to config.yml.
 */

export const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/i;
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

export const hostname = z.string().regex(HOSTNAME_RE, 'must be a hostname such as design.example.com');
const hostOrIp = z
    .string()
    .refine((v) => HOSTNAME_RE.test(v) || IPV4_RE.test(v) || v === 'localhost', 'must be a hostname or IPv4 address');
const port = z.number().int().min(1).max(65535);
const secretRef = z.string().min(1);
const email = z.email();

export const RETENTION_RE = /^(immediate|indefinite|\d+[dwmy])$/;

const CaddyProxy = z.object({
    type: z.literal('caddy'),
    /** http: ACME HTTP-01/TLS-ALPN (needs 80/443 reachable). cloudflare-dns: DNS-01 via the API. */
    acme: z.enum(['http', 'cloudflare-dns']),
    email: email.optional(),
    cloudflareApiToken: secretRef.optional(),
    /** DNS-01 tuning, carried over from setups like the original Caddyfile. */
    resolvers: z.array(z.string()).optional(),
    propagationDelay: z.string().optional(),
    propagationTimeout: z.string().optional(),
});

const NginxProxy = z.object({
    type: z.literal('nginx'),
    tls: z.enum(['certbot-http', 'certbot-cloudflare', 'provided']),
    email: email.optional(),
    cloudflareApiToken: secretRef.optional(),
    /** Host paths to an existing certificate chain and key, for tls: provided. */
    certPath: z.string().optional(),
    keyPath: z.string().optional(),
    /** Use Let's Encrypt staging while testing; avoids rate limits. */
    staging: z.boolean().default(false),
});

const TunnelProxy = z.object({
    type: z.literal('cloudflare-tunnel'),
    token: secretRef,
});

const ExternalProxy = z.object({
    type: z.literal('external'),
    /** The address your existing proxy uses to reach this host. */
    upstreamHost: hostOrIp,
    /** Interface the services publish on. Prefer a LAN address over 0.0.0.0. */
    bindAddress: hostOrIp.or(z.literal('0.0.0.0')).default('0.0.0.0'),
});

export const ProxySchema = z.discriminatedUnion('type', [CaddyProxy, NginxProxy, TunnelProxy, ExternalProxy]);

const InitialUser = z.object({
    username: z.string().regex(/^[a-zA-Z0-9._@-]{1,64}$/, 'letters, digits, . _ @ - only'),
    email,
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    /** Add this person to ADMIN_SUBJECTS once Keycloak has assigned their id. */
    admin: z.boolean().default(true),
    groups: z.array(z.string()).default([]),
});

const KeycloakIdentity = z.object({
    type: z.literal('keycloak'),
    realm: z.string().regex(/^[a-zA-Z0-9_-]+$/).default('system-design'),
    clientId: z.string().default('system-design-store'),
    clientSecret: secretRef.default('generate'),
    adminPassword: secretRef.default('generate'),
    dbPassword: secretRef.default('generate'),
    groups: z.array(z.string().regex(/^[^/]+$/, 'group names cannot contain "/"')).default([]),
    initialUser: InitialUser.optional(),
});

const OidcIdentity = z.object({
    type: z.literal('oidc'),
    issuer: z.url(),
    internalUrl: z.url().optional(),
    clientId: z.string().default('system-design-store'),
    clientSecret: secretRef,
    groupsClaim: z.string().default('groups'),
    scopes: z.string().optional(),
});

const GithubIdentity = z.object({
    type: z.literal('github'),
    clientId: z.string().min(1),
    clientSecret: secretRef,
});

export const IdentitySchema = z.discriminatedUnion('type', [KeycloakIdentity, OidcIdentity, GithubIdentity]);

const TurnNone = z.object({type: z.literal('none')});
const TurnBundled = z.object({
    type: z.literal('bundled'),
    /** Hostname browsers use for TURN. Must not be proxied (Cloudflare orange cloud). */
    host: hostOrIp,
    /** Public IP, or public/private when behind NAT — coturn's external-ip. */
    externalIp: z.string().optional(),
    username: z.string().regex(/^[a-zA-Z0-9_-]+$/).default('webrtc'),
    password: secretRef.default('generate'),
    port: port.default(3478),
    minPort: port.default(49160),
    maxPort: port.default(49200),
    /** Refuse to relay into private address space (blocks using TURN to reach your LAN). */
    denyPrivatePeers: z.boolean().default(true),
});
const TurnExternal = z.object({
    type: z.literal('external'),
    /** Passed verbatim as ICE_SERVERS, e.g. "stun:host:3478,turn:host:3478|user|pass". */
    iceServers: z.string().min(1),
});

export const TurnSchema = z.discriminatedUnion('type', [TurnNone, TurnBundled, TurnExternal]);

export const ConfigSchema = z
    .object({
        version: z.literal(1).default(1),
        /** Compose project name; volume names derive from it, so keep it stable. */
        project: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, 'lowercase letters, digits, - and _'),
        domain: hostname,
        routing: z
            .object({
                mode: z.enum(['path', 'subdomain']).default('path'),
                hosts: z
                    .object({editor: hostname, store: hostname, relay: hostname, auth: hostname})
                    .partial()
                    .default({}),
            })
            .prefault({}),
        proxy: ProxySchema,
        identity: IdentitySchema,
        turn: TurnSchema.prefault({type: 'none'}),
        recovery: z
            .object({
                mode: z.enum(['generate', 'existing']),
                /** For existing: a PEM public key visible to the installer. */
                publicKeyPath: z.string().optional(),
            })
            .prefault({mode: 'generate'}),
        store: z
            .object({
                retention: z.string().regex(RETENTION_RE, 'immediate, indefinite, or a duration like 30d, 12w, 6m, 7y').default('30d'),
                autoAccess: z.boolean().default(true),
                relayAuth: z.boolean().default(true),
                adminSubjects: z.array(z.string()).default([]),
            })
            .prefault({}),
        secrets: z
            .object({
                postgresPassword: secretRef.default('generate'),
                relayTokenSecret: secretRef.default('generate'),
            })
            .prefault({}),
        /** "latest", a published tag (e.g. 2026-10-03), or a digest (sha256:…). */
        versions: z
            .object({
                editor: z.string().default('latest'),
                relay: z.string().default('latest'),
                store: z.string().default('latest'),
            })
            .prefault({}),
        images: z
            .object({
                registry: z.string().default('ghcr.io/jbraunsmajr'),
                postgres: z.string().default('postgres:16-alpine'),
                keycloak: z.string().default('quay.io/keycloak/keycloak:26.0'),
                coturn: z.string().default('coturn/coturn:4.6'),
                caddy: z.string().default('caddy:2.8'),
                caddyBuilder: z.string().default('caddy:2.8-builder'),
                nginx: z.string().default('nginx:1.27-alpine'),
                cloudflared: z.string().default('cloudflare/cloudflared:latest'),
                certbot: z.string().default('certbot/certbot:latest'),
                certbotCloudflare: z.string().default('certbot/dns-cloudflare:latest'),
            })
            .prefault({}),
        /** Host ports, used only when an external proxy reaches the services directly. */
        ports: z
            .object({
                editor: port.default(8888),
                store: port.default(8889),
                relay: port.default(4444),
                keycloak: port.default(8001),
            })
            .prefault({}),
        backups: z.object({keep: z.number().int().min(1).default(10)}).prefault({}),
    })
    .superRefine((c, ctx) => {
        const p = c.proxy;
        if ((p.type === 'caddy' && p.acme === 'cloudflare-dns') || (p.type === 'nginx' && p.tls === 'certbot-cloudflare')) {
            if (!p.cloudflareApiToken) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['proxy', 'cloudflareApiToken'],
                    message: 'required for Cloudflare DNS validation'
                });
            }
        }
        if (p.type === 'nginx' && p.tls === 'provided' && (!p.certPath || !p.keyPath)) {
            ctx.addIssue({
                code: 'custom',
                path: ['proxy', 'certPath'],
                message: 'certPath and keyPath are required for tls: provided'
            });
        }
        if (c.recovery.mode === 'existing' && !c.recovery.publicKeyPath) {
            ctx.addIssue({
                code: 'custom',
                path: ['recovery', 'publicKeyPath'],
                message: 'required when recovery.mode is existing'
            });
        }
        if (c.turn.type === 'bundled' && c.turn.minPort > c.turn.maxPort) {
            ctx.addIssue({code: 'custom', path: ['turn', 'minPort'], message: 'must not exceed maxPort'});
        }
    });

export type Config = z.output<typeof ConfigSchema>;
export type ProxyConfig = Config['proxy'];
export type IdentityConfig = Config['identity'];

/** Formats zod issues as "path: message" lines for the operator. */
export function describeIssues(error: z.ZodError): string {
    return error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
}
