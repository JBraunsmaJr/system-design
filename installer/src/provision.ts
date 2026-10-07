import {copyFileSync, existsSync, mkdirSync, readFileSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';
import type {Config} from './config/schema.ts';
import type {Derived} from './config/derive.ts';
import {certName} from './render/nginx.ts';
import {type Compose, docker} from './docker.ts';
import {InstallerError} from './lib/util.ts';
import {pc, ui} from './lib/ui.ts';

export const RECOVERY_PUBLIC = 'keys/recovery-public.pem';
export const RECOVERY_PRIVATE = 'keys/recovery-private.pem';

/**
 * Puts the organization's recovery public key at keys/recovery-public.pem.
 * Generation uses the store image's own tool, so the key format always
 * matches what the store expects.
 */
export async function ensureRecoveryKey(dir: string, c: Config, storeImage: string): Promise<'generated' | 'copied' | 'present'> {
    const pub = join(dir, RECOVERY_PUBLIC);
    mkdirSync(join(dir, 'keys'), {recursive: true});

    if (c.recovery.mode === 'existing') {
        const source = resolve(dir, c.recovery.publicKeyPath!);
        if (!existsSync(source)) throw new InstallerError(`Recovery public key not found at ${source}.`, 'Mount it into the installer container, or place it in the install directory.');
        if (!readFileSync(source, 'utf8').includes('-----BEGIN PUBLIC KEY-----')) {
            throw new InstallerError(`${source} is not a PEM public key.`, 'Give the *public* half (recovery-public.pem). Never put the private half on the server.');
        }
        if (source === pub) return 'present';
        copyFileSync(source, pub);
        return 'copied';
    }

    if (existsSync(pub)) return 'present';
    await ui.task('Generating the recovery key pair', () =>
        docker(['run', '--rm', '-u', '0:0', '-v', `${join(dir, 'keys')}:/keys`, storeImage, 'generate-recovery-key', '--out', '/keys/recovery']),
    );
    return 'generated';
}

/** Walks the operator through getting the private half off this machine. */
export async function handOverPrivateKey(dir: string): Promise<void> {
    const priv = join(dir, RECOVERY_PRIVATE);
    if (!existsSync(priv)) return;
    ui.note(
        [
            `The private half is at ${pc.bold(priv)}.`,
            'It is the last way into documents when every workspace key is lost.',
            `It must ${pc.bold('not')} stay on this server or in its backups.`,
            'Copy it somewhere offline (a password manager, a vault, printed and locked away).',
        ].join('\n'),
        'Recovery key',
    );
    if (!ui.interactive) {
        ui.warn(`Leaving ${RECOVERY_PRIVATE} in place because this run is non-interactive. Move it off the server; \`status\` will keep reminding you.`);
        return;
    }
    for (; ;) {
        const choice = await ui.select({
            message: 'Next step for the private key',
            options: [
                {value: 'print', label: 'Show it here so I can copy it'},
                {value: 'delete', label: "I've stored it safely — delete it from this server"},
                {value: 'keep', label: "Leave it for now; I'll move it myself"},
            ],
        });
        if (choice === 'print') {
            ui.note(readFileSync(priv, 'utf8').trim(), 'recovery-private.pem');
            continue;
        }
        if (choice === 'delete') {
            const sure = await ui.confirm('Delete it? Without a copy, escrowed documents can never be recovered.', false);
            if (!sure) continue;
            rmSync(priv);
            ui.success('Private key removed from this server.');
        } else {
            ui.warn(`Remember to move ${RECOVERY_PRIVATE} off this server.`);
        }
        return;
    }
}

/**
 * First issuance for nginx + certbot. Later renewals are the certbot
 * service's job. Re-issues (with --expand) when the hostnames change.
 */
export async function ensureCertificate(
    dir: string,
    c: Config,
    d: Derived,
    compose: Compose,
    issuedFor: string[] | undefined,
): Promise<string[] | undefined> {
    if (c.proxy.type !== 'nginx' || c.proxy.tls === 'provided') return issuedFor;
    const p = c.proxy;
    const live = join(dir, 'certbot', 'conf', 'live', certName(c), 'fullchain.pem');
    const wanted = [...d.hosts].sort();
    if (existsSync(live) && JSON.stringify(issuedFor ?? []) === JSON.stringify(wanted)) return issuedFor;

    mkdirSync(join(dir, 'certbot', 'www'), {recursive: true});
    const common = [
        'certonly', '--non-interactive', '--agree-tos', '--expand',
        '--cert-name', certName(c),
        ...(p.email ? ['-m', p.email] : ['--register-unsafely-without-email']),
        ...(p.staging ? ['--staging'] : []),
        ...d.hosts.flatMap((h) => ['-d', h]),
    ];
    const conf = `${join(dir, 'certbot', 'conf')}:/etc/letsencrypt`;

    await ui.task(`Requesting a certificate for ${d.hosts.join(', ')}`, async () => {
        if (p.tls === 'certbot-cloudflare') {
            return docker(['run', '--rm', '-v', conf, c.images.certbotCloudflare, ...common, '--dns-cloudflare', '--dns-cloudflare-credentials', '/etc/letsencrypt/cloudflare.ini', '--dns-cloudflare-propagation-seconds', '30']);
        }
        // nginx already serving: answer the challenge through it. Otherwise certbot listens on :80 itself.
        if (await compose.isRunning('proxy')) {
            return docker(['run', '--rm', '-v', conf, '-v', `${join(dir, 'certbot', 'www')}:/var/www/certbot`, c.images.certbot, ...common, '--webroot', '-w', '/var/www/certbot']);
        }
        return docker(['run', '--rm', '-p', '80:80', '-v', conf, c.images.certbot, ...common, '--standalone']);
    });
    return wanted;
}
