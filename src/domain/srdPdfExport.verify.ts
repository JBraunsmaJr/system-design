/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/srdPdfExport.verify.ts
 */
import { buildSrdPdf } from './srdPdfExport';
import { DEFAULT_SRD_TEMPLATE, BUILTIN_SRD_TEMPLATES } from './srdTemplatePresets';
import type { SrdDataContext, SrdTemplateConfig } from './srdTypes';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

const mockSrdData: SrdDataContext = {
  metadata: {
    title: 'Enterprise Architecture Specification',
    description: 'Detailed system specification for distributed cloud backend.',
    generatedAt: '2026-09-27',
    version: '2.4.0',
    authors: [
      { name: 'Alex Rivera', role: 'Principal Architect' },
      { name: 'Taylor Chen', role: 'Staff Systems Engineer' },
    ],
    organization: 'Acme Cloud Corp',
  },
  branding: {
    primaryColor: '#0f766e',
    secondaryColor: '#334155',
    accentColor: '#06b6d4',
    fontFamily: 'Inter',
  },
  headersAndFooters: {
    classificationBanner: 'RESTRICTED — INTERNAL ENGINEERING ONLY',
    headerLeft: '{{metadata.title}}',
    headerRight: 'Doc Ver: {{metadata.version}}',
    footerLeft: '© {{metadata.organization}}',
    footerRight: 'Page {{pageNumber}} of {{totalPages}}',
  },
  architecture: {
    diagramImageBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    components: [
      {
        id: 'comp-gw',
        name: 'API Gateway',
        type: 'Reverse Proxy',
        description: 'TLS termination and routing gateway',
        linkedRequirementIds: ['REQ-001', 'REQ-002'],
      },
      {
        id: 'comp-db',
        name: 'Primary PostgreSQL Cluster',
        type: 'Database',
        description: 'Multi-AZ relational database cluster',
        linkedRequirementIds: ['REQ-003'],
      },
    ],
    connections: [
      {
        from: 'comp-gw',
        fromName: 'API Gateway',
        to: 'comp-db',
        toName: 'PostgreSQL Cluster',
        label: 'gRPC / TLS',
        protocol: 'gRPC',
      },
    ],
  },
  requirements: {
    categories: [
      { id: 'cat-sec', label: 'Security & Auth', color: '#dc2626' },
      { id: 'cat-core', label: 'Core Capabilities', color: '#2563eb' },
    ],
    itemsByCategory: {
      'cat-sec': [
        {
          id: 'REQ-001',
          typeId: 'security',
          typeLabel: 'Security',
          title: 'Mutual TLS Authentication',
          body: 'All inter-service traffic must enforce mTLS using short-lived X.509 certs.',
          status: 'done',
          points: 8,
          assigneeName: 'Alex Rivera',
          linkedNodeLabels: ['API Gateway', 'Auth Service'],
        },
      ],
      'cat-core': [
        {
          id: 'REQ-002',
          typeId: 'feature',
          typeLabel: 'Feature',
          title: 'High-Throughput Ingestion Queue',
          body: 'Must handle 100,000 sustained write requests per second with sub-50ms latency.',
          status: 'in-progress',
          points: 13,
          sprintName: 'Sprint 4',
          assigneeName: 'Taylor Chen',
          linkedNodeLabels: ['Ingestion Service'],
        },
      ],
    },
    summaryStats: {
      total: 2,
      completed: 1,
      inProgress: 1,
      totalPoints: 21,
      completedPoints: 8,
    },
  },
  traceability: [
    {
      sourceId: 'REQ-001',
      sourceTitle: 'Mutual TLS Authentication',
      relation: 'implemented-by',
      targetId: 'comp-gw',
      targetTitle: 'API Gateway',
    },
  ],
  roadmap: {
    milestones: [
      {
        id: 'm-1',
        title: 'Alpha Deployment',
        targetDate: '2026-11-15',
        status: 'in_progress',
        type: 'Release',
        description: 'Initial staging verification',
      },
    ],
    sprints: [
      {
        id: 'sp-1',
        piName: 'PI-2026-Q4',
        name: 'Sprint 4',
        startDate: '2026-10-05',
        endDate: '2026-10-18',
        totalPoints: 21,
        assignedItems: ['REQ-001', 'REQ-002'],
      },
    ],
    epicSchedules: [],
  },
};

async function runTests() {
  // Test 1: Build PDF with default table layout
  {
    const doc = await buildSrdPdf(mockSrdData, DEFAULT_SRD_TEMPLATE);
    assert(doc != null, 'buildSrdPdf returns a valid jsPDF document instance');
    const pageCount = doc.getNumberOfPages();
    assert(pageCount >= 1, `PDF generated with ${pageCount} pages`);
  }

  // Test 2: Build PDF with list card layout
  {
    const listTemplate: SrdTemplateConfig = {
      ...DEFAULT_SRD_TEMPLATE,
      requirementsLayout: 'list',
    };
    const doc = await buildSrdPdf(mockSrdData, listTemplate);
    const pageCount = doc.getNumberOfPages();
    assert(pageCount >= 1, `List layout PDF generated with ${pageCount} pages`);
  }

  // Test 3: Build PDF with all builtin template profiles
  {
    for (const preset of BUILTIN_SRD_TEMPLATES) {
      const doc = await buildSrdPdf(mockSrdData, preset);
      assert(doc.getNumberOfPages() >= 1, `Builtin template "${preset.name}" generated successfully`);
    }
  }

  // Test 4: Build PDF with landscape orientation
  {
    const landscapeTemplate: SrdTemplateConfig = {
      ...DEFAULT_SRD_TEMPLATE,
      theme: {
        ...DEFAULT_SRD_TEMPLATE.theme,
        pageOrientation: 'landscape',
      },
    };
    const doc = await buildSrdPdf(mockSrdData, landscapeTemplate);
    const w = doc.internal.pageSize.getWidth();
    const h = doc.internal.pageSize.getHeight();
    assert(w > h, `Landscape orientation produces width (${w}) > height (${h})`);
  }

  // Test 5: Build PDF with large diagram and long description to verify safe pagination
  {
    const largeDocData: SrdDataContext = {
      ...mockSrdData,
      metadata: {
        ...mockSrdData.metadata,
        description: 'A'.repeat(800), // Pushes content near the bottom of Page 1
      },
    };
    const doc = await buildSrdPdf(largeDocData, DEFAULT_SRD_TEMPLATE);
    const pageCount = doc.getNumberOfPages();
    assert(pageCount >= 2, `Multi-page document with large diagram generated ${pageCount} pages safely`);
  }

  console.log(failures === 0 ? '\nALL PDF EXPORT TESTS PASSED' : `\n${failures} FAILURE(S)`);
  if (failures > 0) throw new Error(`${failures} test(s) failed`);
}

runTests();
