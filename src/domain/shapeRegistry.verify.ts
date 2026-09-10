import {
  globalShapeRegistry,
  getShapeType,
  SHAPE_TYPES,
  DEFAULT_CONNECTION_POINTS,
  EIGHT_WAY_CONNECTION_POINTS,
  type ShapeDefinition,
} from "./shapeRegistry";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

console.log("=== 1. Testing Built-in Shapes Registration & Retrieval ===");
{
  const circle = globalShapeRegistry.getShape("circle");
  assert(circle !== undefined, "Built-in circle is registered");
  assert(circle?.geometry.type === "circle", "Circle geometry type is 'circle'");
  assert(circle?.constraints?.keepAspectRatio === true, "Circle maintains aspect ratio constraint");
  assert(circle?.iconId === undefined, "Circle starts with no iconId");

  const rect = globalShapeRegistry.getShape("rectangle");
  assert(rect !== undefined, "Built-in rectangle is registered");
  assert(rect?.iconId === undefined, "Rectangle starts with no iconId");

  const doc = globalShapeRegistry.getShape("document");
  assert(doc !== undefined, "Built-in document is registered");
  assert(doc?.iconId === undefined, "Document starts with no iconId");

  const server = globalShapeRegistry.getShape("system.server");
  assert(server !== undefined, "Built-in system.server is registered");
  assert(server?.category === "System Design", "system.server is categorized under 'System Design'");
  assert(server?.iconId === "Server", "system.server has iconId 'Server'");

  const db = globalShapeRegistry.getShape("system.database");
  assert(db !== undefined && db.geometry.type === "cylinder", "system.database has cylinder geometry");

  const actor = globalShapeRegistry.getShape("uml.actor");
  assert(actor !== undefined && actor.geometry.type === "actor", "uml.actor has actor geometry");
}

console.log("\n=== 2. Testing Connection Points Abstraction ===");
{
  const rect = globalShapeRegistry.getShape("rectangle");
  assert(rect?.connectionPoints !== undefined, "Rectangle has connection points");
  assert(rect?.connectionPoints?.length === 4, "Rectangle has 4 default connection points");
  assert(
    rect?.connectionPoints?.some((p) => p.id === "top" && p.x === 0.5 && p.y === 0) === true,
    "Top connection point is centered at (0.5, 0)"
  );
  assert(DEFAULT_CONNECTION_POINTS.length === 4, "DEFAULT_CONNECTION_POINTS has 4 cardinal points");
  assert(EIGHT_WAY_CONNECTION_POINTS.length === 8, "EIGHT_WAY_CONNECTION_POINTS has 8 points");
}

console.log("\n=== 3. Testing Custom Shape Registration & Dynamic Search ===");
{
  const customShape: ShapeDefinition = {
    id: "test.custom-gateway",
    name: "Custom API Gateway",
    category: "Microservices",
    tags: ["gateway", "ingress", "proxy", "custom"],
    version: 1,
    geometry: { type: "hexagon" },
    defaults: {
      width: 160,
      height: 100,
      color: "#0FA36B",
      label: "API Gateway",
    },
    constraints: { minWidth: 50, minHeight: 40 },
    connectionPoints: DEFAULT_CONNECTION_POINTS,
    properties: [
      { id: "rateLimit", label: "Rate Limit (rps)", type: "number", defaultValue: 1000 },
      { id: "authRequired", label: "Require Auth", type: "boolean", defaultValue: true },
    ],
    iconId: "Network",
    libraryId: "test-lib",
  };

  globalShapeRegistry.registerShape(customShape);
  const retrieved = globalShapeRegistry.getShape("test.custom-gateway");
  assert(retrieved !== undefined, "Custom shape was successfully registered");
  assert(retrieved?.name === "Custom API Gateway", "Custom shape retains name");
  assert(retrieved?.properties?.length === 2, "Custom shape retains 2 properties");

  const searchHits = globalShapeRegistry.searchShapes("ingress");
  assert(searchHits.some((s) => s.id === "test.custom-gateway"), "Custom shape found by tag search 'ingress'");

  globalShapeRegistry.unregisterLibraryShapes("test-lib");
  assert(globalShapeRegistry.getShape("test.custom-gateway") === undefined, "Unregistering library shapes cleans up registry");
}

console.log("\n=== 4. Testing Backward Compatibility Layer ===");
{
  const compatCircle = getShapeType("circle");
  assert(compatCircle !== undefined, "getShapeType('circle') resolves successfully");
  assert(compatCircle?.keepAspectRatio === true, "getShapeType maintains keepAspectRatio");
  assert(compatCircle?.defaultWidth === 100, "getShapeType maintains defaultWidth");

  assert(SHAPE_TYPES.length >= 3, "SHAPE_TYPES array contains all built-in types");
  assert(SHAPE_TYPES.some((s) => s.id === "circle"), "SHAPE_TYPES includes circle");
  assert(SHAPE_TYPES.some((s) => s.id === "square"), "SHAPE_TYPES includes square");
  assert(SHAPE_TYPES.some((s) => s.id === "rectangle"), "SHAPE_TYPES includes rectangle");
}

console.log("\n--------------------------------------------------");
if (failures === 0) {
  console.log("All ShapeRegistry tests passed successfully!\n");
} else {
  throw new Error(`${failures} failure(s) in ShapeRegistry tests.`);
}
