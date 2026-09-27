import type { SrdSectionConfig, SrdSectionId, SrdTemplateConfig } from './srdTypes';

export const DEFAULT_SRD_SECTIONS: SrdSectionConfig[] = [
  {
    id: 'executive_summary',
    title: 'Executive Summary',
    enabled: true,
    order: 1,
    customIntroText:
      'This Solution Requirement Document specifies the architectural design, functional capabilities, and delivery schedule for the solution.',
  },
  {
    id: 'architecture',
    title: 'Architecture & System Design',
    enabled: true,
    order: 2,
    customIntroText:
      'The system architecture breakdown details high-level topology, component roles, and interaction protocols.',
  },
  {
    id: 'requirements',
    title: 'Requirements Specification',
    enabled: true,
    order: 3,
    customIntroText:
      'Structured functional requirements, business goals, and technical constraints categorized by domain area.',
  },
  {
    id: 'traceability',
    title: 'Traceability & Relationship Matrix',
    enabled: true,
    order: 4,
    customIntroText:
      'Cross-cutting traceability graph mapping dependencies between requirements and architectural components.',
  },
  {
    id: 'roadmap',
    title: 'Delivery Roadmap & Program Increments',
    enabled: true,
    order: 5,
    customIntroText:
      'Execution schedule, milestone target dates, sprint allocations, and inferred epic timelines.',
  },
];

export const ENTERPRISE_FORMAL_TEMPLATE: SrdTemplateConfig = {
  id: 'enterprise_formal',
  name: 'Enterprise Formal',
  description:
    'Full formal specification with classification banner, comprehensive traceability matrix, and revision details.',
  requirementsLayout: 'table',
  includeComponentTable: false,
  includeConnectionsTable: false,
  theme: {
    primaryColor: '#1e3a8a',
    secondaryColor: '#475569',
    accentColor: '#2563eb',
    fontFamily: 'Inter, system-ui, sans-serif',
    tableDense: false,
    pageOrientation: 'portrait',
  },
  headersAndFooters: {
    classificationBanner: 'CONFIDENTIAL — INTERNAL USE ONLY',
    headerLeft: '{{metadata.title}}',
    headerRight: 'Doc Ver: {{metadata.version}}',
    footerLeft: '© {{metadata.organization}}',
    footerRight: 'Page {{pageNumber}} of {{totalPages}}',
    showPageNumbers: true,
  },
  sections: [
    {
      id: 'executive_summary',
      title: '1. Executive Summary',
      enabled: true,
      order: 1,
      customIntroText:
        'This Solution Requirement Document specifies the business objectives, architecture, requirements, and delivery milestones.',
    },
    {
      id: 'architecture',
      title: '2. System Architecture & High-Level Design',
      enabled: true,
      order: 2,
      customIntroText:
        'The architecture breakdown provides an inventory of system services, databases, external dependencies, and network connections.',
    },
    {
      id: 'requirements',
      title: '3. Requirements & Constraints Specification',
      enabled: true,
      order: 3,
      customIntroText:
        'Categorized functional requirements, constraints, and work items with status and story point allocations.',
    },
    {
      id: 'traceability',
      title: '4. Traceability & Dependency Matrix',
      enabled: true,
      order: 4,
      customIntroText:
        'Dependency mappings linking requirements to architectural components and cross-item blocking relationships.',
    },
    {
      id: 'roadmap',
      title: '5. Delivery Roadmap & Program Increments',
      enabled: true,
      order: 5,
      customIntroText:
        'Execution milestones, sprint delivery schedules, and inferred epic completion timelines.',
    },
  ],
};

export const AGILE_ENGINEERING_TEMPLATE: SrdTemplateConfig = {
  id: 'agile_engineering',
  name: 'Agile Engineering',
  description:
    'Engineering-focused brief prioritizing component interfaces, story points, sprint backlog allocations, and dependencies.',
  requirementsLayout: 'list',
  includeComponentTable: false,
  includeConnectionsTable: false,
  theme: {
    primaryColor: '#0f766e',
    secondaryColor: '#334155',
    accentColor: '#0d9488',
    fontFamily: 'Inter, system-ui, sans-serif',
    tableDense: true,
    pageOrientation: 'portrait',
  },
  headersAndFooters: {
    classificationBanner: 'ENGINEERING SPECIFICATION',
    headerLeft: '{{metadata.title}} | Agile Architecture',
    headerRight: 'Generated: {{metadata.generatedAt}}',
    footerLeft: '© {{metadata.organization}}',
    footerRight: 'Page {{pageNumber}} of {{totalPages}}',
    showPageNumbers: true,
  },
  sections: [
    {
      id: 'architecture',
      title: 'System Architecture & Services',
      enabled: true,
      order: 1,
      customIntroText:
        'Component topologies, protocols, and data stores powering the implementation.',
    },
    {
      id: 'requirements',
      title: 'Work Items & Backlog Requirements',
      enabled: true,
      order: 2,
      customIntroText: 'Granular workable items, story point estimates, and sprint assignments.',
    },
    {
      id: 'roadmap',
      title: 'Sprint Allocations & Milestones',
      enabled: true,
      order: 3,
      customIntroText:
        'Planned program increments, active sprint allocations, and milestone targets.',
    },
    {
      id: 'traceability',
      title: 'Blocking & Dependency Matrix',
      enabled: true,
      order: 4,
      customIntroText: 'Upstream and downstream blocker links across epics and tickets.',
    },
    {
      id: 'executive_summary',
      title: 'Executive Summary',
      enabled: false,
      order: 5,
    },
  ],
};

