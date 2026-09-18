/**
 * What the store holds for one document, and the two ways back into it
 * (WS7-R3, WS7-R4, WS7-R6).
 *
 * A package is the shape Phase 3's store will hold per document, kept here so
 * the crypto library, its tests, and the offline recovery tool all agree on
 * one definition before the service exists:
 *
 * ```
 *   docId, version                      plain, so a reader knows what it has
 *   blobs[]  { kind, sealed }           content, sealed under the document key
 *   keys.wrappedForWorkspace            document key wrapped under the workspace key
 *   keys.wrappedForRecovery             document key wrapped to the recovery public key
 * ```
 *
 * Only the document key opens the blobs. It is never stored unwrapped: a
 * member reaches it through the workspace key, and the organization reaches
 * it through the offline recovery key with no workspace key involved.
 */
import { createWebCryptoStorage } from "./storageCrypto.ts";
import type { BlobContext, BlobKind } from "./envelope.ts";
import { unwrapKey, unwrapKeyWithPrivateKey, wrapKey, wrapKeyForPublicKey } from "./keys.ts";

export interface SealedBlob {
  kind: BlobKind;
  /** Base64, so a package is plain JSON a store or a person can move around. */
  sealed: string;
}

export interface DocumentPackage {
  packageVersion: 1;
  docId: string;
  /** WS8-R15: the version these blobs belong to; bound into every envelope. */
  version: number;
  keys: {
    wrappedForWorkspace: string;
    /** Absent only where a deployment runs in passthrough mode (WS7-R4). */
    wrappedForRecovery?: string;
  };
  blobs: SealedBlob[];
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const crypto = createWebCryptoStorage();
const contextFor = (pkg: Pick<DocumentPackage, "docId" | "version">, kind: BlobKind): BlobContext => ({
  docId: pkg.docId,
  kind,
  version: pkg.version,
});

export interface SealDocumentOptions {
  docId: string;
  version: number;
  /** Opens the blobs. Wrapped twice below, never stored as it is. */
  documentKey: CryptoKey;
  workspaceKey: CryptoKey;
  /** WS7-R4. Omitted only in passthrough deployments. */
  recoveryPublicKey?: CryptoKey;
}

/** Seals one document's contents into a package. */
export async function sealDocument(
  contents: { kind: BlobKind; data: Uint8Array }[],
  options: SealDocumentOptions,
): Promise<DocumentPackage> {
  const header = { docId: options.docId, version: options.version };
  const blobs: SealedBlob[] = [];
  for (const item of contents) {
    blobs.push({
      kind: item.kind,
      sealed: toBase64(await crypto.seal(contextFor(header, item.kind), item.data, options.documentKey)),
    });
  }
  return {
    packageVersion: 1,
    docId: options.docId,
    version: options.version,
    keys: {
      wrappedForWorkspace: toBase64(await wrapKey(options.documentKey, options.workspaceKey)),
      ...(options.recoveryPublicKey
        ? { wrappedForRecovery: toBase64(await wrapKeyForPublicKey(options.documentKey, options.recoveryPublicKey)) }
        : {}),
    },
    blobs,
  };
}

async function openBlobs(pkg: DocumentPackage, documentKey: CryptoKey): Promise<{ kind: BlobKind; data: Uint8Array }[]> {
  const out: { kind: BlobKind; data: Uint8Array }[] = [];
  for (const blob of pkg.blobs) {
    out.push({ kind: blob.kind, data: await crypto.open(contextFor(pkg, blob.kind), fromBase64(blob.sealed), documentKey) });
  }
  return out;
}

/** The everyday route: a member with the workspace key. */
export async function openDocumentPackage(pkg: DocumentPackage, workspaceKey: CryptoKey) {
  const documentKey = await unwrapKey(fromBase64(pkg.keys.wrappedForWorkspace), workspaceKey, "AES-GCM");
  return openBlobs(pkg, documentKey);
}

/**
 * The last resort (WS7-R6): the organization's offline recovery private key,
 * with no workspace key, no member, and no server involved.
 */
export async function recoverDocumentPackage(pkg: DocumentPackage, recoveryPrivateKey: CryptoKey) {
  if (!pkg.keys.wrappedForRecovery) {
    throw new Error(
      `Document ${pkg.docId} has no recovery wrap. It was stored by a deployment running in passthrough mode, where content is not encrypted.`,
    );
  }
  const documentKey = await unwrapKeyWithPrivateKey(fromBase64(pkg.keys.wrappedForRecovery), recoveryPrivateKey, "AES-GCM");
  return openBlobs(pkg, documentKey);
}

// ---------------------------------------------------------------------------
// PEM, for the recovery private key as it is kept offline (WS7-R10)

export function toPem(pkcs8: Uint8Array, label = "PRIVATE KEY"): string {
  const body = toBase64(pkcs8).replace(/(.{64})/g, "$1\n").trimEnd();
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

export function fromPem(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  if (body.length === 0) throw new Error("That file does not contain a PEM key block.");
  return fromBase64(body);
}
