/**
 * Offline document recovery (WS7-R6).
 *
 *   npx tsx scripts/recover-document.ts --key recovery-private.pem \
 *       --package doc-abc.json [--out doc-abc-recovered.json]
 *
 * Takes the organization's recovery private key and one document package as
 * the store holds it, and writes the document as a normal `.json` file the
 * editor opens. Nothing else is involved: no workspace key, no member's
 * device, no server, and no network. It is the route back to content when
 * every other key is gone, and the reason documents are escrowed at all.
 *
 * The recovery private key never belongs on a server or in a browser. Keep it
 * offline, and delete any copy this run needed.
 */
import { readFileSync, writeFileSync } from "fs";
import { basename } from "path";
import {
  fromPem,
  recoverDocumentPackage,
  type DocumentPackage,
} from "../src/crypto/documentPackage.ts";
import { importRecoveryPrivateKey } from "../src/crypto/keys.ts";

interface Options {
  keyPath: string;
  packagePath: string;
  outPath: string | null;
  quiet: boolean;
}

function usage(problem?: string): never {
  if (problem) console.error(`\n${problem}`);
  console.error(`
Recover a document with the organization's offline recovery key.

  npx tsx scripts/recover-document.ts --key <recovery-private.pem> --package <document.json> [--out <file.json>]

  --key      PEM file holding the recovery private key (WS7-R10 generates it
             at first-run setup; it is never stored by the application).
  --package  One document as the store holds it: JSON with its wrapped keys
             and sealed blobs.
  --out      Where to write the recovered document. Defaults to
             <docId>-recovered.json in the working directory.
  --quiet    Only print the output path.
`);
  process.exit(problem ? 2 : 0);
}

function parseArgs(argv: string[]): Options {
  const options: Options = { keyPath: "", packagePath: "", outPath: null, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i] ?? usage(`${arg} needs a value.`);
    if (arg === "--key") options.keyPath = next();
    else if (arg === "--package") options.packagePath = next();
    else if (arg === "--out") options.outPath = next();
    else if (arg === "--quiet") options.quiet = true;
    else if (arg === "--help" || arg === "-h") usage();
    else usage(`Unknown argument: ${arg}`);
  }
  if (!options.keyPath) usage("--key is required.");
  if (!options.packagePath) usage("--package is required.");
  return options;
}

function read(path: string, what: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    console.error(`Could not read the ${what} at ${path}: ${(error as Error).message}`);
    process.exit(1);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const say = (message: string) => {
    if (!options.quiet) console.log(message);
  };

  const pem = read(options.keyPath, "recovery key");
  const packageText = read(options.packagePath, "document package");

  let pkg: DocumentPackage;
  try {
    pkg = JSON.parse(packageText) as DocumentPackage;
  } catch (error) {
    console.error(`${basename(options.packagePath)} is not valid JSON: ${(error as Error).message}`);
    process.exit(1);
  }
  if (!pkg?.docId || !Array.isArray(pkg.blobs) || !pkg.keys) {
    console.error(`${basename(options.packagePath)} does not look like a document package (expected docId, keys, and blobs).`);
    process.exit(1);
  }

  let privateKey: CryptoKey;
  try {
    privateKey = await importRecoveryPrivateKey(fromPem(pem));
  } catch (error) {
    console.error(`That does not look like a usable recovery private key: ${(error as Error).message}`);
    process.exit(1);
  }

  say(`Document ${pkg.docId}, version ${pkg.version}, ${pkg.blobs.length} blob(s).`);

  let recovered: { kind: string; data: Uint8Array }[];
  try {
    recovered = await recoverDocumentPackage(pkg, privateKey);
  } catch (error) {
    console.error(
      `Recovery failed: ${(error as Error).message}\n` +
        `This key does not match the one this document was escrowed to, or the package has been altered.`,
    );
    process.exit(1);
  }

  // The document itself is the snapshot; other blobs are its update log.
  const snapshot = recovered.find((blob) => blob.kind === "snapshot") ?? recovered[0];
  if (!snapshot) {
    console.error("The package contains no blobs to recover.");
    process.exit(1);
  }
  const text = new TextDecoder().decode(snapshot.data);
  try {
    JSON.parse(text);
  } catch {
    console.error("The recovered content is not a diagram file. The package may be from a different application.");
    process.exit(1);
  }

  const outPath = options.outPath ?? `${pkg.docId}-recovered.json`;
  writeFileSync(outPath, text, "utf8");
  say(`Recovered ${recovered.length} blob(s).`);
  console.log(outPath);
  say(`\nOpen it with File > Open. Delete any copy of the recovery key used for this run.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
