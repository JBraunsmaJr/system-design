import type { NodeCategory, NodeTypeDefinition } from "./types";

export const CATEGORY_LABELS: Record<NodeCategory, string> = {
  compute: "Compute",
  data: "Data",
  networking: "Networking / Edge",
  messaging: "Messaging",
  external: "External",
  observability: "Observability",
};

export const CATEGORY_COLORS: Record<NodeCategory, string> = {
  compute: "#5B7CFA",
  data: "#9061F9",
  networking: "#0FA36B",
  messaging: "#F2994A",
  external: "#F0578C",
  observability: "#7C8598",
};

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
];

export function getNodeType(id: string): NodeTypeDefinition | undefined {
  return NODE_TYPES.find((n) => n.id === id);
}
