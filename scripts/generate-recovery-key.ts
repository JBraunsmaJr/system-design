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
import { writeFileSync, existsSync } from "fs";
import { generateWrappingKeyPair, exportPrivateKey, exportPublicKey } from "../src/crypto/keys.ts";
import { toPem } from "../src/crypto/documentPackage.ts";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const prefix = outIndex === -1 ? "./recovery" : (args[outIndex + 1] ?? "./recovery");
const publicPath = `${prefix}-public.pem`;
const privatePath = `${prefix}-private.pem`;

for (const path of [publicPath, privatePath]) {
  if (existsSync(path)) {
    console.error(`${path} already exists. Refusing to overwrite a recovery key: if it is in use, replacing it makes every escrowed document unrecoverable.`);
    process.exit(1);
  }
}

const pair = await generateWrappingKeyPair("recovery");
writeFileSync(publicPath, toPem(await exportPublicKey(pair.publicKey), "PUBLIC KEY"), "utf8");
writeFileSync(privatePath, toPem(await exportPrivateKey(pair.privateKey)), { encoding: "utf8", mode: 0o600 });

console.log(`Wrote:
  ${publicPath}   give this to the store (RECOVERY_PUBLIC_KEY_FILE)
  ${privatePath}  keep this offline; the store must never see it

Without the private half, nothing escrowed to this key can ever be
recovered. Store it apart from your database backups.`);
