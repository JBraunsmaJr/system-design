/**
 * The documents a diagram node can link to (see domain/canvas/documentLinks.ts):
 * this browser's stored documents, plus the documents in the workspaces
 * this person can see.
 *
 * Without the workspace half, the picker only knew about documents someone
 * had already opened here - so the shared platform's document a teammate put
 * in a workspace, the most likely thing to link to, could not be picked.
 */
import { isValidDocumentId } from '../../domain/storage/currentDocument.ts';
import { StoreClientError } from '../access/storeErrors.ts';
import type { TrustedStoreClient } from '../trusted/trustedStoreClient.ts';

export interface LinkableDocument {
  docId: string;
  title: string;
  /** Where this browser knows it from. `workspace` alone means it has not
   * been opened here yet; it opens by id and arrives from the store. */
  source: 'local' | 'workspace' | 'both';
}

export interface LinkableDocumentList {
  documents: LinkableDocument[];
  /** The workspace exists for this browser but couldn't be read just now
   * (offline). Worth saying, so an absent document isn't taken
   * to mean it doesn't exist. */
  workspaceUnavailable: boolean;
}

/**
 * The documents in every workspace this person can see. `null` when they
 * are not signed in - there is then no workspace to read, which is not the
 * same as one that cannot be reached; that throws.
 */
export async function listWorkspaceDocuments(
  client: Pick<TrustedStoreClient, 'listWorkspaces' | 'listDocuments'>,
): Promise<{ docId: string; title: string }[] | null> {
  let workspaces;
  try {
    workspaces = await client.listWorkspaces();
  } catch (error) {
    if (error instanceof StoreClientError && error.reason === 'unauthenticated') return null;
    throw error;
  }
  const lists = await Promise.all(
    workspaces.map((workspace) => client.listDocuments(workspace.workspaceId)),
  );
  // Ids come from the store and become URLs, so only valid ones.
  return lists
    .flat()
    .filter((document) => isValidDocumentId(document.docId))
    .map((document) => ({ docId: document.docId, title: document.title }));
}

/**
 * One list from both sources, each document once. Local documents keep
 * their order (most recently updated first); workspace-only documents
 * follow, by title.
 *
 * A document in both takes the workspace's title. Every editor's sync
 * writes the title to the store as they edit, so it is what everyone sees -
 * whereas this browser's copy may not have been opened since and still
 * carry an older one.
 */
export function mergeLinkableDocuments(
  local: readonly { docId: string; title: string }[],
  workspace: readonly { docId: string; title: string }[],
): LinkableDocument[] {
  const inWorkspace = new Map(workspace.map((d) => [d.docId, d]));
  const merged: LinkableDocument[] = [];
  const seen = new Set<string>();
  for (const d of local) {
    if (seen.has(d.docId)) continue;
    seen.add(d.docId);
    const shared = inWorkspace.get(d.docId);
    merged.push({
      docId: d.docId,
      title: shared?.title || d.title || '',
      source: shared ? 'both' : 'local',
    });
  }
  const workspaceOnly = workspace
    .filter((d) => !seen.has(d.docId) && (seen.add(d.docId), true))
    .map((d) => ({ docId: d.docId, title: d.title, source: 'workspace' as const }))
    .sort((a, b) => a.title.localeCompare(b.title));
  return [...merged, ...workspaceOnly];
}

/**
 * Both sources, read together. Either failing leaves the other's documents
 * available: the picker is a convenience, and an unreachable store must not
 * hide the documents that are right here.
 */
export async function listLinkableDocuments(sources: {
  listLocal: () => Promise<{ docId: string; title: string }[]>;
  /** Omitted where the deployment has no store. */
  listWorkspace?: () => Promise<{ docId: string; title: string }[] | null>;
}): Promise<LinkableDocumentList> {
  const [local, workspace] = await Promise.allSettled([
    sources.listLocal(),
    sources.listWorkspace ? sources.listWorkspace() : Promise.resolve(null),
  ]);
  return {
    documents: mergeLinkableDocuments(
      local.status === 'fulfilled' ? local.value : [],
      workspace.status === 'fulfilled' ? (workspace.value ?? []) : [],
    ),
    workspaceUnavailable: workspace.status === 'rejected',
  };
}
