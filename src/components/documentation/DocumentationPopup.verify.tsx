/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/documentation/DocumentationPopup.verify.tsx
 */
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentationRenderer } from "./DocumentationRenderer";
import { DocumentationPopup } from "./DocumentationPopup";
import type { DiagramDocumentation } from "../../domain/diagramDocumentation";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

// === Component Tests (Section 9) ===

// 1. Node with description displays popup content
{
  const doc: DiagramDocumentation = {
    description: "Routes incoming requests to backend services.",
  };
  const html = renderToStaticMarkup(
    <DocumentationRenderer
      documentation={doc}
      title="API Gateway"
      subtitle="Networking · API Gateway"
    />
  );
  assert(html.includes("API Gateway"), "DocumentationRenderer renders title");
  assert(html.includes("Networking · API Gateway"), "DocumentationRenderer renders subtitle");
  assert(html.includes("Routes incoming requests"), "DocumentationRenderer renders description");
  assert(!html.includes("Properties"), "DocumentationRenderer omits empty Properties section");
  assert(!html.includes("Tags"), "DocumentationRenderer omits empty Tags section");
}

// 2. Edge with properties displays popup content
{
  const doc: DiagramDocumentation = {
    properties: {
      Protocol: "gRPC",
      Timeout: "5000ms",
      Retries: 3,
    },
  };
  const html = renderToStaticMarkup(
    <DocumentationRenderer
      documentation={doc}
      title="Order Sync"
      subtitle="Sync Request"
    />
  );
  assert(html.includes("Order Sync"), "DocumentationRenderer renders edge title");
  assert(html.includes("Properties"), "DocumentationRenderer renders Properties section when present");
  assert(html.includes("Protocol"), "DocumentationRenderer renders property key");
  assert(html.includes("gRPC"), "DocumentationRenderer renders property string value");
  assert(html.includes("3"), "DocumentationRenderer renders property number value");
  assert(!html.includes("Tags"), "DocumentationRenderer omits empty Tags section");
}

// 3. Node with tags renders tags as badges
{
  const doc: DiagramDocumentation = {
    tags: ["Gateway", "Security", "Production"],
  };
  const html = renderToStaticMarkup(
    <DocumentationRenderer documentation={doc} />
  );
  assert(html.includes("Tags"), "DocumentationRenderer renders Tags section when present");
  assert(html.includes("Gateway"), "DocumentationRenderer renders tag badge");
  assert(html.includes("Security"), "DocumentationRenderer renders second tag badge");
  assert(html.includes("Production"), "DocumentationRenderer renders third tag badge");
  assert(!html.includes("Properties"), "DocumentationRenderer omits empty Properties section");
}

// 4. Element with no documentation does not display popup (returns null / empty markup)
{
  const doc: DiagramDocumentation = {
    description: "   ",
    properties: {},
    tags: [],
  };
  const html = renderToStaticMarkup(
    <DocumentationPopup
      documentation={doc}
      open={true}
      anchor={{ x: 100, y: 100 }}
    />
  );
  assert(html === "", "DocumentationPopup does not render markup when hasDocumentation is false");
}

// 5. DocumentationPopup with open=false does not display
{
  const doc: DiagramDocumentation = {
    description: "Valid description",
  };
  const html = renderToStaticMarkup(
    <DocumentationPopup
      documentation={doc}
      open={false}
      anchor={{ x: 100, y: 100 }}
    />
  );
  assert(html === "", "DocumentationPopup does not render markup when open is false");
}

// 6. Complex property formatting and safety
{
  const doc: DiagramDocumentation = {
    properties: {
      endpoints: ["/api/v1/users", "/api/v1/auth"],
      active: true,
      meta: { region: "us-east-1" },
    },
  };
  const html = renderToStaticMarkup(
    <DocumentationRenderer documentation={doc} title="Service" />
  );
  assert(html.includes("/api/v1/users, /api/v1/auth"), "DocumentationRenderer formats array values");
  assert(html.includes("true"), "DocumentationRenderer formats boolean true");
  assert(html.includes("us-east-1"), "DocumentationRenderer formats nested object values safely");
}

// 7. Positive-path test for DocumentationPopup with open=true and meaningful documentation
{
  const doc: DiagramDocumentation = {
    description: "Routes incoming requests to backend services.",
    properties: { Protocol: "HTTPS" },
    tags: ["Gateway"],
  };
  const html = renderToStaticMarkup(
    <DocumentationPopup
      documentation={doc}
      title="API Gateway"
      open={true}
      anchor={{ x: 150, y: 250 }}
    />
  );
  assert(html.includes("doc-popup"), "DocumentationPopup renders .doc-popup container");
  assert(html.includes('role="tooltip"'), 'DocumentationPopup renders role="tooltip"');
  assert(html.includes("Routes incoming requests to backend services."), "DocumentationPopup renders description text");
  assert(html.includes("API Gateway"), "DocumentationPopup renders title");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
