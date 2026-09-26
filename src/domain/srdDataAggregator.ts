import type { Node, Edge } from '@xyflow/react';
import type {
  RequirementsDocument,
  RequirementItem,
  RequirementStatus,
} from './requirementsTypes';
import type { Milestone } from './milestones';
import type { ProgramIncrement } from './programIncrements';
import { computeSprintDateRanges } from './programIncrements';
import type { TeamDocument } from './teamTypes';
import { isItemWorkable } from './requirementsRegistry';
import { getAllEpicsWithInferredSchedule } from './epicScheduling';
import type {
  SrdArchitectureComponent,
  SrdArchitectureConnection,
  SrdDataContext,
  RequirementItemViewModel,
} from './srdTypes';

export interface AggregateSrdDataParams {
  title: string;
  nodes?: Array<Node<Record<string, unknown>>>;
  edges?: Array<Edge<Record<string, unknown>>>;
  doc: RequirementsDocument;
  milestones?: Milestone[];
  programIncrements?: ProgramIncrement[];
  teamDoc?: TeamDocument;
  diagramImageBase64?: string;
  metadataOverrides?: Partial<SrdDataContext['metadata']>;
  brandingOverrides?: Partial<SrdDataContext['branding']>;
  headersAndFootersOverrides?: Partial<SrdDataContext['headersAndFooters']>;
}

