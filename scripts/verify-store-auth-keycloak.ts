/**
 * Sign-in against a real Keycloak (WS10-R1, OQ-18).
 *
 * The in-process provider in verify-store-auth.ts covers the logic: PKCE,
 * signature and claim checks, replay, cookies. What it cannot cover is
 * whether we read a real provider's discovery document correctly, follow a
 * real login page, and accept a real token. That is what this does.
 *
 * With KEYCLOAK_ISSUER set (CI), it runs against that Keycloak. Without
 * one it runs against a stand-in provider that serves a login form with
 * Keycloak's field names, so the suite still exercises this script - the
 * redirect, the form, the callback, the session - on a machine with no
 * Keycloak. The stand-in cannot tell us whether we read Keycloak's real
 * discovery document and tokens correctly; only CI can.
 *
 *   KEYCLOAK_ISSUER=http://localhost:8081/realms/system-design \
 *   KEYCLOAK_CLIENT_ID=system-design-store \
 *   KEYCLOAK_CLIENT_SECRET=... \
 *   KEYCLOAK_USERNAME=tester KEYCLOAK_PASSWORD=... \
 *   npx tsx scripts/verify-store-auth-keycloak.ts
 */
import { chromium } from "playwright";
import type { AddressInfo } from "net";
import { createMemoryBlobStore, type MemoryTx } from "../store/src/blobStore.ts";
import { createDocumentService } from "../store/src/documentService.ts";
import { createHttpService, type StoreBackend } from "../store/src/httpService.ts";
import { createMemoryUserDirectory } from "../store/src/userDirectory.ts";
import { createSessionStore } from "../store/src/auth/sessions.ts";
import { createProvider } from "../store/src/auth/providers.ts";

import { startTestOidcProvider } from "./lib/testIdentityProviders.ts";

const external = process.env.KEYCLOAK_ISSUER;
const standIn = external ? null : await startTestOidcProvider({ subject: "tester", loginForm: true });
const issuer = external ?? standIn!.issuer;
if (standIn) {
  console.log("KEYCLOAK_ISSUER is not set: running against a stand-in provider that serves a login form.");
}

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const clientId = process.env.KEYCLOAK_CLIENT_ID ?? standIn?.clientId ?? "system-design-store";
const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET ?? standIn?.clientSecret ?? "";
const username = process.env.KEYCLOAK_USERNAME ?? "tester";
const password = process.env.KEYCLOAK_PASSWORD ?? "anything";

const blobs = createMemoryBlobStore();
const store = createDocumentService<MemoryTx>({
  blobs,
  begin: () => blobs.begin(),
  commit: (tx) => blobs.commit(tx),
  rollback: (tx) => blobs.rollback(tx),
}) as unknown as StoreBackend;

let origin = "";
const server = createHttpService({
  store,
  directory: createMemoryUserDirectory(),
  sessions: createSessionStore(),
  providers: [createProvider({ id: "oidc", kind: "oidc", issuer, clientId, clientSecret })],
  publicUrl: () => origin,
  afterLoginUrl: "/v1/auth/session",
});
// A fixed port, because Keycloak is configured with this exact redirect
// URL: a wildcard would be one more thing that could be wrong in a way the
// test could not see.
const port = Number(process.env.AUTH_TEST_PORT ?? 8090);
await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
console.log(`Store at ${origin}, Keycloak at ${issuer}`);

const browser = await chromium.launch({ headless: true });
try {
  console.log("=== Discovery ===");
  const discovery = await (await fetch(`${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`)).json();
  check(typeof (discovery as { authorization_endpoint?: string }).authorization_endpoint === "string", "Keycloak publishes a discovery document");
  check(
    /\/protocol\/openid-connect\/auth$/.test((discovery as { authorization_endpoint: string }).authorization_endpoint),
    "whose authorization endpoint is not the one a client would guess from the issuer"
  );

  console.log("\n=== Signing in ===");
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/v1/auth/oidc/start`);
  await page.waitForURL(/protocol\/openid-connect\/auth|\/login-actions\//, { timeout: 30000 });
  check(true, "the store redirects to Keycloak's login page");

  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.click("#kc-login, input[type=submit]");
  await page.waitForURL(`${origin}/**`, { timeout: 30000 });

  const body = await page.evaluate(() => document.body.innerText);
  let session: { issuer?: string; subject?: string; displayName?: string } | undefined;
  try {
    session = (JSON.parse(body) as { session?: typeof session }).session;
  } catch {
    // Left as undefined; the checks below report it.
  }
  check(!!session, `the browser comes back signed in (${body.slice(0, 120)})`);
  check(session?.issuer === issuer.replace(/\/+$/, ""), "the session records Keycloak as the issuer");
  check(!!session?.subject, `the session carries the provider's subject (${session?.subject})`);
  if (external) {
    // Keycloak identifies people by a UUID, never by the name they typed:
    // usernames can be changed and reused, subjects cannot.
    check(session?.subject !== username, `and with Keycloak that is its own identifier, not the username (${session?.subject})`);
  }

  console.log("\n=== The session works, and ends ===");
  const cookies = await context.cookies();
  const sessionCookie = cookies.find((cookie) => cookie.name === "sd_session");
  check(!!sessionCookie?.httpOnly, "the session cookie is HttpOnly");
  const listed = await page.evaluate(async (base) => {
    const response = await fetch(`${base}/v1/docs`, { credentials: "include" });
    return response.status;
  }, origin);
  check(listed === 200, "store routes accept the session");
  const loggedOut = await page.evaluate(async (base) => {
    await fetch(`${base}/v1/auth/logout`, { method: "POST", credentials: "include" });
    return (await fetch(`${base}/v1/docs`, { credentials: "include" })).status;
  }, origin);
  check(loggedOut === 401, "and stop as soon as it is ended");
} catch (error) {
  failures++;
  console.error("Verification failed with error:", error);
} finally {
  await browser.close().catch(() => {});
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await standIn?.close();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll Keycloak sign-in checks passed.");
process.exit(0);
