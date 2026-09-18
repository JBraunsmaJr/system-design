/**
 * Sign-in (WS10-R1), against a provider that really signs its tokens.
 *
 * The OIDC provider here publishes discovery and a JWKS and signs with
 * RS256, so the store's verification is exercised, and it can be told to
 * misbehave so the rejections are exercised too. GitHub is stubbed the way
 * GitHub behaves: OAuth2, no ID token, identity from the user endpoint.
 *
 * What matters beyond "a login works":
 *  - signing in grants identity, never content access (WS7-R11 to R13)
 *  - a subject is (issuer, subject), never an email address
 *  - the browser holds an opaque cookie: HttpOnly, SameSite=Lax, Secure on https
 *  - a token that is unsigned, mis-signed, expired, for another audience, or
 *    for another sign-in is refused
 *  - every attempt, successful or not, is audited (WS10-R3)
 */
import type { AddressInfo } from "net";
import { createMemoryBlobStore, type MemoryTx } from "../store/src/blobStore.ts";
import { createDocumentService } from "../store/src/documentService.ts";
import { createHttpService, createMemoryAuditSink, type StoreBackend } from "../store/src/httpService.ts";
import { createProvider } from "../store/src/auth/providers.ts";
import { createSessionStore, SESSION_COOKIE } from "../store/src/auth/sessions.ts";
import { verifyIdToken, TokenError } from "../store/src/auth/jwt.ts";
import { startTestGitHub, startTestOidcProvider, type Misbehaviour } from "./lib/testIdentityProviders.ts";

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

function newStore(): StoreBackend {
  const blobs = createMemoryBlobStore();
  return createDocumentService<MemoryTx>({
    blobs,
    begin: () => blobs.begin(),
    commit: (tx) => blobs.commit(tx),
    rollback: (tx) => blobs.rollback(tx),
  }) as unknown as StoreBackend;
}

const idp = await startTestOidcProvider();
const github = await startTestGitHub();

const audit = createMemoryAuditSink();
const sessions = createSessionStore();
const providers = [
  createProvider({ id: "oidc", kind: "oidc", issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret }),
  createProvider({
    id: "github",
    kind: "github",
    clientId: github.clientId,
    clientSecret: github.clientSecret,
    authorizeUrl: `${github.origin}/login/oauth/authorize`,
    tokenUrl: `${github.origin}/login/oauth/access_token`,
    userUrl: `${github.origin}/user`,
  }),
];

const server = createHttpService({ store: newStore(), audit, sessions, providers, afterLoginUrl: "/app" });
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
// The store must be told its own address, since that is where the provider
// sends the browser back to.
const serverWithUrl = createHttpService({ store: newStore(), audit, sessions, providers, publicUrl: origin, afterLoginUrl: "/app" });
await new Promise<void>((resolve) => server.close(() => resolve()));
await new Promise<void>((resolve) => serverWithUrl.listen(Number(new URL(origin).port), "127.0.0.1", resolve));

/** Follows the redirects of a sign-in by hand, as a browser would, and
 * returns the session cookie the store sets. */
async function signIn(provider: string): Promise<{ cookie: string | null; setCookie: string | null; finalLocation: string | null }> {
  const start = await fetch(`${origin}/v1/auth/${provider}/start`, { redirect: "manual" });
  const authorizeUrl = start.headers.get("location");
  if (!authorizeUrl) return { cookie: null, setCookie: null, finalLocation: null };
  const atProvider = await fetch(authorizeUrl, { redirect: "manual" });
  const callbackUrl = atProvider.headers.get("location");
  if (!callbackUrl) return { cookie: null, setCookie: null, finalLocation: null };
  const callback = await fetch(callbackUrl, { redirect: "manual" });
  const setCookie = callback.headers.get("set-cookie");
  const cookie = setCookie?.split(";")[0] ?? null;
  return { cookie, setCookie, finalLocation: callback.headers.get("location") };
}

