/**
 * The editor's client for the store's workspace API (/v2).
 *
 * In this API the server decides access, so there is nothing here to seal,
 * wrap or enrol: a request carries the session cookie, and the store allows
 * it or not from the signed-in person's role. See docs/trusted-store.md.
 *
 * Errors are StoreClientError, with a reason the editor can act on:
 * "offline", "conflict", "forbidden" and so on.
 */
import { StoreClientError, type StoreClientErrorReason } from '../access/storeErrors.ts';
import type { DocumentLog } from '../sync/documentSync.ts';

export type WorkspaceRole = 'viewer' | 'editor' | 'owner';

/** How a role was arrived at. */
export type RoleSource = { kind: 'member' } | { kind: 'group'; group: string } | { kind: 'admin' };

export interface TrustedWorkspace {
  workspaceId: string;
  name: string;
  createdAt: string;
  archivedAt: string | null;
  /** The signed-in person's own role here, and how they came by it. */
  role: WorkspaceRole;
  via: RoleSource;
}

export interface TrustedDocument {
  docId: string;
  workspaceId: string;
  title: string;
  createdAt: string;
  version: number;
  updatedAt: string;
  deletedAt: string | null;
  purgeAfter: string | null;
  legalHold: { reason: string; placedAt: string } | null;
}

export interface TrustedDocumentSession {
  room: string;
  key: string;
  /** Null where the relay admits anyone who knows the room. */
  relayToken: string | null;
  relayTokenExpiresAt: string | null;
}

export interface TrustedMe {
  user: { userId: string; displayName: string | null };
  groups: string[];
  isAdmin: boolean;
  canCreateWorkspaces: boolean;
}

export interface TrustedMember {
  userId: string;
  displayName: string | null;
  role: WorkspaceRole;
  addedAt: string;
}

export interface TrustedGroupMapping {
  group: string;
  role: WorkspaceRole;
  addedAt: string;
}

export interface TrustedStoreClientOptions {
  /** Where the store is, e.g. https://store.example.com */
  baseUrl: string;
  /** Injected for tests; defaults to the platform fetch with cookies. */
  fetch?: typeof fetch;
}

