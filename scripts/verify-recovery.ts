/**
 * WS12-R1 — the recovery path, exercised end to end.
 *
 * Seal a document as the store would hold it, throw the workspace key away,
 * and recover it with nothing but the organization's offline recovery key,
 * through the real command-line tool. If this ever stops passing, escrowed
 * documents are not recoverable, which is the failure this whole design is
 * meant to make impossible.
 */
import { spawnSync } from "child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  sealDocument,
  openDocumentPackage,
  recoverDocumentPackage,
  toPem,
  fromPem,
  type DocumentPackage,
} from "../src/crypto/documentPackage.ts";
import {
  exportPrivateKey,
  generateDocumentKeyHex,
  generateWorkspaceKey,
  generateWrappingKeyPair,
  importRecoveryPrivateKey,
} from "../src/crypto/keys.ts";

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}
async function rejects(work: () => Promise<unknown>, message: string) {
  try {
    await work();
    failures++;
    console.error(`  FAIL: ${message} (it succeeded)`);
  } catch {
    console.log(`  ✓ ${message}`);
  }
}

const DOCUMENT = {
  schemaVersion: "0.7",
  title: "Payments platform",
  nodes: [
    { id: "n1", type: "typed", position: { x: 0, y: 0 }, data: { nodeType: "service", label: "Gateway" } },
    { id: "n2", type: "typed", position: { x: 220, y: 0 }, data: { nodeType: "service", label: "Ledger" } },
  ],
  edges: [{ id: "e1", source: "n1", target: "n2", type: "typed", data: { edgeType: "sync" } }],
  scenarios: [],
  requirements: { itemTypes: [], categories: [], items: [], relationshipTypes: [], relationships: [], nextSequence: {} },
  programIncrements: [],
  team: { members: [], settings: {} },
  milestones: [],
  metadata: { updatedAt: "2026-09-17T00:00:00.000Z" },
};

