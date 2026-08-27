import type { NodeCategory, NodeTypeDefinition } from "./types";

export const CATEGORY_LABELS: Record<NodeCategory, string> = {
  compute: "Compute",
  data: "Data",
  networking: "Networking / Edge",
  messaging: "Messaging",
  external: "External",
  observability: "Observability",
  logic: "Logic / Flow",
  vcs: "Version Control",
  custom: "Custom",
};

export const CATEGORY_COLORS: Record<NodeCategory, string> = {
  compute: "#5B7CFA",
  data: "#9061F9",
  networking: "#0FA36B",
  messaging: "#F2994A",
  external: "#F0578C",
  observability: "#7C8598",
  logic: "#22B8CF",
  vcs: "#C2255C",
  custom: "#98A2B3",
};

/** Display order for the "logic" category's subcategory groupings in the Code palette tab. */
export const LOGIC_SUBCATEGORY_ORDER = [
  "Entry / Exit",
  "Flow Control",
  "Data & Persistence",
  "Integration & Messaging",
  "Security",
  "Error Handling",
  "Annotations",
];

/** Display order for the "vcs" category's subcategory groupings in the Git palette tab. */
export const VCS_SUBCATEGORY_ORDER = ["Branching & History", "Review & Release", "CI/CD Pipeline"];

/**
 * Starter taxonomy. This is intentionally a subset of the full SDD taxonomy -
 * add more entries here (or load them from a JSON config at runtime later)
 * as the editor grows. Nothing else in the app needs to change to support
 * a new type; components look everything up from this list.
 */