export const EXECUTIVE_SUMMARY_TEMPLATE: SrdTemplateConfig = {
  id: 'executive_summary',
  name: 'Executive Summary',
  description:
    'High-level overview designed for executive stakeholders with diagrams, business goals, and milestone projections.',
  requirementsLayout: 'list',
  includeComponentTable: false,
  includeConnectionsTable: false,
  theme: {
    primaryColor: '#4c1d95',
    secondaryColor: '#475569',
    accentColor: '#7c3aed',
    fontFamily: 'Inter, system-ui, sans-serif',
    tableDense: false,
    pageOrientation: 'portrait',
  },
  headersAndFooters: {
    classificationBanner: 'EXECUTIVE BRIEFING',
    headerLeft: '{{metadata.title}} | Executive Briefing',
    headerRight: 'Status: In Review',
    footerLeft: '© {{metadata.organization}} | Strategic Overview',
    footerRight: 'Page {{pageNumber}} of {{totalPages}}',
    showPageNumbers: true,
  },
  sections: [
    {
      id: 'executive_summary',
      title: 'Executive Summary & Vision',
      enabled: true,
      order: 1,
      customIntroText: 'Strategic project goals, core scope boundaries, and delivery outcomes.',
    },
    {
      id: 'architecture',
      title: 'System Architecture Overview',
      enabled: true,
      order: 2,
      customIntroText: 'Visual architecture diagram and key component capabilities.',
    },
    {
      id: 'roadmap',
      title: 'Milestone Roadmap & Delivery Targets',
      enabled: true,
      order: 3,
      customIntroText: 'Key delivery milestones, target dates, and progress tracking.',
    },
    {
      id: 'requirements',
      title: 'Detailed Requirements Breakdown',
      enabled: false,
      order: 4,
    },
    {
      id: 'traceability',
      title: 'Detailed Dependency Matrix',
      enabled: false,
      order: 5,
    },
  ],
};

export const BUILTIN_SRD_TEMPLATES: SrdTemplateConfig[] = [
  ENTERPRISE_FORMAL_TEMPLATE,
  AGILE_ENGINEERING_TEMPLATE,
  EXECUTIVE_SUMMARY_TEMPLATE,
];

export const DEFAULT_SRD_TEMPLATE = ENTERPRISE_FORMAL_TEMPLATE;

export function cloneTemplateConfig(template: SrdTemplateConfig): SrdTemplateConfig {
  return JSON.parse(JSON.stringify(template));
}

export function serializeTemplateConfig(template: SrdTemplateConfig): string {
  return JSON.stringify(template, null, 2);
}

const VALID_SECTION_IDS: ReadonlySet<SrdSectionId> = new Set<SrdSectionId>([
  'executive_summary',
  'architecture',
  'requirements',
  'traceability',
  'roadmap',
]);

// Values that end up in CSS custom properties must be tightly constrained so an
// imported template cannot inject arbitrary declarations.
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const FONT_FAMILY_PATTERN = /^[A-Za-z0-9 ,'"_.-]+$/;
const MAX_FONT_FAMILY_LENGTH = 200;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertOptionalType(
  obj: Record<string, unknown>,
  key: string,
  type: 'string' | 'boolean',
  context: string,
): void {
  if (obj[key] !== undefined && typeof obj[key] !== type) {
    throw new Error(`Invalid template schema: ${context}.${key} must be a ${type}.`);
  }
}

function validateTheme(theme: unknown): void {
  if (!isPlainObject(theme)) {
    throw new Error('Invalid template schema: theme must be an object.');
  }
  for (const key of ['primaryColor', 'secondaryColor', 'accentColor'] as const) {
    const value = theme[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !HEX_COLOR_PATTERN.test(value)) {
      throw new Error(`Invalid template schema: theme.${key} must be a hex color (e.g. #1e3a8a).`);
    }
  }
  if (theme.fontFamily !== undefined) {
    const font = theme.fontFamily;
    if (
      typeof font !== 'string' ||
      font.trim().length === 0 ||
      font.length > MAX_FONT_FAMILY_LENGTH ||
      !FONT_FAMILY_PATTERN.test(font)
    ) {
      throw new Error('Invalid template schema: theme.fontFamily contains unsupported characters.');
    }
  }
  assertOptionalType(theme, 'tableDense', 'boolean', 'theme');
  if (
    theme.pageOrientation !== undefined &&
    theme.pageOrientation !== 'portrait' &&
    theme.pageOrientation !== 'landscape'
  ) {
    throw new Error(
      "Invalid template schema: theme.pageOrientation must be 'portrait' or 'landscape'.",
    );
  }
}

function validateHeadersAndFooters(value: unknown): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    throw new Error('Invalid template schema: headersAndFooters must be an object.');
  }
  for (const key of [
    'headerLeft',
    'headerRight',
    'footerLeft',
    'footerRight',
    'classificationBanner',
  ]) {
    assertOptionalType(value, key, 'string', 'headersAndFooters');
  }
  assertOptionalType(value, 'showPageNumbers', 'boolean', 'headersAndFooters');
}