const workDir = mkdtempSync(join(tmpdir(), "recovery-"));
try {
  console.log("=== A document as the store holds it ===");
  // First-run setup (WS7-R10): the deployment generates the recovery keypair
  // and keeps the private half offline. This is the only time it exists here.
  const recoveryPair = await generateWrappingKeyPair("recovery");
  const recoveryPem = toPem(await exportPrivateKey(recoveryPair.privateKey));
  const keyPath = join(workDir, "recovery-private.pem");
  writeFileSync(keyPath, recoveryPem, "utf8");

  // The document key as a link carries it; the storage key is derived from
  // it inside sealDocument (WS7-R1).
  const documentKey = generateDocumentKeyHex();
  const workspaceKey = await generateWorkspaceKey();
  const body = new TextEncoder().encode(JSON.stringify(DOCUMENT));
  const pkg = await sealDocument([{ kind: "snapshot", data: body }], {
    docId: "doc-payments",
    version: 7,
    documentKey,
    workspaceKey,
    recoveryPublicKey: recoveryPair.publicKey,
  });
  const packagePath = join(workDir, "doc-payments.json");
  writeFileSync(packagePath, JSON.stringify(pkg, null, 2), "utf8");

  const asStored = JSON.stringify(pkg);
  check(!asStored.includes("Payments platform") && !asStored.includes("Gateway"), "the package holds no readable content");
  check(!!pkg.keys.wrappedForWorkspace && !!pkg.keys.wrappedForRecovery, "it carries both wraps: the workspace key's and the escrow (WS7-R4)");

  const everyday = await openDocumentPackage(pkg, workspaceKey);
  check(new TextDecoder().decode(everyday[0].data) === JSON.stringify(DOCUMENT), "a member with the workspace key opens it");

  console.log("\n=== The workspace key is gone ===");
  const strangerWorkspaceKey = await generateWorkspaceKey();
  await rejects(() => openDocumentPackage(pkg, strangerWorkspaceKey), "another workspace key does not open it");

  console.log("\n=== Recovery, in this process ===");
  let recoveredHere: { kind: string; data: Uint8Array }[] | null = null;
  try {
    recoveredHere = await recoverDocumentPackage(pkg, await importRecoveryPrivateKey(fromPem(recoveryPem)));
  } catch (error) {
    // Reported as a failed check rather than a stack trace: this is the one
    // that matters most, so it should read clearly when it breaks.
    console.error(`  (recovery threw: ${String(error).slice(0, 120)})`);
  }
  check(
    recoveredHere !== null && new TextDecoder().decode(recoveredHere[0].data) === JSON.stringify(DOCUMENT),
    "the recovery key alone recovers the content"
  );
  const strangerPair = await generateWrappingKeyPair("recovery");
  const strangerKey = await importRecoveryPrivateKey(await exportPrivateKey(strangerPair.privateKey));
  await rejects(() => recoverDocumentPackage(pkg, strangerKey), "another organization's recovery key does not");

  console.log("\n=== Recovery, through the tool a person would run ===");
  const outPath = join(workDir, "recovered.json");
  const run = (args: string[]) =>
    spawnSync(process.execPath, [join("node_modules", "tsx", "dist", "cli.mjs"), "scripts/recover-document.ts", ...args], {
      encoding: "utf8",
    });

  const ok = run(["--key", keyPath, "--package", packagePath, "--out", outPath, "--quiet"]);
  check(ok.status === 0, `the tool exits successfully (${ok.status}${ok.status === 0 ? "" : `: ${ok.stderr.slice(0, 200)}`})`);
  check(ok.stdout.trim() === outPath, "and prints where it wrote the document");
  const recovered = JSON.parse(readFileSync(outPath, "utf8"));
  check(JSON.stringify(recovered) === JSON.stringify(DOCUMENT), "the recovered file is the original document, byte for byte");
  check(recovered.title === "Payments platform" && recovered.nodes.length === 2, "with its title and contents intact");

  const wrongKeyPath = join(workDir, "other.pem");
  writeFileSync(wrongKeyPath, toPem(await exportPrivateKey(strangerPair.privateKey)), "utf8");
  const wrongKey = run(["--key", wrongKeyPath, "--package", packagePath, "--out", join(workDir, "no.json"), "--quiet"]);
  check(wrongKey.status === 1 && /does not match/.test(wrongKey.stderr), "the wrong recovery key fails with an explanation, not a stack trace");

  const damagedPath = join(workDir, "damaged.json");
  const damaged = JSON.parse(JSON.stringify(pkg)) as DocumentPackage;
  const sealed = damaged.blobs[0].sealed;
  damaged.blobs[0].sealed = `${sealed.slice(0, -2)}${sealed.slice(-2) === "AA" ? "AB" : "AA"}`;
  writeFileSync(damagedPath, JSON.stringify(damaged), "utf8");
  const altered = run(["--key", keyPath, "--package", damagedPath, "--out", join(workDir, "no.json"), "--quiet"]);
  check(altered.status === 1, "an altered package is refused (WS12-R3)");

  writeFileSync(join(workDir, "nonsense.json"), "{ not json", "utf8");
  const nonsense = run(["--key", keyPath, "--package", join(workDir, "nonsense.json"), "--quiet"]);
  check(nonsense.status === 1 && /not valid JSON/.test(nonsense.stderr), "a file that is not a package says so plainly");

  const help = run(["--help"]);
  check(help.status === 0 && /recovery private key/.test(help.stderr + help.stdout), "--help explains what the key is");

  console.log("\n=== Passthrough deployments have nothing to escrow ===");
  const noEscrow = await sealDocument([{ kind: "snapshot", data: body }], {
    docId: "doc-plain",
    version: 1,
    documentKey,
    workspaceKey,
  });
  check(noEscrow.keys.wrappedForRecovery === undefined, "a package without escrow simply has no recovery wrap");
  const recoveryKey = await importRecoveryPrivateKey(fromPem(recoveryPem));
  await rejects(() => recoverDocumentPackage(noEscrow, recoveryKey), "and recovery says so rather than failing obscurely");
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll recovery checks passed.");
