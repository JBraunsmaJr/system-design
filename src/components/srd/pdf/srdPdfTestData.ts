/**
 * A rich SRD document for the PDF tests: every section populated, items in
 * two categories with snapshots, pills, links and bodies. Shared so the
 * section, parity and visual tests all exercise the same document.
 */
import { DEFAULT_SRD_TEMPLATE } from '../../../domain/srd/srdTemplatePresets';
import type {
  RequirementItemViewModel,
  SrdDataContext,
  SrdTemplateConfig,
} from '../../../domain/srd/srdTypes';

/**
 * The placeholder for every diagram and snapshot: a 2x2 neutral gray, the
 * print palette's light ink. Fixed rather than captured, so reference images
 * test the PDF's layout alone; gray, so it never reads as a rendering fault.
 */
export const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGM4ffUhEDFAKABF0goFRG3BqgAAAABJRU5ErkJggg==';

export function item(
  n: number,
  overrides: Partial<RequirementItemViewModel> = {},
): RequirementItemViewModel {
  return {
    id: `REQ-${n}`,
    typeId: 'req',
    typeLabel: 'Requirement',
    // Unique markers: no title is a prefix of another or used elsewhere.
    title: `Requirement title ${n} end`,
    body: `Body of requirement ${n} with **bold** text.`,
    status: (['todo', 'in-progress', 'done'] as const)[n % 3],
    points: n,
    sprintName: `SPRINT-${n}-end`,
    assigneeName: `Owner ${n}`,
    linkedNodeIds: [`node-${n}`],
    linkedNodeLabels: [`Service ${n}`],
    contextSnapshotBase64: PNG,
    ...overrides,
  };
}

export function richData(counts = { components: 6, items: 8 }): SrdDataContext {
  const items = Array.from({ length: counts.items }, (_, i) => item(i + 1));
  return {
    metadata: {
      title: 'Payments Platform',
      description: 'Handles **card payments** and refunds.\n\n- Fraud checks\n- Settlement',
      generatedAt: '2026-10-01',
      version: '4.2.0',
      authors: [{ name: 'Dana Lee', role: 'Architect' }],
      organization: 'Acme Corp',
    },
    branding: {
      primaryColor: '#1e3a8a',
      secondaryColor: '#475569',
      accentColor: '#0ea5e9',
      fontFamily: 'Inter',
    },
    headersAndFooters: {},
    architecture: {
      diagramImageBase64: PNG,
      components: Array.from({ length: counts.components }, (_, i) => ({
        id: `c${i}`,
        name: `Component ${i}`,
        type: i % 2 ? 'service' : 'database',
        description: `Responsibility of component ${i}`,
        linkedRequirementIds: [`REQ-${i + 1}`],
      })),
      connections: [
        {
          from: 'c0',
          fromName: 'Component 0',
          to: 'c1',
          toName: 'Component 1',
          label: 'Reads ledger',
          protocol: 'gRPC',
        },
        { from: 'c1', to: 'c2', label: 'Publishes events', edgeType: 'async' },
      ],
    },
    requirements: {
      categories: [
        { id: 'sec', label: 'Security', color: '#10b981' },
        { id: 'perf', label: 'Performance', color: '#f59e0b' },
        { id: 'empty', label: 'Unused', color: '#000000' },
      ],
      itemsByCategory: {
        sec: items.slice(0, Math.ceil(items.length / 2)),
        perf: items.slice(Math.ceil(items.length / 2)),
      },
      summaryStats: {
        total: items.length,
        completed: 2,
        inProgress: 3,
        totalPoints: 36,
        completedPoints: 9,
      },
    },
    traceability: [
      {
        sourceId: 'REQ-1',
        sourceTitle: 'Login flow',
        relation: 'depends-on',
        targetId: 'REQ-2',
        targetTitle: 'Session store',
      },
    ],
    roadmap: {
      milestones: [
        {
          id: 'm1',
          title: 'Beta Launch',
          targetDate: '2026-12-01',
          status: 'planned',
          type: 'release',
          description: 'First customers',
        },
      ],
      sprints: [
        {
          id: 's1',
          piName: 'PI-7',
          name: 'Sprint 1',
          startDate: '2026-10-05',
          endDate: '2026-10-18',
          totalPoints: 21,
          assignedItems: ['REQ-1', 'REQ-2'],
        },
      ],
      epicSchedules: [],
    },
  };
}

export function config(overrides: Partial<SrdTemplateConfig> = {}): SrdTemplateConfig {
  const base = structuredClone(DEFAULT_SRD_TEMPLATE);
  return {
    ...base,
    includeComponentTable: true,
    includeConnectionsTable: true,
    sections: base.sections.map((s) => ({ ...s, enabled: true })),
    ...overrides,
  };
}
