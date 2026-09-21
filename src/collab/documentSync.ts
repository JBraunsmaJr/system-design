/**
 * A workspace document is a CRDT document (WS8-R2, WS8-R4).
 *
 * Uploading whole snapshots would make the workspace a place where the
 * last writer wins, which is the opposite of what the rest of this
 * application does: two people editing the same document would overwrite
 * each other. So the workspace holds the same thing a session carries -
 * Yjs updates - sealed one by one. Everyone's updates merge, and the order
 * they arrive in does not matter.
 *
 * What this manages:
 *
 *  - applying what the store already holds, into the open document
 *  - appending this browser's changes, sealed, as they happen
 *  - fetching what others have appended since, and applying that
 *  - collapsing a long log into one state when it grows (WS8-R5)
 *
 * Remote updates are applied with a distinct origin so they are not sent
 * back, and so undo ignores them - the same rule a live session follows
 * (WS3-R3).
 */
import * as Y from 'yjs';
import type { StoreClient } from './storeClient.ts';
import { StoreClientError } from './storeClient.ts';

/** Marks updates that came from the store, so they are not echoed back
 * and undo leaves them alone. */
export const WORKSPACE_ORIGIN = Symbol('workspace');

export interface DocumentSyncOptions {
  client: StoreClient;
  docId: string;
  documentKey: string;
  doc: Y.Doc;
  /** How often to look for other people's changes. */
  pollMs?: number;
  /** Local changes are batched for this long before being appended. */
  debounceMs?: number;
  /** Collapse the log once it holds more than this many blobs (WS8-R5). */
  compactAfterBlobs?: number;
  onStatus?: (status: DocumentSyncStatus, detail?: string) => void;
}

export type DocumentSyncStatus = 'starting' | 'saving' | 'saved' | 'offline' | 'error';

export interface DocumentSync {
  /** Applies what the store holds, then keeps the two in step. */
  start(): Promise<void>;
  /** Sends anything outstanding now. */
  flush(): Promise<void>;
  /**
   * For a page that is going away. Sends what the store has not seen in
   * one request that may outlive the page, without the fetch-first that
   * an ordinary send does - there is not time for two round trips while a
   * page unloads. If it is refused because someone else wrote first,
   * nothing is lost: the change is still in this browser, and the next
   * visit sends it, since what is sent is always measured against the
   * store rather than against when it was last tried.
   */
  flushOnExit(): void;
  stop(): void;
  version(): number;
}

