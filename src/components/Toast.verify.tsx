/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/Toast.verify.tsx
 */
import { renderToStaticMarkup } from "react-dom/server";
import { Toast } from "./Toast";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

// 1. Toast renders message and status attributes
{
  const html = renderToStaticMarkup(
    <Toast message="Session link copied to clipboard" type="success" />
  );
  assert(html.includes("app-toast"), "Toast renders .app-toast container");
  assert(html.includes("app-toast--success"), "Toast renders success modifier class");
  assert(html.includes('role="status"'), 'Toast has role="status"');
  assert(html.includes('aria-live="polite"'), 'Toast has aria-live="polite"');
  assert(html.includes("Session link copied to clipboard"), "Toast renders message text");
}

// 2. Toast renders description when provided
{
  const html = renderToStaticMarkup(
    <Toast
      message="Link copied"
      description="Anyone with this link can join and edit"
      type="info"
    />
  );
  assert(html.includes("app-toast--info"), "Toast renders info modifier class");
  assert(html.includes("Anyone with this link can join and edit"), "Toast renders description text");
}

// 3. Toast renders close button when onClose is provided
{
  const html = renderToStaticMarkup(
    <Toast
      message="Copied"
      onClose={() => {}}
    />
  );
  assert(html.includes("app-toast__close-btn"), "Toast renders close button when onClose is passed");
  assert(html.includes('aria-label="Close notification"'), "Close button has accessible aria-label");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
