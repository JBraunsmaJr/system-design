import YAML from 'yaml';
import type {Config} from '../config/schema.ts';
import type {Derived} from '../config/derive.ts';

type Service = Record<string, unknown>;

const RESTART = 'unless-stopped';
const NET = ['core'];

/**
 * Builds compose.yml. Secrets and image references are left as ${VAR}
 * so compose reads them from .env; everything else is written literally,
 * which keeps the file readable on its own.
 */
export function renderCompose(c: Config, d: Derived): string {
    const services: Record<string, Service> = {};
    const volumes: Record<string, null> = {'store-data': null};
    const external = c.proxy.type === 'external';
    const bind = c.proxy.type === 'external' ? c.proxy.bindAddress : '';
    const publish = (hostPort: number, containerPort: number) =>
        external ? {ports: [`${bind}:${hostPort}:${containerPort}`]} : {};

    services.relay = {
        image: '${RELAY_IMAGE}',
        restart: RESTART,
        networks: NET,
        ...publish(c.ports.relay, 4444),
        environment: c.store.relayAuth ? {RELAY_TOKEN_SECRET: '${RELAY_TOKEN_SECRET}'} : {},
    };

    services.editor = {
        image: '${EDITOR_IMAGE}',
        restart: RESTART,
        networks: NET,
        ...publish(c.ports.editor, 80),
        environment: {
            APP_URL: d.editorUrl,
            RELAY: d.relayUrl,
            ICE_SERVERS: d.iceServers,
            STORE_URL: d.storeUrl,
        },
        healthcheck: {
            test: ['CMD', 'wget', '-q', '--spider', 'http://127.0.0.1/'],
            interval: '10s',
            timeout: '5s',
            retries: 6,
        },
    };

    services.store = {
        image: '${STORE_IMAGE}',
        restart: RESTART,
        networks: NET,
        ...publish(c.ports.store, 8080),
        depends_on: {postgres: {condition: 'service_healthy'}},
        environment: storeEnvironment(c, d),
        volumes: ['./keys/recovery-public.pem:/run/keys/recovery-public.pem:ro'],
    };

    services.postgres = {
        image: c.images.postgres,
        restart: RESTART,
        networks: NET,
        environment: {POSTGRES_USER: 'store', POSTGRES_PASSWORD: '${POSTGRES_PASSWORD}', POSTGRES_DB: 'store'},
        volumes: ['store-data:/var/lib/postgresql/data'],
        healthcheck: pgHealth('store'),
    };

    if (c.identity.type === 'keycloak' && d.keycloak) {
        volumes['keycloak-data'] = null;
        const rel = d.keycloak.relativePath === '/' ? '' : d.keycloak.relativePath;
        services.keycloak = {
            image: c.images.keycloak,
            hostname: 'keycloak',
            restart: RESTART,
            networks: NET,
            command: 'start --import-realm',
            ...publish(c.ports.keycloak, 8080),
            depends_on: {'keycloak-db': {condition: 'service_healthy'}},
            environment: {
                KC_BOOTSTRAP_ADMIN_USERNAME: 'admin',
                KC_BOOTSTRAP_ADMIN_PASSWORD: '${KEYCLOAK_ADMIN_PASSWORD}',
                KC_DB: 'postgres',
                KC_DB_URL: 'jdbc:postgresql://keycloak-db:5432/keycloak',
                KC_DB_USERNAME: 'keycloak',
                KC_DB_PASSWORD: '${KEYCLOAK_DB_PASSWORD}',
                KC_HOSTNAME: d.keycloak.host,
                KC_HTTP_RELATIVE_PATH: d.keycloak.relativePath,
                KC_HTTP_ENABLED: 'true',
                KC_PROXY_HEADERS: 'xforwarded',
                KC_HEALTH_ENABLED: 'true',
                // Substituted into the realm file's ${OIDC_CLIENT_SECRET} at import.
                OIDC_CLIENT_SECRET: '${OIDC_CLIENT_SECRET}',
            },
            volumes: [`./keycloak-realm.json:/opt/keycloak/data/import/${c.identity.realm}-realm.json:ro`],
            // The image has no curl; bash's /dev/tcp reaches the management port.
            healthcheck: {
                test: [
                    'CMD',
                    'bash',
                    '-c',
                    `exec 3<>/dev/tcp/127.0.0.1/9000 && printf 'GET ${rel}/health/ready HTTP/1.0\\r\\n\\r\\n' >&3 && grep -q UP <&3`,
                ],
                interval: '10s',
                timeout: '5s',
                retries: 30,
                start_period: '60s',
            },
        };
        services['keycloak-db'] = {
            image: c.images.postgres,
            restart: RESTART,
            networks: NET,
            environment: {
                POSTGRES_USER: 'keycloak',
                POSTGRES_PASSWORD: '${KEYCLOAK_DB_PASSWORD}',
                POSTGRES_DB: 'keycloak'
            },
            volumes: ['keycloak-data:/var/lib/postgresql/data'],
            healthcheck: pgHealth('keycloak'),
        };
    }

    if (c.turn.type === 'bundled') {
        services.coturn = {
            image: c.images.coturn,
            restart: RESTART,
            // TURN needs the host's address and a wide UDP range; host networking avoids NAT-in-NAT.
            network_mode: 'host',
            command: ['-c', '/etc/coturn/turnserver.conf', '--user', `${c.turn.username}:\${TURN_PASSWORD}`],
            volumes: ['./turnserver.conf:/etc/coturn/turnserver.conf:ro'],
        };
    }

    addProxy(c, services, volumes);

    // YAML 1.1 so values such as "on", "true" and "80:80" are quoted for
    // compose's parser; no anchors, so each service reads on its own.
    const doc = new YAML.Document(
        {name: c.project, services, volumes, networks: {core: null}},
        {version: '1.1', aliasDuplicateObjects: false},
    );
    // "80:80" is a base-60 integer to a YAML 1.1 reader; always quote port mappings.
    YAML.visit(doc, {
        Scalar(_key, node) {
            if (typeof node.value === 'string' && /^[\d.]+(:\d+)+(\/\w+)?$/.test(node.value)) node.type = 'QUOTE_DOUBLE';
        },
    });
    doc.commentBefore =
        ' Generated by system-design-installer. Edits are detected on the next run.\n' +
        ' Image references and secrets come from .env.';
    return doc.toString({lineWidth: 0, nullStr: ''});
}