export function createDocumentSync(options: DocumentSyncOptions): DocumentSync {
  const { client, docId, documentKey, doc } = options;
  const pollMs = options.pollMs ?? 4000;
  const debounceMs = options.debounceMs ?? 800;
  const compactAfterBlobs = options.compactAfterBlobs ?? 200;

  let version = 0;
  let blobCount = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let poller: ReturnType<typeof setInterval> | null = null;
  let sending: Promise<void> | null = null;
  /**
   * A shadow document holding exactly what the store holds, so the diff
   * to send is measured against the store rather than against this
   * browser. Taking the local document's state as the baseline loses work
   * done while disconnected: on reconnecting, changes made offline are
   * already in the local state and would never be sent. That is what the
   * merge test caught.
   */
  const mirror = new Y.Doc();
  let dirty = false;

  const say = (status: DocumentSyncStatus, detail?: string) => options.onStatus?.(status, detail);

  function onLocalUpdate(_update: Uint8Array, origin: unknown) {
    // Remote updates arrive with our own origin; sending them back would
    // be a loop, and they are already in the store.
    if (origin === WORKSPACE_ORIGIN || stopped) return;
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void send(), debounceMs);
  }

  /** Everything this browser has that the store has not. */
  async function send(): Promise<void> {
    if (stopped || !dirty) return;
    if (sending) {
      await sending;
      if (!dirty) return;
    }
    sending = (async () => {
      try {
        say('saving');
        // Fetch first: appending against a version someone else has moved
        // past is refused, and this is also how their changes arrive
        // promptly when two people are typing.
        await pull();
        // Everything this browser has that the store does not, however
        // long ago it happened.
        const update = Y.encodeStateAsUpdate(doc, Y.encodeStateVector(mirror));
        dirty = false;
        if (update.length > 0) {
          version = await client.appendUpdate(docId, documentKey, update, version);
          Y.applyUpdate(mirror, update, WORKSPACE_ORIGIN);
          blobCount += 1;
        }
        say('saved');
        if (blobCount > compactAfterBlobs) await compact();
      } catch (error) {
        // Anything unsent stays unsent: the next change, or the next poll,
        // tries again from the same state vector.
        dirty = true;
        if (error instanceof StoreClientError && error.reason === 'offline') {
          say(
            'offline',
            'The workspace is unreachable. Your work is saved in this browser and goes up when it returns.',
          );
        } else if (error instanceof StoreClientError && error.reason === 'conflict') {
          // Someone appended between our fetch and our append. Their work
          // is not lost and neither is ours: pull and try again.
          say('saving', 'Catching up with another editor.');
          await pull().catch(() => {});
        } else {
          say('error', error instanceof Error ? error.message : String(error));
        }
      } finally {
        sending = null;
      }
    })();
    await sending;
  }

  /** Other people's updates, applied here. */
  async function pull(): Promise<void> {
    const { version: current, updates } = await client.updatesSince(docId, documentKey, version);
    for (const update of updates) {
      // The CRDT merges them; applying the same update twice is harmless,
      // which is what makes a missed response safe to retry.
      Y.applyUpdate(doc, update, WORKSPACE_ORIGIN);
      Y.applyUpdate(mirror, update, WORKSPACE_ORIGIN);
    }
    blobCount += updates.length;
    version = Math.max(version, current);
  }

  async function compact(): Promise<void> {
    // One blob holding the whole state, replacing the log. The document
    // keeps its identity and its version history; only storage shrinks.
    // Written from the mirror: only what the store has agreed to hold.
    const state = Y.encodeStateAsUpdate(mirror);
    version = await client.compactDocument(docId, documentKey, state, version);
    blobCount = 1;
  }

  return {
    async start() {
      say('starting');
      const { version: current, blobs } = await client.allUpdates(docId, documentKey);
      for (const blob of blobs) {
        if (blob.kind === 'update' || blob.kind === 'snapshot') {
          // A snapshot here is a compacted state, not a diagram file: both
          // are Yjs updates as far as merging is concerned.
          Y.applyUpdate(doc, blob.bytes, WORKSPACE_ORIGIN);
          Y.applyUpdate(mirror, blob.bytes, WORKSPACE_ORIGIN);
        }
      }
      version = current;
      blobCount = blobs.length;
      // Anything this browser already has that the store does not - work
      // done offline, or a document being added to the workspace - is now
      // a difference to send.
      dirty = true;
      doc.on('update', onLocalUpdate);
      poller = setInterval(() => {
        void pull().catch(() => {
          // A failed poll is not worth reporting: the next one, or the
          // next save, will say so if the store is really gone.
        });
      }, pollMs);
      say('saved');
    },

    async flush() {
      if (timer) clearTimeout(timer);
      await send();
    },

    flushOnExit() {
      if (stopped || !dirty) return;
      if (timer) clearTimeout(timer);
      const update = Y.encodeStateAsUpdate(doc, Y.encodeStateVector(mirror));
      if (update.length === 0) return;
      // Sealing is asynchronous, but short; the request it leads to is
      // marked keepalive so the browser finishes it after the page has
      // gone. Nothing is awaited here - an unloading page cannot wait.
      void client
        .appendUpdate(docId, documentKey, update, version, { keepalive: true })
        .then((next) => {
          version = next;
          Y.applyUpdate(mirror, update, WORKSPACE_ORIGIN);
          dirty = false;
        })
        .catch(() => {
          // Kept in this browser; the next visit sends it.
        });
    },

    stop() {
      stopped = true;
      mirror.destroy();
      if (timer) clearTimeout(timer);
      if (poller) clearInterval(poller);
      doc.off('update', onLocalUpdate);
    },

    version: () => version,
  };
}