export function aggregateSrdData(params: AggregateSrdDataParams): SrdDataContext {
  const {
    title,
    nodes = [],
    edges = [],
    doc,
    milestones = [],
    programIncrements = [],
    teamDoc,
    diagramImageBase64,
    metadataOverrides,
    brandingOverrides,
    headersAndFootersOverrides,
  } = params;

  const docTitle = (metadataOverrides?.title || title || 'Solution Requirement Document').trim();
  const todayIso = new Date().toISOString().split('T')[0];

  // 1. Authors & Organization
  const authors = metadataOverrides?.authors ||
    (teamDoc && teamDoc.members && teamDoc.members.length > 0
      ? teamDoc.members.map((m) => ({
          name: m.name,
          role: m.role || 'Contributor',
        }))
      : [{ name: 'Architecture & Engineering Team', role: 'Author' }]);

  const organization = metadataOverrides?.organization || 'Engineering Organization';

  // 2. Metadata
  const metadata: SrdDataContext['metadata'] = {
    title: docTitle,
    description:
      metadataOverrides?.description ||
      'Official Solution Requirement Document (SRD) outlining system architecture, requirements specification, traceability, and execution roadmap.',
    generatedAt: metadataOverrides?.generatedAt || todayIso,
    version: metadataOverrides?.version || '1.0',
    authors,
    organization,
  };

  // 3. Branding
  const branding: SrdDataContext['branding'] = {
    logoUrl: brandingOverrides?.logoUrl,
    primaryColor: brandingOverrides?.primaryColor || '#1e3a8a',
    secondaryColor: brandingOverrides?.secondaryColor || '#475569',
    accentColor: brandingOverrides?.accentColor || '#2563eb',
    fontFamily: brandingOverrides?.fontFamily || 'Inter, system-ui, sans-serif',
  };

  // 4. Headers & Footers
  const headersAndFooters: SrdDataContext['headersAndFooters'] = {
    headerLeft: headersAndFootersOverrides?.headerLeft ?? `${docTitle} | SRD`,
    headerRight: headersAndFootersOverrides?.headerRight ?? `Version ${metadata.version}`,
    footerLeft: headersAndFootersOverrides?.footerLeft ?? `© ${organization}`,
    footerRight: headersAndFootersOverrides?.footerRight ?? 'Page {{pageNumber}} of {{totalPages}}',
    classificationBanner: headersAndFootersOverrides?.classificationBanner,
  };

  // 5. Architecture: Components & Connections
  const nodeMap = new Map<string, Node<Record<string, unknown>>>();
  const components: SrdArchitectureComponent[] = [];

  for (const node of nodes) {
    nodeMap.set(node.id, node);
    const data = (node.data || {}) as Record<string, unknown>;
    const name =
      (data.label as string) || (data.name as string) || (data.title as string) || node.id;
    const type = (data.nodeType as string) || node.type || 'component';
    const description = (data.description as string) || undefined;
    const status =
      (data.status as string) ||
      (data.properties && typeof data.properties === 'object'
        ? ((data.properties as Record<string, string>).status as string)
        : undefined);

    const tags = Array.isArray(data.tags) ? (data.tags as string[]) : undefined;
    const properties =
      data.properties && typeof data.properties === 'object'
        ? (data.properties as Record<string, string>)
        : undefined;

    const codeLanguage = (data.codeLanguage as string) || undefined;
    const codeContent = (data.codeContent as string) || undefined;
    const linkedRequirementIds = Array.isArray(data.linkedRequirementIds)
      ? (data.linkedRequirementIds as string[])
      : undefined;

    components.push({
      id: node.id,
      name,
      type,
      description,
      status,
      tags,
      properties,
      codeLanguage,
      codeContent,
      linkedRequirementIds,
    });
  }

  const connections: SrdArchitectureConnection[] = [];
  for (const edge of edges) {
    const fromNode = nodeMap.get(edge.source);
    const toNode = nodeMap.get(edge.target);
    const fromData = (fromNode?.data || {}) as Record<string, unknown>;
    const toData = (toNode?.data || {}) as Record<string, unknown>;

    const fromName = (fromData.label as string) || edge.source;
    const toName = (toData.label as string) || edge.target;

    const edgeData = (edge.data || {}) as Record<string, unknown>;
    const label = (edgeData.label as string) || (edge.label as string) || undefined;
    const protocol =
      (edgeData.properties && typeof edgeData.properties === 'object'
        ? ((edgeData.properties as Record<string, string>).protocol as string)
        : undefined) ||
      (edgeData.edgeType as string) ||
      undefined;

    connections.push({
      from: edge.source,
      fromName,
      to: edge.target,
      toName,
      label,
      protocol,
      edgeType: edgeData.edgeType as string | undefined,
      direction: edgeData.direction as 'forward' | 'reverse' | 'both' | undefined,
    });
  }

  const architecture: SrdDataContext['architecture'] = {
    diagramImageBase64,
    components,
    connections,
  };

  // 6. Lookups for Requirements normalization
  const typeMap = new Map<string, string>();
  for (const t of doc.itemTypes) {
    typeMap.set(t.id, t.label);
  }

  const categoryMap = new Map<string, { id: string; label: string; color: string }>();
  for (const c of doc.categories) {
    categoryMap.set(c.id, c);
  }

  const sprintMap = new Map<string, { id: string; name: string; piName: string }>();
  for (const pi of programIncrements) {
    for (const s of pi.sprints) {
      sprintMap.set(s.id, { id: s.id, name: s.name, piName: pi.name });
    }
  }

  const memberMap = new Map<string, string>();
  if (teamDoc?.members) {
    for (const m of teamDoc.members) {
      memberMap.set(m.id, m.name);
    }
  }

  // Map of requirement item ID to linked architectural nodes
  const reqToNodesMap = new Map<string, Array<{ id: string; label: string }>>();
  for (const comp of components) {
    if (comp.linkedRequirementIds) {
      for (const reqId of comp.linkedRequirementIds) {
        const list = reqToNodesMap.get(reqId) || [];
        list.push({ id: comp.id, label: comp.name });
        reqToNodesMap.set(reqId, list);
      }
    }
  }

  // 7. Requirements & Summary Stats
  let completed = 0;
  let inProgress = 0;
  let totalPoints = 0;
  let completedPoints = 0;

  const itemsByCategory: Record<string, RequirementItemViewModel[]> = {};
  for (const cat of doc.categories) {
    itemsByCategory[cat.id] = [];
  }
  itemsByCategory['uncategorized'] = [];

  for (const item of doc.items) {
    const workable = isItemWorkable(doc, item);
    const itemStatus: RequirementStatus | undefined = workable
      ? (item.status ?? 'todo')
      : undefined;

    if (workable) {
      if (itemStatus === 'done') {
        completed++;
      } else if (itemStatus === 'in-progress') {
        inProgress++;
      }
    }

    const points = typeof item.points === 'number' && !isNaN(item.points) ? item.points : 0;
    totalPoints += points;
    if (itemStatus === 'done') {
      completedPoints += points;
    }

    const typeLabel = typeMap.get(item.typeId) || item.typeId;
    const cat = item.categoryId ? categoryMap.get(item.categoryId) : undefined;
    const categoryLabel = cat ? cat.label : 'General / Uncategorized';

    const sprint = item.sprintId ? sprintMap.get(item.sprintId) : undefined;
    const assigneeName = item.assigneeId ? memberMap.get(item.assigneeId) : undefined;

    const linkedNodes = reqToNodesMap.get(item.id) || [];

    const vm: RequirementItemViewModel = {
      id: item.id,
      typeId: item.typeId,
      typeLabel,
      title: item.title,
      body: item.body || '',
      categoryId: item.categoryId,
      categoryLabel,
      sprintId: item.sprintId,
      sprintName: sprint?.name,
      assigneeId: item.assigneeId,
      assigneeName,
      points: item.points,
      status: itemStatus,
      linkedNodeIds: linkedNodes.map((n) => n.id),
      linkedNodeLabels: linkedNodes.map((n) => n.label),
    };

    const targetCatKey = item.categoryId && categoryMap.has(item.categoryId)
      ? item.categoryId
      : 'uncategorized';

    itemsByCategory[targetCatKey].push(vm);
  }

  const categories = [
    ...doc.categories,
    ...(itemsByCategory['uncategorized'].length > 0
      ? [{ id: 'uncategorized', label: 'General / Uncategorized', color: '#64748b' }]
      : []),
  ];

  const requirements: SrdDataContext['requirements'] = {
    categories,
    itemsByCategory,
    summaryStats: {
      total: doc.items.length,
      completed,
      inProgress,
      totalPoints,
      completedPoints,
    },
  };

  // 8. Traceability Matrix
  const traceability: SrdDataContext['traceability'] = [];
  const reqItemMap = new Map<string, RequirementItem>();
  for (const item of doc.items) {
    reqItemMap.set(item.id, item);
  }

  const relTypeMap = new Map<string, { label: string; inverseLabel: string }>();
  for (const rt of doc.relationshipTypes) {
    relTypeMap.set(rt.id, { label: rt.label, inverseLabel: rt.inverseLabel });
  }

  // Cross-requirement relationships
  for (const rel of doc.relationships) {
    const fromItem = reqItemMap.get(rel.fromItemId);
    const toItem = reqItemMap.get(rel.toItemId);
    const rt = relTypeMap.get(rel.typeId);

    traceability.push({
      sourceId: rel.fromItemId,
      sourceTitle: fromItem?.title ? `${fromItem.title}` : rel.fromItemId,
      relation: rt?.label || rel.typeId,
      targetId: rel.toItemId,
      targetTitle: toItem?.title ? `${toItem.title}` : rel.toItemId,
    });
  }

  // Cross-component to requirement links
  for (const comp of components) {
    if (comp.linkedRequirementIds) {
      for (const reqId of comp.linkedRequirementIds) {
        const reqItem = reqItemMap.get(reqId);
        traceability.push({
          sourceId: comp.id,
          sourceTitle: comp.name,
          relation: 'Implements / Satisfies',
          targetId: reqId,
          targetTitle: reqItem?.title ? `${reqItem.title}` : reqId,
        });
      }
    }
  }

  // 9. Roadmap: Milestones, Sprints, Epic Schedules
  const milestoneList = milestones.map((m) => ({
    id: m.id,
    title: m.name,
    targetDate: m.scheduledAt,
    status: m.type || 'milestone',
    type: m.type || 'milestone',
    description: m.description,
    relatedItemIds: m.relatedItemIds ?? m.relatedWorkableItemIds,
  }));

  const sprintsList: SrdDataContext['roadmap']['sprints'] = [];
  for (const pi of programIncrements) {
    const ranges = computeSprintDateRanges(pi);
    const rangeMap = new Map(ranges.map((r) => [r.sprintId, r]));

    for (const sprint of pi.sprints) {
      const range = rangeMap.get(sprint.id);
      const itemsInSprint = doc.items.filter((i) => i.sprintId === sprint.id);
      const sprintPoints = itemsInSprint.reduce(
        (sum, item) => sum + (typeof item.points === 'number' && !isNaN(item.points) ? item.points : 0),
        0,
      );

      sprintsList.push({
        id: sprint.id,
        piName: pi.name,
        name: sprint.name,
        startDate: range?.startDate || pi.startDate,
        endDate: range?.endDate || pi.startDate,
        assignedItems: itemsInSprint.map((i) => i.id),
        totalPoints: sprintPoints,
      });
    }
  }

  const allEpicSchedules = getAllEpicsWithInferredSchedule(doc, programIncrements, milestones);
  const epicSchedules = allEpicSchedules.map(({ epic, schedule }) => ({
    ...schedule,
    epicTitle: epic.title,
  }));

  const roadmap: SrdDataContext['roadmap'] = {
    milestones: milestoneList,
    sprints: sprintsList,
    epicSchedules,
  };

  return {
    metadata,
    branding,
    headersAndFooters,
    architecture,
    requirements,
    traceability,
    roadmap,
  };
}
