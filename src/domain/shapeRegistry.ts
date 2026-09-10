export interface ShapeStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  opacity?: number;
  rx?: number;
  ry?: number;
}

export interface ShapeConstraints {
  keepAspectRatio?: boolean;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  aspectRatio?: number;
}

export interface ConnectionPoint {
  id: string;
  x: number; // Normalized 0..1
  y: number; // Normalized 0..1
  direction?: "top" | "right" | "bottom" | "left" | string;
  priority?: number;
}

export interface ShapePropertyDefinition {
  id: string;
  label: string;
  type: "text" | "number" | "boolean" | "color" | "select" | "url" | "icon";
  defaultValue?: unknown;
  options?: { label: string; value: string }[];
  description?: string;
}

export type ShapeGeometry =
  | { type: "rectangle"; rx?: number; ry?: number }
  | { type: "rounded-rectangle"; radius?: number }
  | { type: "ellipse" }
  | { type: "circle" }
  | { type: "polygon"; points: { x: number; y: number }[] } // Normalized 0..1 points
  | { type: "line"; x1: number; y1: number; x2: number; y2: number }
  | { type: "path"; d: string; viewBox?: string }
  | { type: "cylinder"; capHeightRatio?: number }
  | { type: "actor" }
  | { type: "cloud" }
  | { type: "document" }
  | { type: "database" }
  | { type: "queue" }
  | { type: "hexagon" }
  | { type: "diamond" }
  | { type: "parallelogram" }
  | { type: "text"; text?: string; fontSize?: number; x?: number; y?: number; align?: "left" | "center" | "right" }
  | { type: "icon"; iconId?: string; x?: number; y?: number; width?: number; height?: number }
  | { type: "group"; children: ShapeGeometry[] };

export interface ShapeDefinition {
  id: string;
  name: string;
  description?: string;
  category?: string;
  tags?: string[];
  version: number;

  geometry: ShapeGeometry;

  defaults: {
    width: number;
    height: number;
    style?: ShapeStyle;
    label?: string;
    color?: string;
  };

  constraints?: ShapeConstraints;
  connectionPoints?: ConnectionPoint[];
  properties?: ShapePropertyDefinition[];
  iconId?: string;
  libraryId?: string;
}

/** Standard 4 cardinal connection points */
export const DEFAULT_CONNECTION_POINTS: ConnectionPoint[] = [
  { id: "top", x: 0.5, y: 0, direction: "top" },
  { id: "right", x: 1, y: 0.5, direction: "right" },
  { id: "bottom", x: 0.5, y: 1, direction: "bottom" },
  { id: "left", x: 0, y: 0.5, direction: "left" },
];

/** Standard 8-point connection points */
export const EIGHT_WAY_CONNECTION_POINTS: ConnectionPoint[] = [
  { id: "top", x: 0.5, y: 0, direction: "top" },
  { id: "top-right", x: 1, y: 0, direction: "top" },
  { id: "right", x: 1, y: 0.5, direction: "right" },
  { id: "bottom-right", x: 1, y: 1, direction: "bottom" },
  { id: "bottom", x: 0.5, y: 1, direction: "bottom" },
  { id: "bottom-left", x: 0, y: 1, direction: "bottom" },
  { id: "left", x: 0, y: 0.5, direction: "left" },
  { id: "top-left", x: 0, y: 0, direction: "top" },
];

// Compatibility interface for legacy callers
export interface ShapeTypeDefinition {
  id: string;
  label: string;
  icon: string;
  color: string;
  defaultWidth: number;
  defaultHeight: number;
  keepAspectRatio: boolean;
}