function pgHealth(user: string) {
    return {test: ['CMD-SHELL', `pg_isready -U ${user}`], interval: '5s', timeout: '5s', retries: 10};
}

function storeEnvironment(c: Config, d: Derived): Record<string, string> {
    const env: Record<string, string> = {
        PUBLIC_URL: d.storeUrl,
        AFTER_LOGIN_URL: d.afterLoginUrl,
        DATABASE_URL: 'postgresql://store:${POSTGRES_PASSWORD}@postgres:5432/store',
    };
    if (d.allowedOrigins.length) env.ALLOWED_ORIGINS = d.allowedOrigins.join(',');

    const i = c.identity;
    if (i.type === 'github') {
        env.AUTH_PROVIDERS = 'github';
        env.GITHUB_CLIENT_ID = i.clientId;
        env.GITHUB_CLIENT_SECRET = '${GITHUB_CLIENT_SECRET}';
    } else {
        env.AUTH_PROVIDERS = 'oidc';
        if (i.type === 'keycloak') {
            env.OIDC_ISSUER = d.keycloak!.issuer;
            // Back-channel calls stay on the compose network rather than hairpinning through the proxy.
            env.OIDC_INTERNAL_URL = d.keycloak!.internalUrl;
            env.OIDC_CLIENT_ID = i.clientId;
            env.OIDC_GROUPS_CLAIM = 'groups';
        } else {
            env.OIDC_ISSUER = i.issuer;
            if (i.internalUrl) env.OIDC_INTERNAL_URL = i.internalUrl;
            env.OIDC_CLIENT_ID = i.clientId;
            env.OIDC_GROUPS_CLAIM = i.groupsClaim;
            if (i.scopes) env.OIDC_SCOPES = i.scopes;
        }
        env.OIDC_CLIENT_SECRET = '${OIDC_CLIENT_SECRET}';
    }

    env.RECOVERY_PUBLIC_KEY_FILE = '/run/keys/recovery-public.pem';
    if (c.store.relayAuth) env.RELAY_TOKEN_SECRET = '${RELAY_TOKEN_SECRET}';
    env.ADMIN_SUBJECTS = c.store.adminSubjects.join(',');
    env.RETENTION_PERIOD = c.store.retention;
    env.AUTO_ACCESS = c.store.autoAccess ? 'on' : 'off';
    return env;
}

