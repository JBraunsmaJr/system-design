import { useEffect, type RefObject } from 'react';

export interface UseDocumentSessionJoinOptions {
  /** The open document's live session, once it is known to be shared. */
  session: { room: string; key: string } | null;
  openDocId: string;
  signalingUrls: string[];
  activeSessionRef: RefObject<unknown>;
  autoJoinedRoomRef: RefObject<string | null>;
  startNewSession: (
    explicitKey?: string,
    explicitRoom?: string,
    options?: { autoJoined?: boolean },
  ) => Promise<void>;
  /**
   * Where a trusted store gives a document's relay tokens out with the
   * document: the provider is kept in the ref for the session code, which
   * was set up before the provider existed. The provider must be stable.
   */
  relayTokenRef?: RefObject<RelayTokenProvider | null>;
  relayTokenProvider?: RelayTokenProvider | null;
}

export type RelayTokenProvider = (room: string) => Promise<string | null | undefined>;

/**
 * Opening a workspace document joins its room. Everyone who may edit it is
 * given the same one - computed from the document's key on an encrypted
 * store, handed out by a trusted store - so no link changes hands, and the
 * session is what makes an edit legible: who is here, where their cursor
 * is, what they just changed (WS3).
 *
 * The document is saved to the workspace throughout, by its own sync - the
 * session is how people see each other, not how work is kept.
 *
 * Shared by both kinds of store. Taken out of useWorkspaceSession, where
 * it served the encrypted one alone.
 *
 * Performance contract (see src/app/README.md): this hook runs inside App's
 * render and returns nothing, so it adds no component, render or commit.
 */
export function useDocumentSessionJoin({
  session,
  openDocId,
  signalingUrls,
  activeSessionRef,
  autoJoinedRoomRef,
  startNewSession,
  relayTokenRef,
  relayTokenProvider = null,
}: UseDocumentSessionJoinOptions) {
  const room = session?.room ?? null;
  const key = session?.key ?? null;

  // Declared before the effect that joins, so the provider is in place by
  // the time a session it must authorize is started.
  useEffect(() => {
    if (!relayTokenRef) return;
    relayTokenRef.current = relayTokenProvider;
    return () => {
      relayTokenRef.current = null;
    };
  }, [relayTokenRef, relayTokenProvider]);

  useEffect(() => {
    if (!room || !key) return;
    // A deployment with no relay has no live sessions at all. The
    // document still saves to the workspace; people just do not see each
    // other, which is the behavior before any of this existed.
    if (signalingUrls.length === 0) return;
    // Someone in a session they chose - started, or joined by link - is
    // left in it.
    if (activeSessionRef.current || autoJoinedRoomRef.current === room) return;
    autoJoinedRoomRef.current = room;
    void startNewSession(key, room, { autoJoined: true });
  }, [room, key, signalingUrls, startNewSession, activeSessionRef, autoJoinedRoomRef]);

  // Leaving the document, or taking it out of the workspace, ends the
  // session it joined on its behalf.
  useEffect(() => {
    return () => {
      autoJoinedRoomRef.current = null;
    };
  }, [openDocId, autoJoinedRoomRef]);
}