export const BUILTIN_SHAPES: ShapeDefinition[] = [
  // --- General Shapes (no default icon on canvas) ---
  {
    id: "circle",
    name: "Circle",
    category: "General",
    tags: ["circle", "round", "oval", "shape"],
    version: 1,
    geometry: { type: "circle" },
    defaults: { width: 100, height: 100, color: "#5B7CFA" },
    constraints: { keepAspectRatio: true, minWidth: 30, minHeight: 30 },
    connectionPoints: DEFAULT_CONNECTION_POINTS,
  },
  {
    id: "square",
    name: "Square",
    category: "General",
    tags: ["square", "box", "rectangle", "shape"],
    version: 1,
    geometry: { type: "rectangle" },
    defaults: { width: 100, height: 100, color: "#5B7CFA" },
    constraints: { keepAspectRatio: true, minWidth: 30, minHeight: 30 },
    connectionPoints: DEFAULT_CONNECTION_POINTS,
  },
  {
    id: "rectangle",
    name: "Rectangle",
    category: "General",
    tags: ["rectangle", "box", "quad", "shape"],
    version: 1,
    geometry: { type: "rectangle" },
    defaults: { width: 160, height: 100, color: "#5B7CFA" },
    constraints: { keepAspectRatio: false, minWidth: 30, minHeight: 30 },
    connectionPoints: DEFAULT_CONNECTION_POINTS,
  },
  {
    id: "rounded-rectangle",
    name: "Rounded Rectangle",
    category: "General",
    tags: ["rounded", "pill", "box", "rectangle"],
    version: 1,
    geometry: { type: "rounded-rectangle", radius: 12 },
    defaults: { width: 160, height: 100, color: "#5B7CFA" },
    constraints: { keepAspectRatio: false, minWidth: 30, minHeight: 30 },
    connectionPoints: DEFAULT_CONNECTION_POINTS,
  },
  {
    id: "diamond",
    name: "Diamond / Decision",
    category: "General",
    tags: ["diamond", "decision", "flowchart", "branch"],
    version: 1,
    geometry: { type: "diamond" },
    defaults: { width: 120, height: 120, color: "#22B8CF" },
    constraints: { keepAspectRatio: true, minWidth: 40, minHeight: 40 },
    connectionPoints: DEFAULT_CONNECTION_POINTS,
  },
  {
    id: "parallelogram",
    name: "Parallelogram / Data",
    category: "General",
    tags: ["parallelogram", "input", "output", "data", "flowchart"],
    version: 1,
    geometry: { type: "parallelogram" },
    defaults: { width: 160, height: 90, color: "#9061F9" },
    constraints: { keepAspectRatio: false, minWidth: 40, minHeight: 30 },
    connectionPoints: DEFAULT_CONNECTION_POINTS,
  },
  {
    id: "hexagon",
    name: "Hexagon / Preparation",
    category: "General",
    tags: ["hexagon", "polygon", "flowchart"],
    version: 1,
    geometry: { type: "hexagon" },
    defaults: { width: 140, height: 100, color: "#0FA36B" },
    constraints: { keepAspectRatio: false, minWidth: 40, minHeight: 40 },
    connectionPoints: DEFAULT_CONNECTION_POINTS,
  },
  {
    id: "cylinder",
    name: "Cylinder / Storage",
    category: "General",
    tags: ["cylinder", "database", "disk", "storage"],
    version: 1,
    geometry: { type: "cylinder" },
    defaults: { width: 120, height: 140, color: "#9061F9" },
    constraints: { keepAspectRatio: false, minWidth: 40, minHeight: 50 },
    connectionPoints: DEFAULT_CONNECTION_POINTS,
  },
  {
    id: "document",
    name: "Document",
    category: "General",
    tags: ["document", "file", "page", "report"],
    version: 1,
    geometry: { type: "document" },
    defaults: { width: 120, height: 150, color: "#F2994A" },
    constraints: { keepAspectRatio: false, minWidth: 40, minHeight: 50 },
    connectionPoints: DEFAULT_CONNECTION_POINTS,
  },

  // --- System Design & Infrastructure ---
  {
    id: "system.server",
    name: "Server / Service",
    category: "System Design",
    tags: ["server", "service", "compute", "node", "host"],
    version: 1,
    geometry: { type: "rounded-rectangle", radius: 8 },
    defaults: { width: 150, height: 90, color: "#5B7CFA", label: "Service" },
    constraints: { minWidth: 60, minHeight: 50 },
    connectionPoints: DEFAULT_CONNECTION_POINTS,
    iconId: "Server",
  },
  {
    id: "system.database",
    name: "Database",
    category: "System Design",
    tags: ["database", "data", "sql", "rdbms", "persistence"],
    version: 1,
    geometry: { type: "cylinder" },
    defaults: { width: 130, height: 130, color: "#9061F9", label: "Database" },
    constraints: { minWidth: 50, minHeight: 60 },
    connectionPoints: DEFAULT_CONNECTION_POINTS,
    iconId: "Database",
  },
  {
    id: "system.cache",
    name: "Cache",
    category: "System Design",
    tags: ["cache", "redis", "memcached", "memory", "in-memory"],
    version: 1,
    geometry: { type: "rounded-rectangle", radius: 8 },
    defaults: { width: 140, height: 80, color: "#9061F9", label: "Cache" },
    constraints: { minWidth: 50, minHeight: 40 },
    connectionPoints: DEFAULT_CONNECTION_POINTS,
    iconId: "Gauge",
  },
  {
    id: "system.queue",
    name: "Message Queue",
    category: "System Design",
    tags: ["queue", "kafka", "rabbitmq", "sqs", "messaging", "buffer"],
    version: 1,
    geometry: { type: "queue" },
    defaults: { width: 150, height: 80, color: "#F2994A", label: "Queue" },
    constraints: { minWidth: 60, minHeight: 40 },
    connectionPoints: DEFAULT_CONNECTION_POINTS,
    iconId: "ListOrdered",
  },
  {
    id: "system.cloud",
    name: "Cloud Boundary",
    category: "Cloud",
    tags: ["cloud", "aws", "gcp", "azure", "network", "vpc"],
    version: 1,
    geometry: { type: "cloud" },
    defaults: { width: 220, height: 140, color: "#0FA36B", label: "Cloud" },
    constraints: { minWidth: 80, minHeight: 60 },
    connectionPoints: DEFAULT_CONNECTION_POINTS,
    iconId: "Cloud",
  },
  {
    id: "system.api-gateway",
    name: "API Gateway",
    category: "Networking",
    tags: ["gateway", "api", "ingress", "proxy", "router"],
    version: 1,
    geometry: { type: "hexagon" },
    defaults: { width: 150, height: 95, color: "#0FA36B", label: "API Gateway" },
    constraints: { minWidth: 60, minHeight: 40 },
    connectionPoints: DEFAULT_CONNECTION_POINTS,
    iconId: "Network",
  },
  {
    id: "system.load-balancer",
    name: "Load Balancer",
    category: "Networking",
    tags: ["load balancer", "lb", "alb", "nlb", "traffic"],
    version: 1,
    geometry: { type: "rounded-rectangle", radius: 10 },
    defaults: { width: 150, height: 85, color: "#0FA36B", label: "Load Balancer" },
    constraints: { minWidth: 60, minHeight: 40 },
    connectionPoints: DEFAULT_CONNECTION_POINTS,
    iconId: "Waypoints",
  },
  {
    id: "system.container",
    name: "Container / Pod",
    category: "Containers",
    tags: ["container", "docker", "pod", "k8s", "kubernetes"],
    version: 1,
    geometry: { type: "rounded-rectangle", radius: 6 },
    defaults: { width: 140, height: 90, color: "#22B8CF", label: "Container" },
    constraints: { minWidth: 50, minHeight: 40 },
    connectionPoints: DEFAULT_CONNECTION_POINTS,
    iconId: "Box",
  },

  // --- UML Shapes ---
  {
    id: "uml.actor",
    name: "Actor / User",
    category: "UML",
    tags: ["actor", "user", "person", "client", "human", "uml"],
    version: 1,
    geometry: { type: "actor" },
    defaults: { width: 80, height: 120, color: "#F0578C", label: "User" },
    constraints: { keepAspectRatio: true, minWidth: 40, minHeight: 60 },
    connectionPoints: DEFAULT_CONNECTION_POINTS,
  },
  {
    id: "uml.usecase",
    name: "Use Case",
    category: "UML",
    tags: ["use case", "oval", "ellipse", "uml"],
    version: 1,
    geometry: { type: "ellipse" },
    defaults: { width: 160, height: 90, color: "#5B7CFA", label: "Use Case" },
    constraints: { minWidth: 50, minHeight: 40 },
    connectionPoints: DEFAULT_CONNECTION_POINTS,
  },
];