function appDependencies(c: Config): Record<string, { condition: string }> {
    const deps: Record<string, { condition: string }> = {
        editor: {condition: 'service_started'},
        store: {condition: 'service_started'},
        relay: {condition: 'service_started'},
    };
    if (c.identity.type === 'keycloak') deps.keycloak = {condition: 'service_started'};
    return deps;
}

function addProxy(c: Config, services: Record<string, Service>, volumes: Record<string, null>): void {
    const p = c.proxy;
    if (p.type === 'caddy') {
        volumes['caddy-data'] = null;
        volumes['caddy-config'] = null;
        const custom = p.acme === 'cloudflare-dns';
        services.proxy = {
            ...(custom
                ? {image: `${c.project}-caddy:local`, build: {context: './caddy'}, pull_policy: 'build'}
                : {image: c.images.caddy}),
            restart: RESTART,
            networks: NET,
            ports: ['80:80', '443:443', '443:443/udp'],
            ...(custom ? {environment: {CLOUDFLARE_API_TOKEN: '${CLOUDFLARE_API_TOKEN}'}} : {}),
            volumes: ['./Caddyfile:/etc/caddy/Caddyfile:ro', 'caddy-data:/data', 'caddy-config:/config'],
            depends_on: appDependencies(c),
        };
    } else if (p.type === 'nginx') {
        const certbot = p.tls !== 'provided';
        const vols = ['./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro'];
        if (certbot) vols.push('./certbot/conf:/etc/letsencrypt:ro', './certbot/www:/var/www/certbot:ro');
        else vols.push(`${p.certPath}:/etc/nginx/certs/fullchain.pem:ro`, `${p.keyPath}:/etc/nginx/certs/privkey.pem:ro`);
        services.proxy = {
            image: c.images.nginx,
            restart: RESTART,
            networks: NET,
            ports: ['80:80', '443:443'],
            volumes: vols,
            depends_on: appDependencies(c),
            // Reload periodically so renewed certificates are picked up.
            command: ['/bin/sh', '-c', "while :; do sleep 6h & wait $${!}; nginx -s reload; done & exec nginx -g 'daemon off;'"],
        };
        if (certbot) {
            const dns = p.tls === 'certbot-cloudflare';
            const renewArgs = dns ? '' : ' --webroot -w /var/www/certbot';
            services.certbot = {
                image: dns ? c.images.certbotCloudflare : c.images.certbot,
                restart: RESTART,
                volumes: ['./certbot/conf:/etc/letsencrypt', './certbot/www:/var/www/certbot'],
                entrypoint: ['/bin/sh', '-c', `trap exit TERM; while :; do certbot renew --quiet${renewArgs}; sleep 12h & wait $\${!}; done`],
            };
        }
    } else if (p.type === 'cloudflare-tunnel') {
        services.proxy = {
            image: c.images.caddy,
            restart: RESTART,
            networks: NET,
            volumes: ['./Caddyfile:/etc/caddy/Caddyfile:ro'],
            depends_on: appDependencies(c),
        };
        services.cloudflared = {
            image: c.images.cloudflared,
            restart: RESTART,
            networks: NET,
            command: 'tunnel --no-autoupdate run',
            environment: {TUNNEL_TOKEN: '${TUNNEL_TOKEN}'},
            depends_on: {proxy: {condition: 'service_started'}},
        };
    }
}