export const NODE_TYPES: NodeTypeDefinition[] = [
  { id: "client", category: "compute", label: "Client", icon: "Smartphone", color: CATEGORY_COLORS.compute },
  { id: "microservice", category: "compute", label: "Microservice", icon: "Server", color: CATEGORY_COLORS.compute },
  { id: "monolith", category: "compute", label: "Monolith", icon: "Boxes", color: CATEGORY_COLORS.compute },
  { id: "serverless", category: "compute", label: "Serverless Function", icon: "Zap", color: CATEGORY_COLORS.compute },
  { id: "worker", category: "compute", label: "Background Worker", icon: "Cog", color: CATEGORY_COLORS.compute },

  { id: "database", category: "data", label: "Relational Database", icon: "Database", color: CATEGORY_COLORS.data },
  { id: "nosql", category: "data", label: "NoSQL Database", icon: "Layers", color: CATEGORY_COLORS.data },
  { id: "cache", category: "data", label: "Cache", icon: "Gauge", color: CATEGORY_COLORS.data },
  { id: "object-storage", category: "data", label: "Object Storage", icon: "HardDrive", color: CATEGORY_COLORS.data },
  { id: "search-index", category: "data", label: "Search Index", icon: "Search", color: CATEGORY_COLORS.data },

  { id: "api-gateway", category: "networking", label: "API Gateway", icon: "Network", color: CATEGORY_COLORS.networking },
  { id: "load-balancer", category: "networking", label: "Load Balancer", icon: "Waypoints", color: CATEGORY_COLORS.networking },
  { id: "cdn", category: "networking", label: "CDN", icon: "Globe", color: CATEGORY_COLORS.networking },
  { id: "reverse-proxy", category: "networking", label: "Reverse Proxy", icon: "Shuffle", color: CATEGORY_COLORS.networking },

  { id: "message-queue", category: "messaging", label: "Message Queue", icon: "ListOrdered", color: CATEGORY_COLORS.messaging },
  { id: "event-stream", category: "messaging", label: "Event Stream", icon: "Radio", color: CATEGORY_COLORS.messaging },
  { id: "webhook-receiver", category: "messaging", label: "Webhook Receiver", icon: "Webhook", color: CATEGORY_COLORS.messaging },

  { id: "external-api", category: "external", label: "External API / SaaS", icon: "Share2", color: CATEGORY_COLORS.external },
  { id: "identity-provider", category: "external", label: "Identity Provider", icon: "KeyRound", color: CATEGORY_COLORS.external },
  { id: "payment-processor", category: "external", label: "Payment Processor", icon: "CreditCard", color: CATEGORY_COLORS.external },

  { id: "monitoring", category: "observability", label: "Monitoring", icon: "Activity", color: CATEGORY_COLORS.observability },
  { id: "logging", category: "observability", label: "Logging", icon: "FileText", color: CATEGORY_COLORS.observability },

  // "Code mode" - modeling pseudo-code/request-handling logic rather than
  // system topology. Meant to be used inside a node's sub-diagram (e.g.
  // drilling into a microservice to lay out what happens for an incoming
  // request), but nothing stops using them at the top level too.
  // `subcategory` only affects how the Code palette groups these - it's
  // still one flat "logic" category for color/matching purposes.

  // Entry / Exit
  {
    id: "endpoint",
    category: "logic",
    subcategory: "Entry / Exit",
    label: "Endpoint",
    icon: "Route",
    color: CATEGORY_COLORS.logic,
    defaultProperties: { method: "POST", path: "/resource" },
  },
  {
    id: "return",
    category: "logic",
    subcategory: "Entry / Exit",
    label: "Return",
    icon: "CornerUpLeft",
    color: CATEGORY_COLORS.logic,
    defaultProperties: { status: "200" },
  },

  // Flow Control
  { id: "step", category: "logic", subcategory: "Flow Control", label: "Step", icon: "ArrowRightCircle", color: CATEGORY_COLORS.logic },
  {
    id: "decision",
    category: "logic",
    subcategory: "Flow Control",
    label: "Decision",
    icon: "GitFork",
    color: CATEGORY_COLORS.logic,
    defaultProperties: { condition: "isValid?" },
  },
  {
    id: "switch",
    category: "logic",
    subcategory: "Flow Control",
    label: "Switch / Case",
    icon: "ListTree",
    color: CATEGORY_COLORS.logic,
    defaultProperties: { on: "value" },
  },
  {
    id: "loop",
    category: "logic",
    subcategory: "Flow Control",
    label: "Loop",
    icon: "Repeat",
    color: CATEGORY_COLORS.logic,
    defaultProperties: { iterate: "each item" },
  },
  { id: "parallel", category: "logic", subcategory: "Flow Control", label: "Parallel", icon: "SplitSquareHorizontal", color: CATEGORY_COLORS.logic },
  { id: "join", category: "logic", subcategory: "Flow Control", label: "Join / Wait", icon: "Merge", color: CATEGORY_COLORS.logic },

  // Data & Persistence
  { id: "validate", category: "logic", subcategory: "Data & Persistence", label: "Validate", icon: "CheckCircle2", color: CATEGORY_COLORS.logic },
  {
    id: "query",
    category: "logic",
    subcategory: "Data & Persistence",
    label: "Query",
    icon: "FileSearch",
    color: CATEGORY_COLORS.logic,
    defaultProperties: { source: "table_or_index" },
  },
  {
    id: "persist",
    category: "logic",
    subcategory: "Data & Persistence",
    label: "Persist",
    icon: "Save",
    color: CATEGORY_COLORS.logic,
    defaultProperties: { target: "table_or_index" },
  },
  {
    id: "cache-check",
    category: "logic",
    subcategory: "Data & Persistence",
    label: "Cache Check",
    icon: "Gauge",
    color: CATEGORY_COLORS.logic,
    defaultProperties: { key: "cache:key" },
  },

  // Integration & Messaging
  {
    id: "external-call",
    category: "logic",
    subcategory: "Integration & Messaging",
    label: "External Call",
    icon: "ArrowUpRight",
    color: CATEGORY_COLORS.logic,
    defaultProperties: { target: "service.method()" },
  },
  {
    id: "publish-event",
    category: "logic",
    subcategory: "Integration & Messaging",
    label: "Publish Event",
    icon: "Radio",
    color: CATEGORY_COLORS.logic,
    defaultProperties: { event: "EventName" },
  },
  {
    id: "enqueue-job",
    category: "logic",
    subcategory: "Integration & Messaging",
    label: "Enqueue Job",
    icon: "ListPlus",
    color: CATEGORY_COLORS.logic,
    defaultProperties: { job: "JobName" },
  },

  // Security
  { id: "authenticate", category: "logic", subcategory: "Security", label: "Authenticate", icon: "Fingerprint", color: CATEGORY_COLORS.logic },
  {
    id: "authorize",
    category: "logic",
    subcategory: "Security",
    label: "Authorize",
    icon: "Lock",
    color: CATEGORY_COLORS.logic,
    defaultProperties: { permission: "resource:action" },
  },

  // Error Handling
  { id: "try-catch", category: "logic", subcategory: "Error Handling", label: "Try / Catch", icon: "ShieldAlert", color: CATEGORY_COLORS.logic },
  {
    id: "throw-error",
    category: "logic",
    subcategory: "Error Handling",
    label: "Throw Error",
    icon: "OctagonAlert",
    color: CATEGORY_COLORS.logic,
    defaultProperties: { status: "400", message: "Bad Request" },
  },

  // Annotations
  { id: "note", category: "logic", subcategory: "Annotations", label: "Note", icon: "StickyNote", color: CATEGORY_COLORS.logic },

  // "Git mode" - branching/merge/release workflow, not runtime topology or
  // request-handling logic. Useful for diagramming a branching strategy
  // (git-flow, trunk-based, etc.) or a release/CI pipeline alongside it.

  // Branching & History
  { id: "branch", category: "vcs", subcategory: "Branching & History", label: "Branch", icon: "GitBranch", color: CATEGORY_COLORS.vcs, defaultProperties: { name: "feature/name" } },
  { id: "fork", category: "vcs", subcategory: "Branching & History", label: "Fork", icon: "GitFork", color: CATEGORY_COLORS.vcs },
  { id: "commit", category: "vcs", subcategory: "Branching & History", label: "Commit", icon: "CircleDot", color: CATEGORY_COLORS.vcs, defaultProperties: { message: "commit message" } },
  { id: "merge", category: "vcs", subcategory: "Branching & History", label: "Merge", icon: "GitMerge", color: CATEGORY_COLORS.vcs },
  { id: "rebase", category: "vcs", subcategory: "Branching & History", label: "Rebase", icon: "GitCompareArrows", color: CATEGORY_COLORS.vcs },
  { id: "cherry-pick", category: "vcs", subcategory: "Branching & History", label: "Cherry Pick", icon: "Cherry", color: CATEGORY_COLORS.vcs },

  // Review & Release
  { id: "pull-request", category: "vcs", subcategory: "Review & Release", label: "Pull Request", icon: "GitPullRequest", color: CATEGORY_COLORS.vcs, defaultProperties: { status: "open" } },
  { id: "code-review", category: "vcs", subcategory: "Review & Release", label: "Code Review", icon: "MessagesSquare", color: CATEGORY_COLORS.vcs },
  { id: "tag", category: "vcs", subcategory: "Review & Release", label: "Tag / Release", icon: "Tag", color: CATEGORY_COLORS.vcs, defaultProperties: { version: "v1.0.0" } },
  { id: "changelog", category: "vcs", subcategory: "Review & Release", label: "Changelog", icon: "ScrollText", color: CATEGORY_COLORS.vcs },

  // CI/CD Pipeline
  { id: "build", category: "vcs", subcategory: "CI/CD Pipeline", label: "Build", icon: "Hammer", color: CATEGORY_COLORS.vcs },
  { id: "ci-test", category: "vcs", subcategory: "CI/CD Pipeline", label: "Test / CI Check", icon: "FlaskConical", color: CATEGORY_COLORS.vcs },
  { id: "deploy", category: "vcs", subcategory: "CI/CD Pipeline", label: "Deploy", icon: "Rocket", color: CATEGORY_COLORS.vcs, defaultProperties: { environment: "staging" } },
  { id: "environment", category: "vcs", subcategory: "CI/CD Pipeline", label: "Environment", icon: "Cloud", color: CATEGORY_COLORS.vcs, defaultProperties: { name: "production" } },
  { id: "feature-flag", category: "vcs", subcategory: "CI/CD Pipeline", label: "Feature Flag", icon: "ToggleLeft", color: CATEGORY_COLORS.vcs, defaultProperties: { flag: "flag-name" } },
  { id: "canary-release", category: "vcs", subcategory: "CI/CD Pipeline", label: "Canary Release", icon: "Bird", color: CATEGORY_COLORS.vcs, defaultProperties: { traffic: "5%" } },
  { id: "rollback", category: "vcs", subcategory: "CI/CD Pipeline", label: "Rollback", icon: "Undo2", color: CATEGORY_COLORS.vcs },

  // Fully generic node - fills in for anything the built-in taxonomy
  // doesn't cover. Its icon/color/label/description are entirely up to
  // whoever creates it (see the Icon and Color fields in Inspector.tsx);
  // this entry just supplies the starting defaults. Shown in its own
  // always-visible palette section, not gated behind System/Code/Git.
  { id: "custom", category: "custom", label: "Custom", icon: "Box", color: CATEGORY_COLORS.custom },
];

export function getNodeType(id: string): NodeTypeDefinition | undefined {
  return NODE_TYPES.find((n) => n.id === id);
}