export class ShapeRegistry {
  private shapes: Map<string, ShapeDefinition> = new Map();
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.registerBuiltins();
  }

  private registerBuiltins() {
    for (const def of BUILTIN_SHAPES) {
      this.shapes.set(def.id, def);
    }
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  public registerShape(definition: ShapeDefinition): void {
    if (!definition.id || !definition.name) {
      throw new Error("Shape definition must have id and name");
    }
    this.shapes.set(definition.id, { ...definition });
    this.notify();
  }

  public registerShapes(definitions: ShapeDefinition[]): void {
    for (const def of definitions) {
      this.shapes.set(def.id, { ...def });
    }
    this.notify();
  }

  public unregisterShape(id: string): boolean {
    if (this.shapes.has(id)) {
      const deleted = this.shapes.delete(id);
      if (deleted) this.notify();
      return deleted;
    }
    return false;
  }

  public unregisterLibraryShapes(libraryId: string): void {
    let changed = false;
    for (const [id, def] of this.shapes.entries()) {
      if (def.libraryId === libraryId) {
        this.shapes.delete(id);
        changed = true;
      }
    }
    if (changed) this.notify();
  }

  public getShape(id: string): ShapeDefinition | undefined {
    return this.shapes.get(id);
  }

  public getAllShapes(): ShapeDefinition[] {
    return Array.from(this.shapes.values());
  }

  public getCategories(): string[] {
    const categories = new Set<string>();
    for (const shape of this.shapes.values()) {
      if (shape.category) categories.add(shape.category);
    }
    return Array.from(categories).sort();
  }

  public getShapesByCategory(category: string): ShapeDefinition[] {
    return this.getAllShapes().filter((shape) => shape.category === category);
  }

  public searchShapes(query: string, categoryFilter?: string): ShapeDefinition[] {
    const q = query.trim().toLowerCase();
    let results = this.getAllShapes();

    if (categoryFilter && categoryFilter !== "all") {
      results = results.filter((s) => s.category === categoryFilter);
    }

    if (!q) return results;

    return results.filter((s) => {
      if (s.name.toLowerCase().includes(q)) return true;
      if (s.id.toLowerCase().includes(q)) return true;
      if (s.category && s.category.toLowerCase().includes(q)) return true;
      if (s.libraryId && s.libraryId.toLowerCase().includes(q)) return true;
      if (s.tags && s.tags.some((t) => t.toLowerCase().includes(q))) return true;
      return false;
    });
  }

  public resetToBuiltins() {
    this.shapes.clear();
    this.registerBuiltins();
    this.notify();
  }
}

