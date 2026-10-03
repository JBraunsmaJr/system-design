import { useDeferredValue, useMemo } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { ArchEdgeData, ArchNodeData } from '../../domain/canvas/types';
import type { RequirementsDocument } from '../../domain/requirements/requirementsTypes';
import type { ProgramIncrement } from '../../domain/timeline/programIncrements';
import type { TeamDocument } from '../../domain/timeline/teamTypes';
import type { Milestone } from '../../domain/timeline/milestones';
import { aggregateSrdData } from '../../domain/srd/srdDataAggregator';
import { SRD_DIAGRAM_FRAMING_KEY, applyDocumentState } from '../../domain/srd/srdSettings';
import type {
  SrdDataContext,
  SrdDocumentState,
  SrdSnapshotFraming,
} from '../../domain/srd/srdTypes';
import type { SrdSnapshotImage } from './capture/useSrdSnapshots';

export interface UseSrdDocumentDataOptions {
  title: string;
  diagramSnapshot: { nodes: Node<ArchNodeData>[]; edges: Edge<ArchEdgeData>[] };
  requirementsSnapshot: RequirementsDocument;
  milestonesSnapshot: Milestone[];
  programIncrementsSnapshot: ProgramIncrement[];
  teamSnapshot: TeamDocument;
  srd: Pick<SrdDocumentState, 'metadata' | 'framing'>;
  images: ReadonlyMap<string, SrdSnapshotImage>;
}

/**
 * The SRD's content, derived live from the document (Phase 1b).
 *
 * It used to be gathered once, when the modal opened, so it went stale as
 * soon as anyone edited the document - and two people could be looking at
 * the "same" SRD gathered at different moments. Now every document change
 * flows through; inputs are deferred so a burst of edits elsewhere never
 * blocks typing in the SRD's own fields.
 */
export function useSrdDocumentData({
  title,
  diagramSnapshot,
  requirementsSnapshot,
  milestonesSnapshot,
  programIncrementsSnapshot,
  teamSnapshot,
  srd,
  images,
}: UseSrdDocumentDataOptions): SrdDataContext {
  const diagram = useDeferredValue(diagramSnapshot);
  const requirements = useDeferredValue(requirementsSnapshot);
  const milestones = useDeferredValue(milestonesSnapshot);
  const programIncrements = useDeferredValue(programIncrementsSnapshot);
  const team = useDeferredValue(teamSnapshot);

  const aggregated = useMemo(() => {
    const itemSnapshots: Record<string, string> = {};
    const itemFramings: Record<string, SrdSnapshotFraming> = {};
    for (const [key, image] of images) {
      if (key === SRD_DIAGRAM_FRAMING_KEY) continue;
      itemSnapshots[key] = image.dataUrl;
      itemFramings[key] = image.framing;
    }
    return aggregateSrdData({
      title,
      nodes: diagram.nodes,
      edges: diagram.edges,
      doc: requirements,
      milestones,
      programIncrements,
      teamDoc: team,
      diagramImageBase64: images.get(SRD_DIAGRAM_FRAMING_KEY)?.dataUrl,
      itemSnapshots,
      itemFramings,
    });
  }, [title, diagram, requirements, milestones, programIncrements, team, images]);

  const { metadata, framing } = srd;
  return useMemo(
    () => applyDocumentState(aggregated, { metadata, framing }),
    [aggregated, metadata, framing],
  );
}