const call = (path: string, cookie?: string | null, init: RequestInit = {}) =>
  fetch(`${origin}${path}`, { ...init, redirect: "manual", headers: { ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) } });

try {
  console.log("=== A store with no sign-in configured ===");
  {
    let threw = false;
    try {
      createHttpService({ store: newStore() });
    } catch {
      threw = true;
    }
    check(threw, "refuses to start with neither providers nor an explicit development flag");
    check(!!createHttpService({ store: newStore(), allowUnauthenticated: true }), "starts unauthenticated only when the caller says so");
  }

  console.log("\n=== Before signing in ===");
  {
    const anonymous = await call("/v1/docs");
    check(anonymous.status === 401, "every store route needs a session (401)");
    check((await (await call("/v1/auth/session")).json()).error?.reason === "unauthenticated", "and there is no session to report");
    const listed = await (await call("/v1/auth/providers")).json();
    check(JSON.stringify(listed.providers) === JSON.stringify(["oidc", "github"]), "the configured providers are advertised");
    check((await call("/v1/health")).status === 200, "health stays open, for a load balancer");
  }

  console.log("\n=== Signing in with OIDC ===");
  {
    const start = await call("/v1/auth/oidc/start");
    const authorizeUrl = new URL(start.headers.get("location") ?? "");
    check(start.status === 302, "starting redirects to the provider");
    check(
      authorizeUrl.pathname === "/protocol/openid-connect/auth",
      `to the endpoint discovery advertises, not a guessed one (${authorizeUrl.pathname})`
    );
    check(authorizeUrl.searchParams.get("code_challenge_method") === "S256" && !!authorizeUrl.searchParams.get("code_challenge"), "with PKCE");
    check(!!authorizeUrl.searchParams.get("state") && !!authorizeUrl.searchParams.get("nonce"), "and a state and nonce");
    check(!authorizeUrl.searchParams.get("client_secret"), "and no client secret, which stays on the server");

    idp.setSubject("alice", "Alice Example");
    const { cookie, setCookie, finalLocation } = await signIn("oidc");
    check(!!cookie?.startsWith(`${SESSION_COOKIE}=`), "the callback sets a session cookie");
    check(/HttpOnly/i.test(setCookie ?? "") && /SameSite=Lax/i.test(setCookie ?? ""), "HttpOnly and SameSite=Lax, so page scripts cannot read it and another site cannot use it");
    check(!/Secure/i.test(setCookie ?? ""), "not Secure here, because this deployment is plain http for development");
    check(finalLocation === "/app", "and the browser is sent on to the application");
    check(!(cookie ?? "").includes("alice"), "the cookie is opaque: it carries no identity of its own");

    const session = await (await call("/v1/auth/session", cookie)).json();
    check(session.session?.subject === "alice" && session.session?.issuer === idp.issuer, "the session reports (issuer, subject), not an email address");
    check(session.session?.displayName === "Alice Example", "and a display name for the interface");
    check((await call("/v1/docs", cookie)).status === 200, "store routes now work");

    const logout = await call("/v1/auth/logout", cookie, { method: "POST" });
    check(logout.status === 204, "logging out succeeds");
    check((await call("/v1/docs", cookie)).status === 401, "and the cookie stops working immediately");
  }

  console.log("\n=== Sign-ins that should fail ===");
  {
    check((await call("/v1/auth/callback?state=made-up&code=x")).status === 400, "a callback for a sign-in that never started is refused");
    const start = await call("/v1/auth/oidc/start");
    const authorizeUrl = start.headers.get("location") ?? "";
    const atProvider = await fetch(authorizeUrl, { redirect: "manual" });
    const callbackUrl = atProvider.headers.get("location") ?? "";
    check((await fetch(callbackUrl, { redirect: "manual" })).status === 302, "a genuine callback succeeds");
    check((await fetch(callbackUrl, { redirect: "manual" })).status === 400, "and replaying the same callback is refused: state is single use");

    const misbehaviours: [Misbehaviour, string][] = [
      ["bad-signature", "a token signed with the wrong key"],
      ["alg-none", "an unsigned token (alg: none)"],
      ["wrong-audience", "a token issued for another application"],
      ["expired", "an expired token"],
      ["wrong-nonce", "a token from a different sign-in"],
      ["no-id-token", "a response with no ID token at all"],
    ];
    for (const [mode, description] of misbehaviours) {
      idp.misbehave(mode);
      const attempt = await signIn("oidc");
      check(attempt.cookie === null, `${description} is refused, with no session created`);
    }
    idp.misbehave("none");
    check((await signIn("oidc")).cookie !== null, "and a good sign-in still works afterwards");
  }

  console.log("\n=== Signing in with GitHub ===");
  {
    github.setAccount({ id: 99001, login: "octocat", name: "The Octocat" });
    const { cookie } = await signIn("github");
    const session = await (await call("/v1/auth/session", cookie)).json();
    check(session.session?.subject === "99001", "the subject is GitHub's numeric account id, not the login name that can be reused");
    check(session.session?.issuer === github.origin, "and the issuer identifies GitHub");
    check((await call("/v1/docs", cookie)).status === 200, "the session works on store routes");

    // Same login name, different account: a different person.
    github.setAccount({ id: 12345, login: "octocat", name: "Impostor" });
    const other = await signIn("github");
    const otherSession = await (await call("/v1/auth/session", other.cookie)).json();
    check(otherSession.session?.subject === "12345", "a different account with the same login is a different subject");
  }

  console.log("\n=== Two issuers, one subject name ===");
  {
    idp.setSubject("octocat");
    const viaOidc = await signIn("oidc");
    const oidcSession = await (await call("/v1/auth/session", viaOidc.cookie)).json();
    github.setAccount({ id: 777, login: "octocat" });
    const viaGitHub = await signIn("github");
    const githubSession = await (await call("/v1/auth/session", viaGitHub.cookie)).json();
    check(
      oidcSession.session.issuer !== githubSession.session.issuer,
      "the same name at two providers is two identities, because identity is (issuer, subject)"
    );
  }

  console.log("\n=== Token verification, directly ===");
  {
    const reasonOf = (work: () => unknown) => {
      try {
        work();
        return "accepted";
      } catch (error) {
        return error instanceof TokenError ? error.reason : "other";
      }
    };
    check(reasonOf(() => verifyIdToken("not.a.token", { issuer: "i", audience: "a", keys: [] })) === "malformed", "a malformed token is named as such");
    check(
      reasonOf(() => verifyIdToken(`${Buffer.from('{"alg":"HS256"}').toString("base64url")}.e30.x`, { issuer: "i", audience: "a", keys: [] })) === "algorithm",
      "a symmetric algorithm is refused, whatever the header claims"
    );
  }

  console.log("\n=== The audit trail (WS10-R3) ===");
  {
    const entries = audit.all();
    check(entries.some((e) => e.operation === "login" && e.outcome === "ok" && e.subject?.includes("alice")), "a successful sign-in is recorded with its subject");
    check(entries.some((e) => e.operation === "login" && e.outcome === "denied"), "and so is a refused one");
    check(entries.some((e) => e.operation === "logout"), "logging out is recorded");
    check(
      entries.some((e) => e.outcome === "denied" && (e.detail as { reason?: string } | undefined)?.reason === "unauthenticated"),
      "and so is a request made without a session, with the reason"
    );
    check(!entries.some((e) => JSON.stringify(e).includes("gho_test")), "no token or secret appears in the trail");
  }
} finally {
  await new Promise<void>((resolve) => serverWithUrl.close(() => resolve()));
  await idp.close();
  await github.close();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll authentication checks passed.");
