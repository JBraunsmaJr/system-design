import type { SrdSectionConfig, SrdTemplateConfig } from './srdTypes';

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
      customIntroText:
        'Granular workable items, story point estimates, and sprint assignments.',
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
      customIntroText:
        'Upstream and downstream blocker links across epics and tickets.',
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
      customIntroText:
        'Strategic project goals, core scope boundaries, and delivery outcomes.',
    },
    {
      id: 'architecture',
      title: 'System Architecture Overview',
      enabled: true,
      order: 2,
      customIntroText:
        'Visual architecture diagram and key component capabilities.',
    },
    {
      id: 'roadmap',
      title: 'Milestone Roadmap & Delivery Targets',
      enabled: true,
      order: 3,
      customIntroText:
        'Key delivery milestones, target dates, and progress tracking.',
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

export function parseTemplateConfig(jsonString: string): SrdTemplateConfig {
  const parsed = JSON.parse(jsonString);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid template JSON format: expected an object.');
  }
  if (!parsed.id || !parsed.name || !parsed.theme || !Array.isArray(parsed.sections)) {
    throw new Error('Invalid template schema: missing required fields.');
  }
  return parsed as SrdTemplateConfig;
}
