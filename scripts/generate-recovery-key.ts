/**
 * The organization's recovery keypair (WS7-R5, R10).
 *
 *   npx tsx scripts/generate-recovery-key.ts --out ./recovery
 *
 * Run once, at first-run setup, on a machine that is not the server. It
 * writes two files: the public half, which the store is configured with and
 * every client wraps document keys to, and the private half, which must
 * never reach the store, a backup of the database, or a browser.
 *
 * The private half is the last route into a document when every workspace
 * key is gone. Keep it offline, and keep it somewhere other than the
 * database backups it would be used to recover.
 */
import { writeFileSync, existsSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import { generateWrappingKeyPair, exportPrivateKey, exportPublicKey } from '../src/crypto/keys.ts';
import { toPem } from '../src/crypto/documentPackage.ts';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const prefix = outIndex === -1 ? './recovery' : (args[outIndex + 1] ?? './recovery');
const publicPath = `${prefix}-public.pem`;
const privatePath = `${prefix}-private.pem`;

for (const path of [publicPath, privatePath]) {
  if (existsSync(path)) {
    console.error(
      `${path} already exists. Refusing to overwrite a recovery key: if it is in use, replacing it makes every escrowed document unrecoverable.`,
    );
    process.exit(1);
  }
}

const pair = await generateWrappingKeyPair('recovery');
const privatePem = toPem(await exportPrivateKey(pair.privateKey));
const publicPem = toPem(await exportPublicKey(pair.publicKey), 'PUBLIC KEY');

// Both halves, or neither. A public key left behind without its private
// half is the dangerous outcome: configured into a store, every document
// would be escrowed to a key nobody holds, and nothing would say so until
// the day someone needed it. So the private half is written first, and
// anything written is removed if the other write fails - which also means
// a failed attempt can simply be run again.
const written: string[] = [];
try {
  writeFileSync(privatePath, privatePem, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  written.push(privatePath);
  writeFileSync(publicPath, publicPem, { encoding: 'utf8', flag: 'wx' });
  written.push(publicPath);
} catch (error) {
  for (const path of written) {
    try {
      unlinkSync(path);
    } catch {
      // Best effort: the message below names both paths either way.
    }
  }
  const code = (error as NodeJS.ErrnoException).code;
  const where = dirname(privatePath);
  const why =
    code === 'EACCES' || code === 'EPERM'
      ? `This process cannot write to ${where}.\n\n` +
        `Run from Docker, the image works as an unprivileged user, and a mounted folder\n` +
        `owned by someone else refuses it. Run the container as yourself:\n\n` +
        `  docker run --rm -u $(id -u):$(id -g) -v ./keys:/keys \\\n` +
        `    ghcr.io/jbraunsmajr/system-design-store:latest generate-recovery-key --out /keys/recovery\n\n` +
        `(On Windows PowerShell, use -v \${PWD}/keys:/keys and leave out -u.)`
      : code === 'ENOENT' || code === 'ENOTDIR'
        ? `${where} does not exist. Create it, or mount a folder there, and run this again.`
        : code === 'EEXIST'
          ? `A recovery key appeared at ${privatePath} or ${publicPath} while this ran. Nothing was replaced.`
          : `The key pair could not be written (${code ?? String(error)}).`;
  console.error(`\nNo recovery key was created.\n\n${why}\n`);
  process.exit(1);
}

console.log(`Wrote:
  ${publicPath}   give this to the store (RECOVERY_PUBLIC_KEY_FILE)
  ${privatePath}  keep this offline; the store must never see it

Without the private half, nothing escrowed to this key can ever be
recovered. Store it apart from your database backups.`);
