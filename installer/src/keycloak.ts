import type {Compose} from './docker.ts';
import type {Config} from './config/schema.ts';
import type {Derived} from './config/derive.ts';
import {InstallerError, randomSecret} from './lib/util.ts';

/**
 * Keycloak only imports the realm file when the realm does not exist yet,
 * so later changes (a new hostname, a rotated client secret, new groups)
 * would otherwise never reach it. These run kcadm.sh inside the keycloak
 * container: no network path from the installer is needed, and values are
 * passed as environment variables rather than spliced into shell text.
 * The admin password is the one already in the container's environment.
 */
export class KeycloakAdmin {
    private readonly compose: Compose;
    private readonly realm: string;
    private readonly relativePath: string;

    constructor(compose: Compose, c: Config, d: Derived) {
        if (c.identity.type !== 'keycloak' || !d.keycloak)
            throw new Error('Keycloak is not configured');
        this.compose = compose;
        this.realm = c.identity.realm;
        this.relativePath = d.keycloak.relativePath === '/' ? '' : d.keycloak.relativePath;
    }

    private async kc(script: string, env: Record<string, string> = {}): Promise<string> {
        const prelude = [
            'set -e',
            'K=/opt/keycloak/bin/kcadm.sh',
            'C=/tmp/sd-installer-kcadm.config',
            `"$K" config credentials --config "$C" --server "http://localhost:8080${this.relativePath}" --realm master --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null`,
            'kc() { "$K" "$@" --config "$C"; }',
        ].join('\n');
        const r = await this.compose.exec('keycloak', ['bash', '-c', `${prelude}\n${script}`], {
            env: {...env, R: this.realm},
            allowFail: true,
        });
        if (r.code !== 0) {
            const detail = (r.stderr || r.stdout).trim().split('\n').slice(-5).join('\n');
            if (/invalid_grant|Invalid user credentials/i.test(detail)) {
                throw new InstallerError(
                    'Keycloak rejected the bootstrap admin credentials.',
                    'If the admin password was changed in Keycloak, set KEYCLOAK_ADMIN_PASSWORD in .env to match it.',
                );
            }
            throw new InstallerError('A Keycloak administration step failed.', detail);
        }
        return r.stdout;
    }

    /** Brings the client in line with the configuration. Returns what changed. */
    async reconcileClient(clientId: string, d: Derived): Promise<string[]> {
        const origins = [...new Set([new URL(d.editorUrl).origin, new URL(d.storeUrl).origin])];
        const redirect = `${d.storeUrl}/v1/auth/callback`;
        const out = await this.kc(
            'kc get clients -r "$R" -q clientId="$CID" --fields id,redirectUris,webOrigins',
            {CID: clientId},
        );
        const clients = JSON.parse(out || '[]') as {
            id: string;
            redirectUris?: string[];
            webOrigins?: string[];
        }[];
        const client = clients[0];
        if (!client)
            throw new InstallerError(
                `Keycloak realm "${this.realm}" has no client "${clientId}".`,
                'Was the realm created by hand under a different client id?',
            );
        const changes: string[] = [];
        if (JSON.stringify(client.redirectUris ?? []) !== JSON.stringify([redirect]))
            changes.push('redirect URI');
        if (
            JSON.stringify([...(client.webOrigins ?? [])].sort()) !== JSON.stringify([...origins].sort())
        )
            changes.push('web origins');
        // The secret is always re-applied: cheap, and the only way to know it matches.
        await this.kc(
            'kc update "clients/$ID" -r "$R" -s "redirectUris=$REDIRECTS" -s "webOrigins=$ORIGINS" -s "secret=$OIDC_CLIENT_SECRET"',
            {ID: client.id, REDIRECTS: JSON.stringify([redirect]), ORIGINS: JSON.stringify(origins)},
        );
        return changes;
    }

    async ensureGroups(groups: string[]): Promise<string[]> {
        if (!groups.length) return [];
        const existing = JSON.parse((await this.kc('kc get groups -r "$R" --fields name')) || '[]') as {
            name: string;
        }[];
        const have = new Set(existing.map((g) => g.name));
        const created: string[] = [];
        for (const name of groups) {
            if (have.has(name)) continue;
            await this.kc('kc create groups -r "$R" -s "name=$G" >/dev/null', {G: name});
            created.push(name);
        }
        return created;
    }

    async findUserId(username: string): Promise<string | null> {
        const out = await this.kc(
            'kc get users -r "$R" -q username="$U" -q exact=true --fields id,username',
            {U: username},
        );
        const users = JSON.parse(out || '[]') as { id: string }[];
        return users[0]?.id ?? null;
    }

    /**
     * Creates a user with a temporary password they must change at first
     * sign-in. Returns their id (the OIDC subject) and the password, or
     * null for the password when the user already existed.
     */
    async ensureUser(u: {
        username: string;
        email: string;
        firstName?: string;
        lastName?: string;
        groups: string[];
    }): Promise<{ id: string; password: string | null }> {
        const existing = await this.findUserId(u.username);
        if (existing) return {id: existing, password: null};
        const password = randomSecret(12);
        const id = (
            await this.kc(
                [
                    'kc create users -r "$R" -i -s "username=$U" -s enabled=true -s "email=$E" -s emailVerified=true \\',
                    '  -s "firstName=$FN" -s "lastName=$LN" -s \'requiredActions=["UPDATE_PASSWORD"]\'',
                ].join('\n'),
                {U: u.username, E: u.email, FN: u.firstName ?? u.username, LN: u.lastName ?? '-'},
            )
        ).trim();
        await this.kc('kc set-password -r "$R" --userid "$ID" --new-password "$P" --temporary', {
            ID: id,
            P: password,
        });
        if (u.groups.length) {
            const groups = JSON.parse(
                (await this.kc('kc get groups -r "$R" --fields id,name')) || '[]',
            ) as { id: string; name: string }[];
            for (const name of u.groups) {
                const g = groups.find((x) => x.name === name);
                if (!g) continue;
                await this.kc(
                    'kc update "users/$ID/groups/$GID" -r "$R" -s "realm=$R" -s "userId=$ID" -s "groupId=$GID" -n',
                    {ID: id, GID: g.id},
                );
            }
        }
        return {id, password};
    }

    /** Users from the original demo realm, which should not survive into production. */
    async demoUsersPresent(): Promise<string[]> {
        const found: string[] = [];
        for (const name of ['demo', 'otter', 'badger']) {
            if (await this.findUserId(name)) found.push(name);
        }
        return found;
    }
}
