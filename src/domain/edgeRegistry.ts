import type { EdgeTypeDefinition } from "./types";

export const STYLE_GROUP_LABELS: Record<string, string> = {
  sync: "Synchronous",
  async: "Asynchronous",
  data: "Data layer",
  file: "File / bulk",
  generic: "Generic",
};

/** Starter traffic taxonomy - extend freely, same pattern as nodeRegistry. */
export const EDGE_TYPES: EdgeTypeDefinition[] = [
  { id: "http", styleGroup: "sync", label: "HTTP / REST", color: "#5B7CFA" },
  { id: "grpc", styleGroup: "sync", label: "gRPC", color: "#3454D1" },
  { id: "tcp", styleGroup: "sync", label: "TCP", color: "#0FA36B" },
  { id: "websocket", styleGroup: "sync", label: "WebSocket", color: "#0C8599" },

  { id: "webhook", styleGroup: "async", label: "Webhook", color: "#F2994A", dash: "6 4" },
  { id: "message-queue", styleGroup: "async", label: "Message Queue", color: "#D9822B", dash: "6 4" },
  { id: "event-stream", styleGroup: "async", label: "Event Stream", color: "#B5651D", dash: "6 4" },

  { id: "sql", styleGroup: "data", label: "SQL Connection", color: "#9061F9", dash: "2 3" },
  { id: "replication", styleGroup: "data", label: "Replication", color: "#7048E8", dash: "2 3" },

  { id: "file-transfer", styleGroup: "file", label: "File Transfer / SFTP", color: "#7C8598", dash: "8 3 2 3" },

  { id: "generic", styleGroup: "generic", label: "Generic / Other", color: "#98A2B3" },
];

export function getEdgeType(id: string): EdgeTypeDefinition {
  return EDGE_TYPES.find((e) => e.id === id) ?? EDGE_TYPES[EDGE_TYPES.length - 1];
}