function validateSections(sections: unknown[]): void {
  const seen = new Set<string>();
  sections.forEach((section, index) => {
    const context = `sections[${index}]`;
    if (!isPlainObject(section)) {
      throw new Error(`Invalid template schema: ${context} must be an object.`);
    }
    if (typeof section.id !== 'string' || !VALID_SECTION_IDS.has(section.id as SrdSectionId)) {
      throw new Error(`Invalid template schema: ${context}.id is not a known section id.`);
    }
    if (seen.has(section.id)) {
      throw new Error(`Invalid template schema: duplicate section id '${section.id}'.`);
    }
    seen.add(section.id);
    if (typeof section.title !== 'string') {
      throw new Error(`Invalid template schema: ${context}.title must be a string.`);
    }
    // enabled/order may be absent in older templates (filled in by
    // mergeTemplateWithDefaults), but must have the right type when present.
    assertOptionalType(section, 'enabled', 'boolean', context);
    if (
      section.order !== undefined &&
      (typeof section.order !== 'number' || !Number.isFinite(section.order))
    ) {
      throw new Error(`Invalid template schema: ${context}.order must be a finite number.`);
    }
    assertOptionalType(section, 'customIntroText', 'string', context);
  });
}

export function parseTemplateConfig(jsonString: string): SrdTemplateConfig {
  const parsed: unknown = JSON.parse(jsonString);
  if (!isPlainObject(parsed)) {
    throw new Error('Invalid template JSON format: expected an object.');
  }
  if (
    typeof parsed.id !== 'string' ||
    !parsed.id ||
    typeof parsed.name !== 'string' ||
    !parsed.name ||
    !parsed.theme ||
    !Array.isArray(parsed.sections)
  ) {
    throw new Error('Invalid template schema: missing required fields.');
  }
  assertOptionalType(parsed, 'description', 'string', 'template');
  assertOptionalType(parsed, 'includeComponentTable', 'boolean', 'template');
  assertOptionalType(parsed, 'includeConnectionsTable', 'boolean', 'template');
  if (
    parsed.requirementsLayout !== undefined &&
    parsed.requirementsLayout !== 'table' &&
    parsed.requirementsLayout !== 'list'
  ) {
    throw new Error("Invalid template schema: requirementsLayout must be 'table' or 'list'.");
  }
  validateTheme(parsed.theme);
  validateHeadersAndFooters(parsed.headersAndFooters);
  validateSections(parsed.sections);
  return parsed as unknown as SrdTemplateConfig;
}

/**
 * Fills in anything an older or partial template omits, using the given base
 * template (defaults to DEFAULT_SRD_TEMPLATE). Nested theme and
 * headersAndFooters are merged field-by-field, and every section is guaranteed
 * a boolean `enabled` and a finite `order`.
 */
export function mergeTemplateWithDefaults(
  imported: SrdTemplateConfig,
  base: SrdTemplateConfig = DEFAULT_SRD_TEMPLATE,
): SrdTemplateConfig {
  const defaults = cloneTemplateConfig(base);
  const defaultSectionsById = new Map(defaults.sections.map((s) => [s.id, s]));
  const importedSections = Array.isArray(imported.sections) ? imported.sections : [];

  const sections: SrdSectionConfig[] = importedSections.map((section, index) => {
    const fallback = defaultSectionsById.get(section.id);
    return {
      ...fallback,
      ...section,
      enabled: typeof section.enabled === 'boolean' ? section.enabled : (fallback?.enabled ?? true),
      order:
        typeof section.order === 'number' && Number.isFinite(section.order)
          ? section.order
          : (fallback?.order ?? index + 1),
    };
  });

  return {
    ...defaults,
    ...imported,
    theme: { ...defaults.theme, ...(imported.theme ?? {}) },
    headersAndFooters: { ...defaults.headersAndFooters, ...(imported.headersAndFooters ?? {}) },
    sections: sections.length > 0 ? sections : defaults.sections,
  };
}
