import type { RequirementStatus } from './requirementsTypes';
import type { EpicInferredSchedule } from './requirementsTypes';

export interface RequirementItemViewModel {
  id: string;
  typeId: string;
  typeLabel: string;
  title: string;
  body: string;
  categoryId?: string;
  categoryLabel?: string;
  sprintId?: string;
  sprintName?: string;
  assigneeId?: string;
  assigneeName?: string;
  points?: number;
  status?: RequirementStatus;
  linkedNodeIds?: string[];
  linkedNodeLabels?: string[];
  contextSnapshotBase64?: string;
  snapshotFraming?: {
    offsetX: number;
    offsetY: number;
    zoom: number;
  };
}

export interface SrdArchitectureComponent {
  id: string;
  name: string;
  type: string;
  description?: string;
  status?: string;
  tags?: string[];
  properties?: Record<string, string>;
  codeLanguage?: string;
  codeContent?: string;
  linkedRequirementIds?: string[];
}

export interface SrdArchitectureConnection {
  from: string;
  fromName?: string;
  to: string;
  toName?: string;
  label?: string;
  protocol?: string;
  edgeType?: string;
  direction?: 'forward' | 'reverse' | 'both';
}

export interface SrdDataContext {
  metadata: {
    title: string;
    description?: string;
    generatedAt: string;
    version: string;
    authors: Array<{ name: string; email?: string; role?: string }>;
    organization?: string;
  };
  branding: {
    logoUrl?: string;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    fontFamily: string;
  };
  headersAndFooters: {
    headerLeft?: string;
    headerRight?: string;
    footerLeft?: string;
    footerRight?: string;
    classificationBanner?: string;
  };
  architecture: {
    diagramImageBase64?: string;
    components: SrdArchitectureComponent[];
    connections: SrdArchitectureConnection[];
  };
  requirements: {
    categories: Array<{ id: string; label: string; color: string }>;
    itemsByCategory: Record<string, Array<RequirementItemViewModel>>;
    summaryStats: {
      total: number;
      completed: number;
      inProgress: number;
      totalPoints: number;
      completedPoints: number;
    };
  };
  traceability: Array<{
    sourceId: string;
    sourceTitle: string;
    relation: string;
    targetId: string;
    targetTitle: string;
  }>;
  roadmap: {
    milestones: Array<{
      id: string;
      title: string;
      targetDate?: string;
      status: string;
      type: string;
      description?: string;
      relatedItemIds?: string[];
    }>;
    sprints: Array<{
      id: string;
      piName: string;
      name: string;
      startDate: string;
      endDate: string;
      assignedItems: string[];
      totalPoints: number;
    }>;
    epicSchedules: Array<EpicInferredSchedule & { epicTitle?: string }>;
  };
}

export type SrdSectionId =
  | 'executive_summary'
  | 'architecture'
  | 'requirements'
  | 'traceability'
  | 'roadmap';

export interface SrdSectionConfig {
  id: SrdSectionId;
  title: string;
  enabled: boolean;
  order: number;
  customIntroText?: string;
}

export interface SrdTemplateTheme {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontFamily: string;
  tableDense: boolean;
  pageOrientation: 'portrait' | 'landscape';
}

export interface SrdTemplateHeadersAndFooters {
  headerLeft?: string;
  headerRight?: string;
  footerLeft?: string;
  footerRight?: string;
  classificationBanner?: string;
  showPageNumbers: boolean;
}

export interface SrdTemplateConfig {
  id: string;
  name: string;
  description?: string;
  requirementsLayout?: 'table' | 'list';
  includeComponentTable?: boolean;
  theme: SrdTemplateTheme;
  headersAndFooters: SrdTemplateHeadersAndFooters;
  sections: SrdSectionConfig[];
}
