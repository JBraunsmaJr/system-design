import { useEffect, useMemo, useState } from 'react';
import type { Node } from '@xyflow/react';
import { getBreadcrumbLabelsFlat } from '../../collab/stores/diagramStore';
import type { PresenceInfo } from '../../collab/sync/session';
import type { DiagramPath } from '../../domain/canvas/subDiagramTree';
import type { ArchNodeData } from '../../domain/canvas/types';

export interface UseDiagramSelectionOptions {
  activeSession: object | null;
  /** Must be stable - App's is a useCallback with no deps. */
  broadcastPresence: (patch: Partial<PresenceInfo>) => void;
  diagramSnapshot: { nodes: Node<ArchNodeData>[] };
}

/**
 * Which diagram level is showing and what is selected on it, shared with
 * peers. Moved unchanged from App.tsx.
 *
 * The setters returned are React state setters, so their identity never
 * changes; hooks that receive them list them in their dependencies without
 * any cost.
 *
 * Performance contract (see src/app/README.md): this hook runs inside App's
 * render, so it adds no component, no render and no commit. Every value it
 * returns is either React state, a ref, or memoised with the same
 * dependencies it had in App.tsx. Callers destructure the result and depend
 * on the individual members - never on the returned object, which is new on
 * every render.
 */
export function useDiagramSelection({
  activeSession,
  broadcastPresence,
  diagramSnapshot,
}: UseDiagramSelectionOptions) {
  const [path, setPath] = useState<DiagramPath>([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);

  // Rebroadcasts this peer's own diagram path whenever it changes, so
  // peers viewing a DIFFERENT sub-diagram level correctly know not to
  // render this person's cursor - see broadcastPresence's own cursor
  // handling and Canvas's peer-cursor filtering for the other half of
  // this fix.
  useEffect(() => {
    if (!activeSession) return;
    broadcastPresence({ diagramPath: path.join('/') });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession, path]);

  const breadcrumbLabels = useMemo(
    () => getBreadcrumbLabelsFlat(diagramSnapshot.nodes, path),
    [diagramSnapshot, path],
  );

  // Rebroadcasts this peer's own selection whenever it changes, so
  // everyone else's "someone else has this selected" indicator (see
  // Canvas's peerSelections prop) stays current. A no-op when no
  // session is active - broadcastPresence itself already guards on
  // activeSessionRef, this dependency just avoids scheduling pointless
  // work while purely-local editing changes selection constantly.
  useEffect(() => {
    if (!activeSession) return;
    broadcastPresence({ selectedNodeIds, selectedEdgeIds });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession, selectedNodeIds, selectedEdgeIds]);

  return {
    path,
    setPath,
    selectedNodeIds,
    setSelectedNodeIds,
    selectedEdgeIds,
    setSelectedEdgeIds,
    breadcrumbLabels,
  };
}
