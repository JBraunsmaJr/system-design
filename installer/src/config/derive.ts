import type {Config} from './schema.ts';

export type RouteId = 'editor' | 'store' | 'relay' | 'auth';

export interface Route {
    id: RouteId;
    host: string;
    /** Path prefix at the public host, '' for the root. */
    prefix: string;
    /** Whether the proxy removes the prefix before forwarding. */
    strip: boolean;
    /** Compose service and its container port. */
    service: string;
    internalPort: number;
    /** Host port, used when an external proxy reaches the service directly. */
    publishedPort: number;
    /** Long-lived connection: disable buffering, long timeouts. */
    websocket: boolean;
}

export interface Derived {
    routes: Route[];
    /** Distinct public hostnames, editor's first. */
    hosts: string[];
    /** APP_URL — the editor's base, as share links show it. */
    editorUrl: string;
    /** Where the store sends people after signing in. */
    afterLoginUrl: string;
    storeUrl: string;
    relayUrl: string;
    /** Path-mode convenience: "/" goes to the editor. */
    rootRedirect?: { host: string; to: string };
    /** Editor origins the store must allow, when it is on another origin. */
    allowedOrigins: string[];
    keycloak?: {
        publicBase: string;
        relativePath: string;
        host: string;
        issuer: string;
        internalUrl: string;
    };
    iceServers: string;
}

const KEYCLOAK_INTERNAL = 'http://keycloak:8080';

export function derive(c: Config): Derived {
    const pathMode = c.routing.mode === 'path';
    const h = c.routing.hosts;
    const hostFor = (id: RouteId): string => {
        if (pathMode) return c.domain;
        if (id === 'editor') return h.editor ?? c.domain;
        return h[id] ?? `${id}.${c.domain}`;
    };

    const routes: Route[] = [
        {
            id: 'editor',
            host: hostFor('editor'),
            prefix: pathMode ? '/editor' : '',
            strip: pathMode,
            service: 'editor',
            internalPort: 80,
            publishedPort: c.ports.editor,
            websocket: false,
        },
        {
            id: 'store',
            host: hostFor('store'),
            prefix: pathMode ? '/store' : '',
            strip: pathMode,
            service: 'store',
            internalPort: 8080,
            publishedPort: c.ports.store,
            websocket: false,
        },
        {
            id: 'relay',
            host: hostFor('relay'),
            prefix: pathMode ? '/relay' : '',
            strip: pathMode,
            service: 'relay',
            internalPort: 4444,
            publishedPort: c.ports.relay,
            websocket: true,
        },
    ];
    if (c.identity.type === 'keycloak') {
        // Keycloak serves under its own relative path, so the proxy never strips it.
        routes.push({
            id: 'auth',
            host: hostFor('auth'),
            prefix: pathMode ? '/keycloak' : '',
            strip: false,
            service: 'keycloak',
            internalPort: 8080,
            publishedPort: c.ports.keycloak,
            websocket: false,
        });
    }

    const url = (r: Route) => `https://${r.host}${r.prefix}`;
    const editor = routes[0]!;
    const store = routes[1]!;
    const relay = routes[2]!;
    const hosts = [...new Set(routes.map((r) => r.host))];

    const editorOrigin = `https://${editor.host}`;
    const storeOrigin = `https://${store.host}`;

    let keycloak: Derived['keycloak'];
    const auth = routes.find((r) => r.id === 'auth');
    if (auth && c.identity.type === 'keycloak') {
        const publicBase = url(auth);
        keycloak = {
            publicBase,
            relativePath: auth.prefix || '/',
            host: auth.host,
            issuer: `${publicBase}/realms/${c.identity.realm}`,
            internalUrl: KEYCLOAK_INTERNAL,
        };
    }

    return {
        routes,
        hosts,
        editorUrl: url(editor),
        afterLoginUrl: `${url(editor)}/`,
        storeUrl: url(store),
        relayUrl: `wss://${relay.host}${relay.prefix}`,
        rootRedirect: pathMode ? {host: c.domain, to: '/editor/'} : undefined,
        allowedOrigins: editorOrigin === storeOrigin ? [] : [editorOrigin],
        keycloak,
        iceServers: iceServers(c),
    };
}

function iceServers(c: Config): string {
    const t = c.turn;
    if (t.type === 'external') return t.iceServers;
    if (t.type === 'bundled') {
        // Format understood by the editor: url|username|credential, comma separated.
        // The password is interpolated by compose from .env.
        const base = `${t.host}:${t.port}`;
        return [
            `stun:${base}`,
            `turn:${base}?transport=udp|${t.username}|\${TURN_PASSWORD}`,
            `turn:${base}?transport=tcp|${t.username}|\${TURN_PASSWORD}`,
        ].join(',');
    }
    return '';
}

/** How a proxy reaches a route: by service name inside compose, or by host port from outside. */
export function upstreamOf(c: Config, r: Route): string {
    if (c.proxy.type === 'external') return `${c.proxy.upstreamHost}:${r.publishedPort}`;
    return `${r.service}:${r.internalPort}`;
}