const toBase64 = (bytes: Uint8Array) => {
  // In chunks: spreading a large update into one call overflows the stack.
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

const KNOWN_REASONS: readonly StoreClientErrorReason[] = [
  'unauthenticated',
  'not-found',
  'deleted',
  'conflict',
  'quota',
  'too-large',
  'forbidden',
];

export function createTrustedStoreClient(options: TrustedStoreClientOptions) {
  const call =
    options.fetch ??
    ((input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, credentials: 'include' }));
  const base = `${options.baseUrl.replace(/\/+$/, '')}/v2`;
  const id = encodeURIComponent;

  async function request(
    path: string,
    init: { method?: string; body?: unknown; keepalive?: boolean } = {},
  ): Promise<{ body: Record<string, unknown>; version: number | null }> {
    let response: Response;
    try {
      response = await call(`${base}${path}`, {
        method: init.method ?? 'GET',
        keepalive: init.keepalive,
        headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
    } catch (error) {
      // The store being unreachable is ordinary - the editor works without
      // it - so it is its own reason rather than an error to surface raw.
      throw new StoreClientError(`The store could not be reached: ${String(error)}`, 'offline');
    }
    const text = await response.text();
    let body: Record<string, unknown>;
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      throw new StoreClientError(
        'The store returned something that is not JSON.',
        'store-error',
        response.status,
      );
    }
    if (!response.ok) {
      const error = (body.error ?? {}) as { reason?: string; message?: string };
      const reason = KNOWN_REASONS.includes(error.reason as StoreClientErrorReason)
        ? (error.reason as StoreClientErrorReason)
        : 'store-error';
      throw new StoreClientError(
        error.message ?? `The store refused the request (${response.status}).`,
        reason,
        response.status,
      );
    }
    const header = response.headers.get('x-document-version');
    return { body, version: header === null ? null : Number(header) };
  }

  return {
    /** Who is signed in and what they may do store-wide. Throws
     * `unauthenticated` when nobody is. */
    async me(): Promise<TrustedMe> {
      return (await request('/me')).body as unknown as TrustedMe;
    },

    // --- Workspaces --------------------------------------------------------

    /** The signed-in person's workspaces, in name order. */
    async listWorkspaces(options: { includeArchived?: boolean } = {}): Promise<TrustedWorkspace[]> {
      const { body } = await request(
        `/workspaces${options.includeArchived ? '?archived=true' : ''}`,
      );
      return body.workspaces as TrustedWorkspace[];
    },

    async createWorkspace(name: string): Promise<TrustedWorkspace> {
      const { body } = await request('/workspaces', { method: 'POST', body: { name } });
      return body.workspace as TrustedWorkspace;
    },

    async renameWorkspace(workspaceId: string, name: string): Promise<TrustedWorkspace> {
      const { body } = await request(`/workspaces/${id(workspaceId)}`, {
        method: 'PATCH',
        body: { name },
      });
      return body.workspace as TrustedWorkspace;
    },

    async setWorkspaceArchived(workspaceId: string, archived: boolean): Promise<TrustedWorkspace> {
      const { body } = await request(
        `/workspaces/${id(workspaceId)}/${archived ? 'archive' : 'restore'}`,
        { method: 'POST' },
      );
      return body.workspace as TrustedWorkspace;
    },

    // --- Members and groups ------------------------------------------------

    async listMembers(
      workspaceId: string,
    ): Promise<{ members: TrustedMember[]; groups: TrustedGroupMapping[] }> {
      const { body } = await request(`/workspaces/${id(workspaceId)}/members`);
      return {
        members: body.members as TrustedMember[],
        groups: body.groups as TrustedGroupMapping[],
      };
    },

    /** Adds someone, or changes the role of someone already there. */
    async putMember(
      workspaceId: string,
      userId: string,
      role: WorkspaceRole,
    ): Promise<TrustedMember> {
      const { body } = await request(`/workspaces/${id(workspaceId)}/members/${id(userId)}`, {
        method: 'PUT',
        body: { role },
      });
      return body.member as TrustedMember;
    },

    async removeMember(workspaceId: string, userId: string): Promise<void> {
      await request(`/workspaces/${id(workspaceId)}/members/${id(userId)}`, { method: 'DELETE' });
    },

    /** Maps an identity-provider group to a role, or changes its role. */
    async putGroupMapping(
      workspaceId: string,
      group: string,
      role: WorkspaceRole,
    ): Promise<TrustedGroupMapping> {
      // The group goes in the body, not the address: its name may contain
      // a slash, which a proxy in front of the store would rewrite.
      const { body } = await request(`/workspaces/${id(workspaceId)}/groups`, {
        method: 'PUT',
        body: { group, role },
      });
      return body.group as TrustedGroupMapping;
    },

    async removeGroupMapping(workspaceId: string, group: string): Promise<void> {
      await request(`/workspaces/${id(workspaceId)}/groups?group=${encodeURIComponent(group)}`, {
        method: 'DELETE',
      });
    },

    /** People to add, by name. At least two characters. */
    async findPeople(
      workspaceId: string,
      query: string,
    ): Promise<{ userId: string; displayName: string | null }[]> {
      const { body } = await request(
        `/workspaces/${id(workspaceId)}/people?query=${encodeURIComponent(query)}`,
      );
      return body.people as { userId: string; displayName: string | null }[];
    },

    // --- Documents ---------------------------------------------------------

    async listDocuments(
      workspaceId: string,
      options: { deleted?: boolean } = {},
    ): Promise<TrustedDocument[]> {
      const { body } = await request(
        `/workspaces/${id(workspaceId)}/documents${options.deleted ? '?deleted=true' : ''}`,
      );
      return body.documents as TrustedDocument[];
    },

    /** Puts a new, empty document in a workspace. Its content follows as
     * updates. Refused (`conflict`) if the id is already in the store. */
    async createDocument(
      workspaceId: string,
      document: { docId: string; title: string },
    ): Promise<TrustedDocument> {
      const { body } = await request(`/workspaces/${id(workspaceId)}/documents`, {
        method: 'POST',
        body: document,
      });
      return body.document as TrustedDocument;
    },

    /**
     * Where a document is and what it is called, or null when it is not in
     * the store or this person may not see it - which the store does not
     * tell apart, on purpose.
     */
    async findDocument(docId: string): Promise<TrustedDocument | null> {
      try {
        // No updates are wanted, only the record: ask for those after a
        // version far beyond any real one.
        const { body } = await request(
          `/documents/${id(docId)}/updates?since=${Number.MAX_SAFE_INTEGER}`,
        );
        return body.document as TrustedDocument;
      } catch (error) {
        if (error instanceof StoreClientError && error.reason === 'not-found') return null;
        throw error;
      }
    },

    async retitleDocument(docId: string, title: string): Promise<TrustedDocument> {
      const { body } = await request(`/documents/${id(docId)}`, {
        method: 'PATCH',
        body: { title },
      });
      return body.document as TrustedDocument;
    },

    async moveDocument(docId: string, workspaceId: string): Promise<TrustedDocument> {
      const { body } = await request(`/documents/${id(docId)}`, {
        method: 'PATCH',
        body: { workspaceId },
      });
      return body.document as TrustedDocument;
    },

    async deleteDocument(docId: string): Promise<TrustedDocument> {
      const { body } = await request(`/documents/${id(docId)}`, { method: 'DELETE' });
      return body.document as TrustedDocument;
    },

    async restoreDocument(docId: string): Promise<TrustedDocument> {
      const { body } = await request(`/documents/${id(docId)}/restore`, { method: 'POST' });
      return body.document as TrustedDocument;
    },

    /**
     * The document's live session: the relay room and the key that
     * encrypts it between browsers, with a token for the relay where it
     * asks for one. Given to people who may edit the document; a viewer is
     * refused (`forbidden`) and follows along through the store instead.
     */
    async documentSession(docId: string): Promise<TrustedDocumentSession> {
      const { body } = await request(`/documents/${id(docId)}/session`);
      return body.session as TrustedDocumentSession;
    },

    // --- Retention (store administrators) -----------------------------------

    /** Keeps a document from being purged, whatever its retention says,
     * until the hold is released. The reason is recorded with it. */
    async placeHold(docId: string, reason: string): Promise<TrustedDocument> {
      const { body } = await request(`/documents/${id(docId)}/hold`, {
        method: 'PUT',
        body: { reason },
      });
      return body.document as TrustedDocument;
    },

    async releaseHold(docId: string): Promise<TrustedDocument> {
      const { body } = await request(`/documents/${id(docId)}/hold`, { method: 'DELETE' });
      return body.document as TrustedDocument;
    },

    /** Removes a deleted document for good, before its retention ends. */
    async purgeDocument(docId: string): Promise<void> {
      await request(`/documents/${id(docId)}/purge`, { method: 'POST' });
    },

    /**
     * The document's update log, for documentSync. Updates travel as they
     * are: this store is trusted with them.
     */
    documentLog(docId: string): DocumentLog {
      const path = `/documents/${id(docId)}`;
      type Blob = { kind: string; bytes: string };
      return {
        async all() {
          const { body, version } = await request(path);
          return {
            version: version ?? (body.document as TrustedDocument).version,
            blobs: ((body.blobs as Blob[]) ?? []).map((blob) => ({
              kind: blob.kind,
              bytes: fromBase64(blob.bytes),
            })),
          };
        },
        async since(after) {
          const { body, version } = await request(`${path}/updates?since=${after}`);
          return {
            version: version ?? (body.document as TrustedDocument).version,
            updates: ((body.blobs as Blob[]) ?? []).map((blob) => fromBase64(blob.bytes)),
          };
        },
        async append(update, expectedVersion, appendOptions) {
          const { body, version } = await request(`${path}/updates`, {
            method: 'POST',
            body: { kind: 'update', bytes: toBase64(update), expectedVersion },
            keepalive: appendOptions?.keepalive,
          });
          return version ?? (body.document as { version: number }).version;
        },
        async compact(state, expectedVersion) {
          const { body, version } = await request(`${path}/compact`, {
            method: 'POST',
            body: { kind: 'snapshot', bytes: toBase64(state), expectedVersion },
          });
          return version ?? (body.document as { version: number }).version;
        },
      };
    },
  };
}

export type TrustedStoreClient = ReturnType<typeof createTrustedStoreClient>;
