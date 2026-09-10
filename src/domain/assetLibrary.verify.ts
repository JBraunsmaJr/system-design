import {
  validateAssetLibrary,
  globalAssetLibraryManager,
  type AssetLibrary,
} from "./assetLibrary";
import { globalIconRegistry } from "./iconRegistry";
import { globalShapeRegistry } from "./shapeRegistry";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

console.log("=== 1. Testing Library Schema Validation ===");
{
  const validLibJson = {
    format: "system-design-library",
    version: 1,
    library: {
      id: "company-arch",
      name: "Company Architecture",
      description: "Standard shapes & icons",
      version: 1,
      author: "DevOps",
      license: "Internal",
    },
    icons: [
      {
        id: "company.auth",
        name: "Auth Service",
        version: 1,
        source: {
          type: "svg",
          data: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>',
        },
      },
    ],
    shapes: [
      {
        id: "company.node",
        name: "Standard Node",
        version: 1,
        geometry: { type: "rounded-rectangle", radius: 8 },
        defaults: { width: 140, height: 90, color: "#5B7CFA" },
        iconId: "company.auth",
      },
    ],
  };

  const res = validateAssetLibrary(validLibJson);
  assert(res.valid === true, "Valid library passes validation");
  assert(res.importedIconsCount === 1, "1 icon recognized in library");
  assert(res.importedShapesCount === 1, "1 shape recognized in library");
  assert(res.errors.length === 0, "No validation errors reported");

  // Invalid library format
  const invalidFormat = { format: "wrong-format", library: { id: "bad", name: "Bad" } };
  const resBad = validateAssetLibrary(invalidFormat);
  assert(resBad.errors.some((e) => e.includes("wrong-format") || e.includes("system-design-library")), "Invalid format detected");
}

console.log("\n=== 2. Testing Library Manager Integration & Syncing ===");
{
  const testLib: AssetLibrary = {
    format: "system-design-library",
    version: 1,
    library: {
      id: "team-mesh",
      name: "Service Mesh",
      version: 1,
    },
    icons: [
      {
        id: "mesh.envoy",
        name: "Envoy Proxy",
        version: 1,
        source: { type: "builtin", key: "Shuffle" },
        libraryId: "team-mesh",
      },
    ],
    shapes: [
      {
        id: "mesh.sidecar",
        name: "Envoy Sidecar",
        version: 1,
        geometry: { type: "hexagon" },
        defaults: { width: 120, height: 80, color: "#9061F9" },
        iconId: "mesh.envoy",
        libraryId: "team-mesh",
      },
    ],
    enabled: true,
  };

  globalAssetLibraryManager.addOrUpdateLibrary(testLib);
  assert(globalIconRegistry.getIcon("mesh.envoy") !== undefined, "Library icon registered in globalIconRegistry");
  assert(globalShapeRegistry.getShape("mesh.sidecar") !== undefined, "Library shape registered in globalShapeRegistry");

  // Disable library
  globalAssetLibraryManager.setLibraryEnabled("team-mesh", false);
  assert(globalIconRegistry.getIcon("mesh.envoy") === undefined, "Disabling library removes icon from active registry");
  assert(globalShapeRegistry.getShape("mesh.sidecar") === undefined, "Disabling library removes shape from active registry");

  // Re-enable library
  globalAssetLibraryManager.setLibraryEnabled("team-mesh", true);
  assert(globalIconRegistry.getIcon("mesh.envoy") !== undefined, "Re-enabling library restores icon in active registry");
  assert(globalShapeRegistry.getShape("mesh.sidecar") !== undefined, "Re-enabling library restores shape in active registry");

  // Delete library
  globalAssetLibraryManager.deleteLibrary("team-mesh");
  assert(globalIconRegistry.getIcon("mesh.envoy") === undefined, "Deleting library unregisters icon");
  assert(globalShapeRegistry.getShape("mesh.sidecar") === undefined, "Deleting library unregisters shape");
}

console.log("\n--------------------------------------------------");
if (failures === 0) {
  console.log("All AssetLibrary tests passed successfully!\n");
} else {
  throw new Error(`${failures} failure(s) in AssetLibrary tests.`);
}
