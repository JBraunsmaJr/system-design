import {
  globalIconRegistry,
  sanitizeSvg,
  isValidSvg,
  type IconDefinition,
} from "./iconRegistry";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

console.log("=== 1. Testing Built-in Icons Registration & Retrieval ===");
{
  const server = globalIconRegistry.getIcon("Server");
  assert(server !== undefined, "Built-in 'Server' icon is registered");
  assert(server?.source.type === "builtin", "Server icon has source type 'builtin'");
  assert(server?.category === "Compute & Hardware", "Server icon is categorized under Compute & Hardware");

  const db = globalIconRegistry.getIcon("Database");
  assert(db !== undefined, "Built-in 'Database' icon is registered");
  assert(db?.category === "Data & Storage", "Database icon is categorized under Data & Storage");

  const allIcons = globalIconRegistry.getAllIcons();
  assert(allIcons.length > 500, `Registry contains ${allIcons.length} built-in icons`);
}

console.log("\n=== 2. Testing SVG Sanitization & Security ===");
{
  const unsafeSvg = `
    <svg viewBox="0 0 100 100" onload="alert('xss')" onclick="evil()">
      <script>alert('dangerous script')</script>
      <circle cx="50" cy="50" r="40" />
      <a href="javascript:alert(1)">Click</a>
      <object data="malicious.swf"></object>
    </svg>
  `;

  const cleaned = sanitizeSvg(unsafeSvg);
  assert(!cleaned.includes("<script"), "Sanitization strips <script> tags");
  assert(!cleaned.includes("alert('dangerous script')"), "Sanitization strips script contents");
  assert(!cleaned.includes("onload="), "Sanitization strips inline event handlers (onload)");
  assert(!cleaned.includes("onclick="), "Sanitization strips inline event handlers (onclick)");
  assert(!cleaned.includes("javascript:"), "Sanitization strips javascript: hrefs");
  assert(!cleaned.includes("<object"), "Sanitization strips <object> tags");
  assert(cleaned.includes("<circle cx=\"50\" cy=\"50\" r=\"40\" />"), "Sanitization preserves safe vector geometry");

  assert(isValidSvg(cleaned), "Sanitized SVG is valid SVG");
  assert(!isValidSvg("not an svg"), "Non-SVG string rejected by isValidSvg");
  assert(!isValidSvg("<svg><script>bad</script></svg>"), "Raw SVG with script tag rejected by isValidSvg");
}

console.log("\n=== 3. Testing Custom Icon Registration & Search ===");
{
  const customSvgIcon: IconDefinition = {
    id: "aws.lambda",
    name: "AWS Lambda",
    category: "Cloud / AWS",
    tags: ["aws", "serverless", "lambda", "function", "cloud"],
    version: 1,
    source: {
      type: "svg",
      data: '<svg viewBox="0 0 24 24"><path d="M12 2 L22 22 L2 22 Z"/></svg>',
    },
    attribution: {
      author: "AWS",
      license: "Apache-2.0",
      source: "https://aws.amazon.com",
    },
    libraryId: "aws-icons",
  };

  globalIconRegistry.registerIcon(customSvgIcon);
  const retrieved = globalIconRegistry.getIcon("aws.lambda");
  assert(retrieved !== undefined, "Custom SVG icon successfully registered");
  assert(retrieved?.attribution?.author === "AWS", "Attribution metadata preserved");

  const searchResults = globalIconRegistry.searchIcons("serverless");
  assert(searchResults.some((i) => i.id === "aws.lambda"), "Custom icon found when searching by tag 'serverless'");

  const catResults = globalIconRegistry.getIconsByCategory("Cloud / AWS");
  assert(catResults.some((i) => i.id === "aws.lambda"), "Custom icon found under category 'Cloud / AWS'");

  globalIconRegistry.unregisterLibraryIcons("aws-icons");
  assert(globalIconRegistry.getIcon("aws.lambda") === undefined, "Unregistering library icons removes them from registry");
}

console.log("\n--------------------------------------------------");
if (failures === 0) {
  console.log("All IconRegistry tests passed successfully!\n");
} else {
  throw new Error(`${failures} failure(s) in IconRegistry tests.`);
}
