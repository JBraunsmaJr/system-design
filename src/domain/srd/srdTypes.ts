import type { RequirementStatus } from '../requirements/requirementsTypes';
import type { EpicInferredSchedule } from '../requirements/requirementsTypes';

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
  'executive_summary' | 'architecture' | 'requirements' | 'traceability' | 'roadmap';

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

/**
 * Which template draws the document. Templates are code: each is registered
 * in components/srd/pdf/templates, and this union is that registry's key, so
 * an id without a template (or the reverse) does not compile. `classic` is
 * the look the SRD has always had, and the default.
 */
export type SrdTemplateId = 'classic' | 'engineering' | 'briefing';

/**
 * A named starting point: a template plus the settings to start it with.
 * Historically called a "template", which is why the type keeps that name and
 * why exported JSON files use this shape.
 */
export interface SrdTemplateConfig {
  id: string;
  name: string;
  description?: string;
  /** Absent in presets and files written before templates were code. */
  templateId?: SrdTemplateId;
  requirementsLayout?: 'table' | 'list';
  includeComponentTable?: boolean;
  includeConnectionsTable?: boolean;
  theme: SrdTemplateTheme;
  headersAndFooters: SrdTemplateHeadersAndFooters;
  sections: SrdSectionConfig[];
}

/**
 * Everything about how a document's SRD looks, apart from which template
 * draws it. Every field is required: a document always has a complete set,
 * filled from defaults where it has none of its own.
 */
export type SrdDocumentSettings = Required<
  Pick<
    SrdTemplateConfig,
    | 'requirementsLayout'
    | 'includeComponentTable'
    | 'includeConnectionsTable'
    | 'theme'
    | 'headersAndFooters'
    | 'sections'
  >
>;

/** How a requirement's context snapshot is framed. Only these parameters are
 * stored; every reader renders the image from them. */
export interface SrdSnapshotFraming {
  offsetX: number;
  offsetY: number;
  zoom: number;
  /** The snapshot was removed from the document. */
  hidden?: boolean;
}

/** Document metadata edited for the SRD, overriding what is derived from the
 * diagram. Absent fields fall back to the derived value. */
export type SrdMetadataOverrides = Partial<
  Pick<
    SrdDataContext['metadata'],
    'title' | 'description' | 'generatedAt' | 'version' | 'authors' | 'organization'
  >
>;

/** The SRD as stored in the document: shared by every collaborator, so
 * everyone sees and prints the same thing. */
export interface SrdDocumentState {
  templateId: SrdTemplateId;
  /** The preset last applied, or 'custom' once settings diverge from it. */
  presetId: string;
  settings: SrdDocumentSettings;
  metadata: SrdMetadataOverrides;
  /** Keyed by requirement item id. Absent means default framing. */
  framing: Record<string, SrdSnapshotFraming>;
  /**
   * A template id the document names that this build does not have - from a
   * newer version, say. The document draws with `templateId` (the default)
   * meanwhile; this is kept so it can be reported, and so saving the
   * document writes it back unchanged rather than losing the choice.
   */
  unsupportedTemplateId?: string;
}
