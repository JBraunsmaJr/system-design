import { useEffect, type Dispatch, type SetStateAction } from 'react';
import * as Y from 'yjs';
import type { DiagramStore } from '../../collab/stores/diagramStore';
import { createDocumentStores } from '../../collab/sync/localDocument';
import { startCollabSession } from '../../collab/sync/session';
import type { SubDiagram } from '../../domain/canvas/types';
import { getStandardFixture, type FixtureName } from '../../perf/fixtures';
import type { ActiveCollabSession } from './useCollabSession';

export interface UsePerfHarnessBridgeOptions {
  diagramStore: DiagramStore;
  setPath: Dispatch<SetStateAction<string[]>>;
  setSelectedNodeIds: Dispatch<SetStateAction<string[]>>;
  setSelectedEdgeIds: Dispatch<SetStateAction<string[]>>;
  setActiveSession: Dispatch<SetStateAction<ActiveCollabSession | null>>;
  signalingUrls: string[];
  iceServers: RTCIceServer[] | undefined;
  leaveSession: () => void;
  activeDoc: Y.Doc;
}

/**
 * The perf harness's handles into the app (window.__PERF__). A no-op unless
 * the instrumented build installed __PERF__. Moved unchanged from App.tsx.
 */
export function usePerfHarnessBridge({
  diagramStore,
  setPath,
  setSelectedNodeIds,
  setSelectedEdgeIds,
  setActiveSession,
  signalingUrls,
  iceServers,
  leaveSession,
  activeDoc,
}: UsePerfHarnessBridgeOptions) {
  // Expose test harness helper hooks onto window.__PERF__ when active
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__PERF__) {
      const perfObj = (window as unknown as Record<string, unknown>).__PERF__ as Record<
        string,
        unknown
      >;
      perfObj.Y = Y;
      (window as unknown as Record<string, unknown>).Y = Y;
      /**
       * Through the seam, not through React state (WS1 Step 3).
       *
       * These are the highest-consequence writers in the app, because their
       * failure is silent: a fixture that does not load leaves an empty
       * canvas, and zero renders reads as a green IMPROVEMENT in the perf
       * gate rather than as a failure. Routing them through diagramStore now
       * means the later swap to a Y.Doc changes the implementation under
       * them rather than quietly bypassing them.
       */
      perfObj.loadFixture = (name: FixtureName) => {
        const fixture = getStandardFixture(name);
        diagramStore.replaceAll(fixture);
        return fixture;
      };
      perfObj.setDiagram = (diagram: SubDiagram) => {
        diagramStore.replaceAll(diagram);
      };
      /**
       * One node, through the seam. Needed to exercise two browsers
       * editing the same document at once: replaceAll would rewrite the
       * whole diagram and prove nothing about merging.
       */
      perfObj.addNode = (label: string) =>
        diagramStore.addNode(
          [],
          'typed',
          { x: Math.random() * 400, y: Math.random() * 400 },
          { nodeType: 'service', label, properties: {}, tags: [] },
        );
      perfObj.setPath = (newPath: string[]) => {
        setPath(newPath);
      };
      perfObj.setSelectedNodes = (nodeIds: string[]) => {
        setSelectedNodeIds(nodeIds);
      };
      perfObj.setSelectedEdges = (edgeIds: string[]) => {
        setSelectedEdgeIds(edgeIds);
      };
      perfObj.startCollabSessionWithDoc = (doc: Y.Doc) => {
        const roomName = `perf-room-${Math.random().toString(36).slice(2, 8)}`;
        const stores = createDocumentStores(doc);
        const session = startCollabSession(doc, roomName, {
          signalingUrls,
          iceServers,
          // The harness measures the editing path, not the storage layer.
          // Leaving persistence on also makes runs non-deterministic, since
          // each one would find whatever the previous one left in IndexedDB
          // under a room name that is random per run.
          persist: false,
        });
        setActiveSession({
          doc,
          session,
          roomName,
          stores,
          ownsDocument: true,
        });
      };
      perfObj.leaveCollabSession = () => {
        leaveSession();
      };
      // Encoded size of the document on screen - how WS4-R1 is checked
      // ("a drag adds no more than 1KB").
      perfObj.docBytes = () => Y.encodeStateAsUpdate(activeDoc).byteLength;
    }
    // The setters are listed because they now arrive as parameters; they are
    // React state setters, so listing them never re-runs this effect.
  }, [
    diagramStore,
    setPath,
    setSelectedNodeIds,
    setSelectedEdgeIds,
    setActiveSession,
    signalingUrls,
    iceServers,
    leaveSession,
    activeDoc,
  ]);
}
