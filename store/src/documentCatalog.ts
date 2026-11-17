/**
 * Which workspace each document is in, and what it is called.
 *
 * The document service (documentService.ts) holds a document's content: an
 * append-only log of updates, its version, deletion and retention. It knows
 * nothing about workspaces or titles, and its blobs are opaque to it.
 *
 * The catalog is the other half: for each document, the workspace it
 * belongs to - which is what decides who may touch it - and its title, in
 * plain text so a workspace's documents can be listed without opening them.
 * A document that is not in the catalog is not reachable through the
 * workspace API at all.
 *
 * The in-memory catalog below and the PostgreSQL one in
 * postgresDocumentCatalog.ts have the same contract;
 * scripts/verify-workspaces-contract.ts runs one suite against both.
 */
import { randomBytes } from 'crypto';

export interface CatalogEntry {
  docId: string;
  workspaceId: string;
  title: string;
  /** Null once the creator's account is gone. */
  createdBy: string | null;
  createdAt: string;
}

export type CatalogErrorReason = 'not-found' | 'conflict' | 'invalid';

export class CatalogError extends Error {
  reason: CatalogErrorReason;
  constructor(message: string, reason: CatalogErrorReason) {
    super(message);
    this.name = 'CatalogError';
    this.reason = reason;
  }
}

export const MAX_TITLE_LENGTH = 200;
export const UNTITLED = 'Untitled';

/** A title as stored: trimmed, inner whitespace collapsed, never empty. */
export function normalizeTitle(title: unknown): string {
  if (title === undefined || title === null) return UNTITLED;
  if (typeof title !== 'string') {
    throw new CatalogError('A title must be text.', 'invalid');
  }
  const normalized = title.trim().replace(/\s+/g, ' ');
  if (normalized.length > MAX_TITLE_LENGTH) {
    throw new CatalogError(`A title can be at most ${MAX_TITLE_LENGTH} characters.`, 'invalid');
  }
  return normalized === '' ? UNTITLED : normalized;
}

/**
 * Document ids are chosen by the editor (it has one before a document is
 * ever saved to a store), so they are checked here: short, and from a set of
 * characters that is safe in a URL path and a log line.
 */
const DOC_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * The id the editor gives a browser's first, unsaved document - the same in
 * every browser. A workspace document under it would be taken by every
 * browser for its own first document, so it is never accepted.
 */
export const RESERVED_DOC_IDS: readonly string[] = ['local'];

export function requireDocId(docId: unknown): string {
  if (typeof docId === 'string' && RESERVED_DOC_IDS.includes(docId)) {
    throw new CatalogError(
      `"${docId}" is the id every browser gives its own first document, so it cannot name a workspace document. Give the document a new id.`,
      'invalid',
    );
  }
  if (typeof docId !== 'string' || !DOC_ID_PATTERN.test(docId)) {
    throw new CatalogError(
      'A document id is 1 to 128 letters, digits, dots, underscores, colons or hyphens, starting with a letter or digit.',
      'invalid',
    );
  }
  return docId;
}

export interface DocumentCatalog {
  /** Refuses (`conflict`) an id that is already in any workspace. */
  add(input: {
    docId: string;
    workspaceId: string;
    title: string;
    createdBy: string | null;
  }): Promise<CatalogEntry>;
  get(docId: string): Promise<CatalogEntry | null>;
  /** In the order they were added; ties broken by id so the order is total. */
  listByWorkspace(workspaceId: string): Promise<CatalogEntry[]>;
  setTitle(docId: string, title: string): Promise<CatalogEntry>;
  /** Puts the document in another workspace. Its content is untouched. */
  move(docId: string, workspaceId: string): Promise<CatalogEntry>;
  /** False when it was not in the catalog. */
  remove(docId: string): Promise<boolean>;
  /**
   * The secret a document's live session is derived from, made the first
   * time it is asked for and the same ever after. Never part of a
   * CatalogEntry: an entry is what the API returns, and this is given only
   * to people who may edit the document (see v2/sessions.ts).
   */
  sessionSecret(docId: string): Promise<string>;
}

/** 32 random bytes, as text. */
export function newSessionSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** The order both catalogs list in. */
export function byCreation(a: CatalogEntry, b: CatalogEntry): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0;
}

export interface MemoryDocumentCatalogOptions {
  now?: () => Date;
  /**
   * Whether a workspace id names a real workspace. PostgreSQL enforces this
   * with a foreign key; in memory it is this function, so both catalogs
   * refuse an unknown workspace the same way. Defaults to accepting any id.
   */
  workspaceExists?: (workspaceId: string) => boolean | Promise<boolean>;
}

/** For tests and for a store run without PostgreSQL. */
export function createMemoryDocumentCatalog(
  options: MemoryDocumentCatalogOptions = {},
): DocumentCatalog {
  const now = options.now ?? (() => new Date());
  const entries = new Map<string, CatalogEntry>();
  const secrets = new Map<string, string>();

  async function assertWorkspace(workspaceId: string) {
    if (options.workspaceExists && !(await options.workspaceExists(workspaceId))) {
      throw new CatalogError(`No workspace ${workspaceId}.`, 'not-found');
    }
  }

  function existing(docId: string): CatalogEntry {
    const entry = entries.get(docId);
    if (!entry) throw new CatalogError(`No document ${docId}.`, 'not-found');
    return entry;
  }

  return {
    async add({ docId, workspaceId, title, createdBy }) {
      const id = requireDocId(docId);
      const normalized = normalizeTitle(title);
      await assertWorkspace(workspaceId);
      if (entries.has(id)) {
        throw new CatalogError(`There is already a document ${id}.`, 'conflict');
      }
      const entry: CatalogEntry = {
        docId: id,
        workspaceId,
        title: normalized,
        createdBy,
        createdAt: now().toISOString(),
      };
      entries.set(id, entry);
      return { ...entry };
    },

    async get(docId) {
      const entry = entries.get(docId);
      return entry ? { ...entry } : null;
    },

    async listByWorkspace(workspaceId) {
      return [...entries.values()]
        .filter((entry) => entry.workspaceId === workspaceId)
        .sort(byCreation)
        .map((entry) => ({ ...entry }));
    },

    async setTitle(docId, title) {
      const entry = existing(docId);
      entry.title = normalizeTitle(title);
      return { ...entry };
    },

    async move(docId, workspaceId) {
      const entry = existing(docId);
      await assertWorkspace(workspaceId);
      entry.workspaceId = workspaceId;
      return { ...entry };
    },

    async remove(docId) {
      secrets.delete(docId);
      return entries.delete(docId);
    },

    async sessionSecret(docId) {
      existing(docId);
      let secret = secrets.get(docId);
      if (!secret) {
        secret = newSessionSecret();
        secrets.set(docId, secret);
      }
      return secret;
    },
  };
}
