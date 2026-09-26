import type { IconDefinition } from './iconRegistry';

export const CLOUD_ICONS: IconDefinition[] = [
  // ==========================================
  // AWS Icons
  // ==========================================
  {
    id: 'aws',
    name: 'AWS Cloud',
    category: 'Cloud',
    tags: ['aws', 'amazon', 'cloud', 'infrastructure', 'provider'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 16.5c-2.5 0-4-1.8-4-4.2 0-2.2 1.5-3.9 3.7-4.1C6.3 5.3 8.7 3 11.8 3c3.3 0 5.8 2.5 6 5.7 2.2.3 3.8 2 3.8 4.3 0 2.4-1.7 4-4.1 4" />
        <path d="M7 19.5c3 2 7 2 10 0" />
        <polyline points="15 18 17 19.5 15.5 21" />
      </svg>`,
    },
    attribution: { author: 'AWS', source: 'Amazon Web Services' },
  },
  {
    id: 'aws-ec2',
    name: 'AWS EC2',
    category: 'Cloud',
    tags: ['aws', 'amazon', 'ec2', 'compute', 'server', 'instance', 'vm', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <rect x="9" y="9" width="6" height="6" />
        <path d="M15 2v2" />
        <path d="M15 20v2" />
        <path d="M2 15h2" />
        <path d="M2 9h2" />
        <path d="M20 15h2" />
        <path d="M20 9h2" />
        <path d="M9 2v2" />
        <path d="M9 20v2" />
      </svg>`,
    },
    attribution: { author: 'AWS', source: 'Amazon Web Services' },
  },
  {
    id: 'aws-lambda',
    name: 'AWS Lambda',
    category: 'Cloud',
    tags: ['aws', 'amazon', 'lambda', 'serverless', 'function', 'compute', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 20l5.5-16h3.5" />
        <path d="M10 13l4.5 7h4.5" />
        <path d="M4 20h4" />
        <path d="M16 20h4" />
      </svg>`,
    },
    attribution: { author: 'AWS', source: 'Amazon Web Services' },
  },
  {
    id: 'aws-s3',
    name: 'AWS S3',
    category: 'Cloud',
    tags: ['aws', 'amazon', 's3', 'storage', 'bucket', 'object storage', 'blob', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 7l8-4 8 4v10l-8 4-8-4z" />
        <path d="M4 7l8 4 8-4" />
        <path d="M12 11v10" />
        <path d="M7 9.5v5" />
        <path d="M17 9.5v5" />
      </svg>`,
    },
    attribution: { author: 'AWS', source: 'Amazon Web Services' },
  },
  {
    id: 'aws-dynamodb',
    name: 'AWS DynamoDB',
    category: 'Cloud',
    tags: ['aws', 'amazon', 'dynamodb', 'database', 'nosql', 'key-value', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
        <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
        <path d="M10 9l4 6" />
        <path d="M14 9l-4 6" />
      </svg>`,
    },
    attribution: { author: 'AWS', source: 'Amazon Web Services' },
  },
  {
    id: 'aws-rds',
    name: 'AWS RDS',
    category: 'Cloud',
    tags: ['aws', 'amazon', 'rds', 'database', 'sql', 'relational', 'postgres', 'mysql', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <ellipse cx="12" cy="5" rx="7" ry="2.5" />
        <path d="M5 5v14c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5V5" />
        <path d="M5 12c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5" />
        <line x1="12" y1="7.5" x2="12" y2="14.5" />
      </svg>`,
    },
    attribution: { author: 'AWS', source: 'Amazon Web Services' },
  },
  {
    id: 'aws-aurora',
    name: 'AWS Aurora',
    category: 'Cloud',
    tags: ['aws', 'amazon', 'aurora', 'database', 'sql', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <ellipse cx="12" cy="6" rx="8" ry="3" />
        <path d="M4 6v8c0 1.66 3.58 3 8 3s8-1.34 8-3V6" />
        <path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
        <circle cx="12" cy="12" r="1.5" />
      </svg>`,
    },
    attribution: { author: 'AWS', source: 'Amazon Web Services' },
  },
  {
    id: 'aws-api-gateway',
    name: 'AWS API Gateway',
    category: 'Cloud',
    tags: ['aws', 'amazon', 'api gateway', 'api', 'gateway', 'rest', 'http', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 10h18" />
        <path d="M9 10v10" />
        <path d="M15 10v10" />
        <circle cx="6" cy="7" r="1" />
        <circle cx="12" cy="7" r="1" />
        <circle cx="18" cy="7" r="1" />
      </svg>`,
    },
    attribution: { author: 'AWS', source: 'Amazon Web Services' },
  },
  {
    id: 'aws-cloudfront',
    name: 'AWS CloudFront',
    category: 'Cloud',
    tags: ['aws', 'amazon', 'cloudfront', 'cdn', 'edge', 'cache', 'networking', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 3a14.5 14.5 0 0 1 0 18" />
        <path d="M12 3a14.5 14.5 0 0 0 0 18" />
        <polyline points="8 8 12 12 16 8" />
      </svg>`,
    },
    attribution: { author: 'AWS', source: 'Amazon Web Services' },
  },
  {
    id: 'aws-sqs',
    name: 'AWS SQS',
    category: 'Cloud',
    tags: ['aws', 'amazon', 'sqs', 'queue', 'messaging', 'async', 'message', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M7 12h10" />
        <path d="M13 8l4 4-4 4" />
        <path d="M7 9v6" />
      </svg>`,
    },
    attribution: { author: 'AWS', source: 'Amazon Web Services' },
  },
  {
    id: 'aws-sns',
    name: 'AWS SNS',
    category: 'Cloud',
    tags: ['aws', 'amazon', 'sns', 'notification', 'pubsub', 'topic', 'messaging', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        <circle cx="12" cy="3" r="1" />
      </svg>`,
    },
    attribution: { author: 'AWS', source: 'Amazon Web Services' },
  },
  {
    id: 'aws-ecs',
    name: 'AWS ECS',
    category: 'Cloud',
    tags: ['aws', 'amazon', 'ecs', 'container', 'docker', 'fargate', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2l9 5v10l-9 5-9-5V7l9-5z" />
        <path d="M12 12l9-5" />
        <path d="M12 12v10" />
        <path d="M12 12L3 7" />
        <circle cx="12" cy="7" r="1.5" />
      </svg>`,
    },
    attribution: { author: 'AWS', source: 'Amazon Web Services' },
  },
  {
    id: 'aws-eks',
    name: 'AWS EKS',
    category: 'Cloud',
    tags: ['aws', 'amazon', 'eks', 'kubernetes', 'k8s', 'container', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="12 2 21 7 21 17 12 22 3 17 3 7 12 2" />
        <circle cx="12" cy="12" r="3" />
        <line x1="12" y1="9" x2="12" y2="2" />
        <line x1="14.6" y1="13.5" x2="21" y2="17" />
        <line x1="9.4" y1="13.5" x2="3" y2="17" />
      </svg>`,
    },
    attribution: { author: 'AWS', source: 'Amazon Web Services' },
  },
  {
    id: 'aws-cloudwatch',
    name: 'AWS CloudWatch',
    category: 'Cloud',
    tags: [
      'aws',
      'amazon',
      'cloudwatch',
      'monitoring',
      'logs',
      'metrics',
      'observability',
      'cloud',
    ],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 3v18h18" />
        <path d="M7 14l4-4 4 4 5-6" />
        <circle cx="20" cy="8" r="1.5" />
      </svg>`,
    },
    attribution: { author: 'AWS', source: 'Amazon Web Services' },
  },
  {
    id: 'aws-iam',
    name: 'AWS IAM',
    category: 'Cloud',
    tags: ['aws', 'amazon', 'iam', 'identity', 'access', 'security', 'role', 'user', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <circle cx="12" cy="9" r="2.5" />
        <path d="M8.5 15a3.5 3.5 0 0 1 7 0" />
      </svg>`,
    },
    attribution: { author: 'AWS', source: 'Amazon Web Services' },
  },
  {
    id: 'aws-route53',
    name: 'AWS Route 53',
    category: 'Cloud',
    tags: ['aws', 'amazon', 'route53', 'dns', 'networking', 'domain', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a9 9 0 0 1 9 9" />
        <path d="M8 12h8" />
        <path d="M12 8l4 4-4 4" />
      </svg>`,
    },
    attribution: { author: 'AWS', source: 'Amazon Web Services' },
  },
  {
    id: 'aws-vpc',
    name: 'AWS VPC',
    category: 'Cloud',
    tags: ['aws', 'amazon', 'vpc', 'network', 'subnet', 'private cloud', 'networking', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <rect x="7" y="7" width="10" height="10" rx="1" stroke-dasharray="2 2" />
        <circle cx="12" cy="12" r="2" />
      </svg>`,
    },
    attribution: { author: 'AWS', source: 'Amazon Web Services' },
  },
  {
    id: 'aws-eventbridge',
    name: 'AWS EventBridge',
    category: 'Cloud',
    tags: ['aws', 'amazon', 'eventbridge', 'events', 'bus', 'routing', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="6" cy="6" r="3" />
        <circle cx="18" cy="6" r="3" />
        <circle cx="12" cy="18" r="3" />
        <line x1="8.5" y1="7.5" x2="10" y2="16" />
        <line x1="15.5" y1="7.5" x2="14" y2="16" />
        <line x1="9" y1="6" x2="15" y2="6" />
      </svg>`,
    },
    attribution: { author: 'AWS', source: 'Amazon Web Services' },
  },

  // ==========================================
  // Azure Icons
  // ==========================================
  {
    id: 'azure',
    name: 'Microsoft Azure',
    category: 'Cloud',
    tags: ['azure', 'microsoft', 'cloud', 'infrastructure', 'provider'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 19.5h8.5L7 4.5H3z" />
        <path d="M8.5 19.5L14.5 9l2.5 4.5L21 19.5z" />
      </svg>`,
    },
    attribution: { author: 'Microsoft', source: 'Microsoft Azure' },
  },
  {
    id: 'azure-vm',
    name: 'Azure Virtual Machine',
    category: 'Cloud',
    tags: ['azure', 'microsoft', 'vm', 'virtual machine', 'compute', 'server', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="14" rx="2" />
        <line x1="7" y1="21" x2="17" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
        <circle cx="12" cy="10" r="3" />
        <path d="M12 7v1" />
        <path d="M12 12v1" />
      </svg>`,
    },
    attribution: { author: 'Microsoft', source: 'Microsoft Azure' },
  },
  {
    id: 'azure-functions',
    name: 'Azure Functions',
    category: 'Cloud',
    tags: ['azure', 'microsoft', 'functions', 'serverless', 'function', 'compute', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>`,
    },
    attribution: { author: 'Microsoft', source: 'Microsoft Azure' },
  },
  {
    id: 'azure-app-service',
    name: 'Azure App Service',
    category: 'Cloud',
    tags: ['azure', 'microsoft', 'app service', 'web app', 'hosting', 'compute', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="2" y1="8" x2="22" y2="8" />
        <circle cx="6" cy="5.5" r="1" />
        <circle cx="10" cy="5.5" r="1" />
        <path d="M6 13l3 3 6-6" />
      </svg>`,
    },
    attribution: { author: 'Microsoft', source: 'Microsoft Azure' },
  },
  {
    id: 'azure-blob-storage',
    name: 'Azure Blob Storage',
    category: 'Cloud',
    tags: ['azure', 'microsoft', 'blob', 'storage', 'object storage', 'data', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
        <circle cx="12" cy="10" r="3" />
        <line x1="8" y1="17" x2="16" y2="17" />
      </svg>`,
    },
    attribution: { author: 'Microsoft', source: 'Microsoft Azure' },
  },
  {
    id: 'azure-cosmos-db',
    name: 'Azure Cosmos DB',
    category: 'Cloud',
    tags: ['azure', 'microsoft', 'cosmos', 'database', 'nosql', 'globally distributed', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(30 12 12)" />
        <circle cx="12" cy="12" r="2" />
      </svg>`,
    },
    attribution: { author: 'Microsoft', source: 'Microsoft Azure' },
  },
  {
    id: 'azure-sql',
    name: 'Azure SQL Database',
    category: 'Cloud',
    tags: ['azure', 'microsoft', 'sql', 'database', 'relational', 'data', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <ellipse cx="12" cy="5" rx="7" ry="2.5" />
        <path d="M5 5v14c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5V5" />
        <path d="M5 12c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5" />
        <rect x="9.5" y="8" width="5" height="4" rx="0.5" />
      </svg>`,
    },
    attribution: { author: 'Microsoft', source: 'Microsoft Azure' },
  },
  {
    id: 'azure-aks',
    name: 'Azure AKS',
    category: 'Cloud',
    tags: ['azure', 'microsoft', 'aks', 'kubernetes', 'k8s', 'container', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="12 2 20 6.5 20 15.5 12 20 4 15.5 4 6.5 12 2" />
        <circle cx="12" cy="11" r="3" />
        <line x1="12" y1="8" x2="12" y2="4" />
        <line x1="9.5" y1="12.5" x2="6" y2="15" />
        <line x1="14.5" y1="12.5" x2="18" y2="15" />
      </svg>`,
    },
    attribution: { author: 'Microsoft', source: 'Microsoft Azure' },
  },
  {
    id: 'azure-service-bus',
    name: 'Azure Service Bus',
    category: 'Cloud',
    tags: ['azure', 'microsoft', 'service bus', 'queue', 'topic', 'messaging', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <circle cx="7" cy="12" r="1.5" />
        <circle cx="12" cy="12" r="1.5" />
        <circle cx="17" cy="12" r="1.5" />
        <path d="M8.5 12h2" />
        <path d="M13.5 12h2" />
      </svg>`,
    },
    attribution: { author: 'Microsoft', source: 'Microsoft Azure' },
  },
  {
    id: 'azure-event-grid',
    name: 'Azure Event Grid',
    category: 'Cloud',
    tags: ['azure', 'microsoft', 'event grid', 'events', 'pubsub', 'messaging', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="4" />
        <circle cx="4" cy="4" r="2" />
        <circle cx="20" cy="4" r="2" />
        <circle cx="4" cy="20" r="2" />
        <circle cx="20" cy="20" r="2" />
        <line x1="5.5" y1="5.5" x2="9.5" y2="9.5" />
        <line x1="18.5" y1="5.5" x2="14.5" y2="9.5" />
        <line x1="5.5" y1="18.5" x2="9.5" y2="14.5" />
        <line x1="18.5" y1="18.5" x2="14.5" y2="14.5" />
      </svg>`,
    },
    attribution: { author: 'Microsoft', source: 'Microsoft Azure' },
  },
  {
    id: 'azure-api-management',
    name: 'Azure API Management',
    category: 'Cloud',
    tags: ['azure', 'microsoft', 'api', 'gateway', 'management', 'apim', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M8 8h8" />
        <path d="M8 12h8" />
        <path d="M8 16h5" />
        <circle cx="16" cy="16" r="1.5" />
      </svg>`,
    },
    attribution: { author: 'Microsoft', source: 'Microsoft Azure' },
  },
  {
    id: 'azure-key-vault',
    name: 'Azure Key Vault',
    category: 'Cloud',
    tags: ['azure', 'microsoft', 'key vault', 'security', 'secrets', 'keys', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5z" />
        <circle cx="12" cy="15" r="2" />
        <path d="M12 17v2" />
      </svg>`,
    },
    attribution: { author: 'Microsoft', source: 'Microsoft Azure' },
  },
  {
    id: 'azure-monitor',
    name: 'Azure Monitor',
    category: 'Cloud',
    tags: ['azure', 'microsoft', 'monitor', 'metrics', 'logs', 'observability', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
        <path d="M6 10l3 3 3-4 6 5" />
      </svg>`,
    },
    attribution: { author: 'Microsoft', source: 'Microsoft Azure' },
  },

  // ==========================================
  // GCP (Google Cloud Platform) Icons
  // ==========================================
  {
    id: 'gcp',
    name: 'Google Cloud Platform',
    category: 'Cloud',
    tags: ['gcp', 'google', 'google cloud', 'cloud', 'infrastructure', 'provider'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17.5 19H6.5A4.5 4.5 0 0 1 6.5 10c.3 0 .7.05 1 .1A6 6 0 0 1 18.5 11c1.8.4 3 2 3 4a4 4 0 0 1-4 4z" />
        <circle cx="12" cy="13" r="2" />
      </svg>`,
    },
    attribution: { author: 'Google', source: 'Google Cloud Platform' },
  },
  {
    id: 'gcp-compute-engine',
    name: 'Google Compute Engine',
    category: 'Cloud',
    tags: ['gcp', 'google', 'compute engine', 'gce', 'vm', 'server', 'compute', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="12 2 21 7 21 17 12 22 3 17 3 7 12 2" />
        <rect x="8" y="8" width="8" height="8" rx="1" />
        <circle cx="12" cy="12" r="1.5" />
      </svg>`,
    },
    attribution: { author: 'Google', source: 'Google Cloud Platform' },
  },
  {
    id: 'gcp-cloud-functions',
    name: 'Google Cloud Functions',
    category: 'Cloud',
    tags: ['gcp', 'google', 'cloud functions', 'serverless', 'function', 'compute', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 18l6-6-6-6" />
        <path d="M15 18h4" />
        <circle cx="6" cy="12" r="2" />
      </svg>`,
    },
    attribution: { author: 'Google', source: 'Google Cloud Platform' },
  },
  {
    id: 'gcp-cloud-run',
    name: 'Google Cloud Run',
    category: 'Cloud',
    tags: ['gcp', 'google', 'cloud run', 'container', 'serverless', 'compute', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 15l8-8 8 8" />
        <path d="M4 9l8-8 8 8" />
        <path d="M4 21h16" />
      </svg>`,
    },
    attribution: { author: 'Google', source: 'Google Cloud Platform' },
  },
  {
    id: 'gcp-gke',
    name: 'Google Kubernetes Engine',
    category: 'Cloud',
    tags: ['gcp', 'google', 'gke', 'kubernetes', 'k8s', 'container', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="12 2 21 7 21 17 12 22 3 17 3 7 12 2" />
        <circle cx="12" cy="12" r="2.5" />
        <path d="M12 4.5v5" />
        <path d="M5.5 15.5l4.5-2.5" />
        <path d="M18.5 15.5l-4.5-2.5" />
      </svg>`,
    },
    attribution: { author: 'Google', source: 'Google Cloud Platform' },
  },
  {
    id: 'gcp-cloud-storage',
    name: 'Google Cloud Storage',
    category: 'Cloud',
    tags: ['gcp', 'google', 'gcs', 'cloud storage', 'bucket', 'object storage', 'blob', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="6" rx="2" />
        <rect x="3" y="14" width="18" height="6" rx="2" />
        <circle cx="7" cy="7" r="1" />
        <circle cx="7" cy="17" r="1" />
        <path d="M12 10v4" />
      </svg>`,
    },
    attribution: { author: 'Google', source: 'Google Cloud Platform' },
  },
  {
    id: 'gcp-firestore',
    name: 'Google Cloud Firestore',
    category: 'Cloud',
    tags: ['gcp', 'google', 'firestore', 'datastore', 'database', 'nosql', 'document', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="12 2 20 8 16 22 8 22 4 8 12 2" />
        <line x1="12" y1="2" x2="12" y2="22" />
        <line x1="4" y1="8" x2="20" y2="8" />
      </svg>`,
    },
    attribution: { author: 'Google', source: 'Google Cloud Platform' },
  },
  {
    id: 'gcp-cloud-sql',
    name: 'Google Cloud SQL',
    category: 'Cloud',
    tags: [
      'gcp',
      'google',
      'cloud sql',
      'database',
      'sql',
      'mysql',
      'postgres',
      'relational',
      'cloud',
    ],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <ellipse cx="12" cy="6" rx="7" ry="3" />
        <path d="M5 6v12c0 1.66 3.13 3 7 3s7-1.34 7-3V6" />
        <path d="M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3" />
        <circle cx="12" cy="12" r="1.5" />
      </svg>`,
    },
    attribution: { author: 'Google', source: 'Google Cloud Platform' },
  },
  {
    id: 'gcp-pubsub',
    name: 'Google Cloud Pub/Sub',
    category: 'Cloud',
    tags: ['gcp', 'google', 'pubsub', 'messaging', 'queue', 'events', 'topic', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3" />
        <circle cx="12" cy="4" r="2" />
        <circle cx="20" cy="16" r="2" />
        <circle cx="4" cy="16" r="2" />
        <line x1="12" y1="6" x2="12" y2="9" />
        <line x1="18.5" y1="14.5" x2="14.5" y2="13" />
        <line x1="5.5" y1="14.5" x2="9.5" y2="13" />
      </svg>`,
    },
    attribution: { author: 'Google', source: 'Google Cloud Platform' },
  },
  {
    id: 'gcp-bigquery',
    name: 'Google BigQuery',
    category: 'Cloud',
    tags: ['gcp', 'google', 'bigquery', 'data warehouse', 'analytics', 'sql', 'big data', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="7" />
        <line x1="16" y1="16" x2="21" y2="21" />
        <rect x="8" y="9" width="6" height="4" rx="0.5" />
      </svg>`,
    },
    attribution: { author: 'Google', source: 'Google Cloud Platform' },
  },
  {
    id: 'gcp-cloud-load-balancing',
    name: 'Google Cloud Load Balancing',
    category: 'Cloud',
    tags: ['gcp', 'google', 'load balancing', 'networking', 'proxy', 'traffic', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="3" width="6" height="4" rx="1" />
        <rect x="3" y="17" width="6" height="4" rx="1" />
        <rect x="15" y="17" width="6" height="4" rx="1" />
        <path d="M12 7v5" />
        <path d="M6 14h12" />
        <path d="M6 14v3" />
        <path d="M18 14v3" />
      </svg>`,
    },
    attribution: { author: 'Google', source: 'Google Cloud Platform' },
  },
  {
    id: 'gcp-cloud-armor',
    name: 'Google Cloud Armor',
    category: 'Cloud',
    tags: ['gcp', 'google', 'cloud armor', 'security', 'waf', 'ddos', 'firewall', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <line x1="12" y1="8" x2="12" y2="14" />
        <circle cx="12" cy="17" r="1" />
      </svg>`,
    },
    attribution: { author: 'Google', source: 'Google Cloud Platform' },
  },
  {
    id: 'gcp-cloud-monitoring',
    name: 'Google Cloud Monitoring',
    category: 'Cloud',
    tags: ['gcp', 'google', 'monitoring', 'observability', 'metrics', 'stackdriver', 'cloud'],
    version: 1,
    source: {
      type: 'svg',
      data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>`,
    },
    attribution: { author: 'Google', source: 'Google Cloud Platform' },
  },
];
