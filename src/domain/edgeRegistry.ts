import type { EdgeTypeDefinition } from "./types";

export const STYLE_GROUP_LABELS: Record<string, string> = {
  sync: "Synchronous",
  async: "Asynchronous",
  data: "Data layer",
  file: "File / bulk",
  control: "Control flow",
  vcs: "Version control",
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

  // Code mode - pairs with the "logic" node category (Endpoint, Step,
  // Decision, etc.) for laying out pseudo-code / request-handling flow.
  { id: "next", styleGroup: "control", label: "Next", color: "#22B8CF" },
  { id: "true", styleGroup: "control", label: "True", color: "#40C057" },
  { id: "false", styleGroup: "control", label: "False", color: "#E03131" },
  { id: "on-error", styleGroup: "control", label: "On Error", color: "#E8590C", dash: "4 3" },
  { id: "loop-back", styleGroup: "control", label: "Loop Back", color: "#22B8CF", dash: "2 4" },

  // Git mode - pairs with the "vcs" node category (Branch, Merge, Tag, etc.)
  { id: "branches-from", styleGroup: "vcs", label: "Branches From", color: "#C2255C" },
  { id: "merges-into", styleGroup: "vcs", label: "Merges Into", color: "#A61E4D" },
  { id: "cherry-picked", styleGroup: "vcs", label: "Cherry-Picked", color: "#C2255C", dash: "4 3" },
  { id: "tags", styleGroup: "vcs", label: "Tags", color: "#C2255C", dash: "1 3" },
  { id: "deploys-to", styleGroup: "vcs", label: "Deploys To", color: "#C2255C", dash: "6 3" },

  { id: "generic", styleGroup: "generic", label: "Generic / Other", color: "#98A2B3" },
];

export function getEdgeType(id: string): EdgeTypeDefinition {
  return EDGE_TYPES.find((e) => e.id === id) ?? EDGE_TYPES[EDGE_TYPES.length - 1];
}
