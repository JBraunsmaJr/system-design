import {type parseDiagramFile, toDiagramFile} from '../domain/canvas/serialization';
import type {Scenario, SubDiagram} from '../domain/canvas/types';
import {EMPTY_REQUIREMENTS_DOCUMENT, type RequirementsDocument,} from '../domain/requirements/requirementsTypes';
import {
  BUILT_IN_ITEM_TYPES,
  BUILT_IN_RELATIONSHIP_TYPES,
  withMissingBuiltInRelationshipTypes,
  withMissingBuiltInTypes,
} from '../domain/requirements/requirementsRegistry';
import type {ProgramIncrement} from '../domain/timeline/programIncrements';
import {EMPTY_TEAM_DOCUMENT, type TeamDocument} from '../domain/timeline/teamTypes';
import type {Milestone} from '../domain/timeline/milestones';
import {expandSrdFileValue} from '../domain/srd/srdSettings';
import type {SrdDocumentState} from '../domain/srd/srdTypes';

/*
 * Moved unchanged from App.tsx. Pure functions and constants: nothing here
 * runs during render except through the lazy initializers that already
 * called it once.
 */

export const EMPTY_DIAGRAM: SubDiagram = { nodes: [], edges: [] };

/** A document's content as plain values - the shape a file or autosave is
 * normalized into before it seeds a Y.Doc. Not live state: the Y.Doc is. */
export interface DiagramSnapshot {
  title: string;
  root: SubDiagram;
  scenarios: Scenario[];
  requirements: RequirementsDocument;
  programIncrements: ProgramIncrement[];
  team: TeamDocument;
  milestones: Milestone[];
  /** Absent for files from before the SRD was document content, and for a
   * new document; both read as the defaults. Carried through so opening a
   * file or restoring an autosave keeps the file's SRD. */
  srd?: SrdDocumentState;
}

/**
 * Converts a raw parsed DiagramFile (from a loaded .json file OR a
 * restored localStorage autosave - both go through parseDiagramFile, so
 * both land here) into a normalized DiagramSnapshot ready to become app
 * state. Shared by onFileSelected and the autosave-restore lazy
 * initializer specifically so the two paths can't drift out of sync with
 * each other over time.
 */
export function diagramFileToSnapshot(file: ReturnType<typeof parseDiagramFile>): DiagramSnapshot {
  // Diagrams saved before cross-diagram scenarios existed won't have a
  // `path` on their steps at all - default those to root so old files
  // keep working rather than crashing on a missing field.
  const normalizedScenarios = file.scenarios.map((sc) => ({
    ...sc,
    steps: sc.steps.map((st) => ({ ...st, path: st.path ?? [] })),
  }));
  // Similarly, files saved before requirements existed at all need the
  // built-in types populated from scratch, or "Add item" / "Add
  // relationship" would have nothing to offer - and separately, a file
  // saved after requirements existed but before some LATER built-in type
  // was added (e.g. before "Ticket") needs that one specific type merged
  // in, without disturbing anything else already saved.
  const finalRequirements = {
    ...file.requirements,
    itemTypes: withMissingBuiltInTypes(file.requirements.itemTypes),
    relationshipTypes: withMissingBuiltInRelationshipTypes(file.requirements.relationshipTypes),
  };
  return {
    title: file.title,
    root: { nodes: file.nodes, edges: file.edges },
    scenarios: normalizedScenarios,
    requirements: finalRequirements,
    programIncrements: file.programIncrements,
    team: file.team ?? EMPTY_TEAM_DOCUMENT,
    milestones: file.milestones ?? [],
    srd: file.srd === undefined ? undefined : expandSrdFileValue(file.srd),
  };
}

export const DEFAULT_SNAPSHOT: DiagramSnapshot = {
  title: 'Untitled Diagram',
  root: EMPTY_DIAGRAM,
  scenarios: [],
  requirements: {
    ...EMPTY_REQUIREMENTS_DOCUMENT,
    itemTypes: BUILT_IN_ITEM_TYPES,
    relationshipTypes: BUILT_IN_RELATIONSHIP_TYPES,
  },
  programIncrements: [],
  team: EMPTY_TEAM_DOCUMENT,
  milestones: [],
};

/** The inverse of diagramFileToSnapshot, for whole-document writes that start
 * from a snapshot rather than a parsed file (New). */
export function snapshotToDiagramFile(snapshot: DiagramSnapshot) {
  return toDiagramFile(
    snapshot.title,
    snapshot.root.nodes,
    snapshot.root.edges,
    snapshot.scenarios,
    snapshot.requirements,
    snapshot.programIncrements,
    snapshot.team,
    snapshot.milestones,
    snapshot.srd,
  );
}
