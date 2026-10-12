/**
 * Cross-document links: a diagram node pointing at another document.
 *
 * Systems are rarely drawn in one document. A payments diagram shows a box
 * for the shared auth platform, and that platform has a document of its
 * own; until now the box could only say so in its description. A node can
 * now carry a reference to that document and open it.
 *
 * A link is a document id - the same id the `?doc=` URL parameter, the
 * local document store and a workspace's index all use - plus the target's
 * title as it was when the link was made. The title is a cache, not the
 * source of truth: where this browser has the target, its current title
 * wins (see resolveLinkedDocument). It exists so a link still reads as
 * something on a canvas, in an export, and in a browser that has never
 * opened the target - a teammate's copy of a workspace document, say,
 * which opens by the same id once they have access to it.
 *
 * Pure: no React, no storage.
 */
import {isValidDocumentId, readDocumentParam, withDocumentParam,} from '../storage/currentDocument';

export interface LinkedDocumentRef {
  docId: string;
  /** The target's title when the link was made or last refreshed. */
  title: string;
}

/** The longest cached title kept - enough for any real title, short enough
 * that a hostile or corrupted value can't bloat a node. */
const MAX_TITLE_LENGTH = 200;

/**
 * A node's `linkedDocument` as it can safely be used, or undefined.
 *
 * Node data arrives from files and from peers, so this is the one gate
 * every reader goes through: an id the URL and storage layers would reject
 * (isValidDocumentId) is dropped rather than turned into a link.
 */
export function normalizeLinkedDocument(value: unknown): LinkedDocumentRef | undefined {
  if (!value || typeof value !== 'object') return undefined;
    const {docId, title} = value as { docId?: unknown; title?: unknown };
  if (!isValidDocumentId(docId)) return undefined;
  const cleanTitle = typeof title === 'string' ? title.trim().slice(0, MAX_TITLE_LENGTH) : '';
    return {docId, title: cleanTitle};
}

/** What a link reads as when nothing better is known. */
export function linkedDocumentLabel(ref: LinkedDocumentRef): string {
  return ref.title || 'Untitled document';
}

/**
 * The URL that opens `docId`: the current page with `?doc=` set and any
 * session link in the hash removed, because opening a document must never
 * rejoin a session (the same rule useOpenDocument's openDocumentInTab
 * follows). Null for an id that isn't valid.
 */
export function linkedDocumentHref(currentHref: string, docId: string): string | null {
  if (!isValidDocumentId(docId)) return null;
  const next = withDocumentParam(currentHref, docId);
  try {
    const url = new URL(next);
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export interface ResolvedLinkedDocument {
  ref: LinkedDocumentRef;
  /** The live title where this browser has the document, else the cache. */
  title: string;
  /** Whether this browser's document list has the target. A link to a
   * document that isn't here still opens - a workspace document arrives
   * by id - so this is information, not a reason to refuse. */
  isKnownHere: boolean;
}

export function resolveLinkedDocument(
    ref: LinkedDocumentRef,
    known: readonly { docId: string; title: string }[],
): ResolvedLinkedDocument {
  const entry = known.find((e) => e.docId === ref.docId);
  return {
    ref,
    title: entry?.title || linkedDocumentLabel(ref),
    isKnownHere: Boolean(entry),
  };
}

/**
 * What someone typed or pasted to name a document: a bare id, or a link to
 * the editor with `?doc=<id>` in it (what the address bar shows, and what
 * people actually share). The id or null - never a guess, since a wrong id
 * makes a link that opens an empty document.
 */
export function parseDocumentIdInput(input: string): string | null {
  const text = input.trim();
  if (text === '') return null;
  if (isValidDocumentId(text)) return text;
  if (!/^https?:\/\//i.test(text)) return null;
  const docId = readDocumentParam(text);
  return isValidDocumentId(docId) ? docId : null;
}