export const globalShapeRegistry = new ShapeRegistry();

export const DEFAULT_SHAPE_PALETTE_ICONS: Record<string, string> = {
  circle: "Circle",
  square: "Square",
  rectangle: "RectangleHorizontal",
  "rounded-rectangle": "SquareDashed",
  diamond: "GitFork",
  parallelogram: "Database",
  hexagon: "Hexagon",
  cylinder: "Database",
  document: "FileText",
  "uml.actor": "User",
  "uml.usecase": "Circle",
};

export function getShapePaletteIcon(shapeId: string, customIconId?: string): string {
  return customIconId || DEFAULT_SHAPE_PALETTE_ICONS[shapeId] || "Square";
}

// Export backwards-compatible SHAPE_TYPES and getShapeType
export const SHAPE_TYPES: ShapeTypeDefinition[] = BUILTIN_SHAPES.map((s) => ({
  id: s.id,
  label: s.name,
  icon: getShapePaletteIcon(s.id, s.iconId),
  color: s.defaults.color || "#5B7CFA",
  defaultWidth: s.defaults.width,
  defaultHeight: s.defaults.height,
  keepAspectRatio: s.constraints?.keepAspectRatio ?? false,
}));

export function getShapeType(id: string): ShapeTypeDefinition | undefined {
  const def = globalShapeRegistry.getShape(id);
  if (!def) return undefined;
  return {
    id: def.id,
    label: def.name,
    icon: getShapePaletteIcon(def.id, def.iconId),
    color: def.defaults.color || "#5B7CFA",
    defaultWidth: def.defaults.width,
    defaultHeight: def.defaults.height,
    keepAspectRatio: def.constraints?.keepAspectRatio ?? false,
  };
}
