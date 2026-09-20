/**
 * Identity providers for the auth tests.
 *
 * The OIDC one is deliberately real where it matters: it publishes a
 * discovery document and a JWKS, and signs ID tokens with RS256 using a
 * generated key, so the store's verification is exercised rather than
 * stubbed. It can also be told to misbehave - wrong signature, wrong
 * audience, expired, wrong nonce, `alg: none` - which is how the store's
 * rejections are checked.
 *
 * Kept in scripts/lib so the test runner does not treat it as a suite. CI
 * additionally runs the same flows against a real Keycloak.
 */
import { createServer, type Server } from "http";
import { createHash, createSign, generateKeyPairSync, randomBytes } from "crypto";
import type { AddressInfo } from "net";

export type Misbehaviour = "none" | "bad-signature" | "wrong-audience" | "expired" | "wrong-nonce" | "alg-none" | "no-id-token";

export interface TestOidcProvider {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** What the next token exchange should do wrong. */
  misbehave(mode: Misbehaviour): void;
  /** Who the provider says signed in. */
  setSubject(subject: string, name?: string): void;
  close(): Promise<void>;
}

interface PendingCode {
  nonce: string;
  challenge: string;
  redirectUri: string;
}

export interface TestOidcOptions {
  subject?: string;
  /**
   * Serve a login form at the authorization endpoint, with the field names
   * Keycloak uses, instead of redirecting straight back. Lets the Keycloak
   * suite's form-filling path be exercised without Keycloak.
   */
  loginForm?: boolean;
}

/** Keycloak asks a fresh user to complete their profile before it will
 * finish a sign-in. The stand-in does it once, so the handling for that is
 * exercised without Keycloak. */


export async function startTestOidcProvider(options: TestOidcOptions = {}): Promise<TestOidcProvider> {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
  const kid = "test-key-1";
  const clientId = "system-design-store";
  const clientSecret = "test-secret";
  const codes = new Map<string, PendingCode>();
  let subject = options.subject ?? "user-1";
  let displayName = "Test User";
  let misbehaviour: Misbehaviour = "none";
  let profileCompleted = false;
  let issuer = "";

  const sign = (payload: Record<string, unknown>, mode: Misbehaviour): string => {
    const header = mode === "alg-none" ? { alg: "none", typ: "JWT" } : { alg: "RS256", typ: "JWT", kid };
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const body = `${encode(header)}.${encode(payload)}`;
    if (mode === "alg-none") return `${body}.`;
    if (mode === "bad-signature") return `${body}.${Buffer.from(randomBytes(256)).toString("base64url")}`;
    const signature = createSign("RSA-SHA256").update(body).sign(privateKey).toString("base64url");
    return `${body}.${signature}`;
  };

  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", issuer);
    const json = (status: number, body: unknown) => {
      const payload = JSON.stringify(body);
      response.writeHead(status, { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) });
      response.end(payload);
    };

    if (url.pathname === "/.well-known/openid-configuration") {
      return json(200, {
        issuer,
        // Deliberately not `${issuer}/authorize`: a client that guesses the
        // endpoint instead of reading it here would break on Keycloak too.
        authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
        token_endpoint: `${issuer}/protocol/openid-connect/token`,
        jwks_uri: `${issuer}/protocol/openid-connect/certs`,
        response_types_supported: ["code"],
        id_token_signing_alg_values_supported: ["RS256"],
      });
    }

    if (url.pathname === "/protocol/openid-connect/certs") {
      return json(200, { keys: [{ kty: "RSA", kid, alg: "RS256", use: "sig", n: jwk.n, e: jwk.e }] });
    }

    if (url.pathname === "/login-actions/profile" && request.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const submitted = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      if (!submitted.get("email")) {
        response.writeHead(200, { "content-type": "text/html" });
        return response.end("<html><body><h1 id='kc-page-title'>Update Account Information</h1><p id='input-error'>Email is required.</p></body></html>");
      }
      profileCompleted = true;
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";
      const code = randomBytes(12).toString("hex");
      codes.set(code, {
        nonce: url.searchParams.get("nonce") ?? "",
        challenge: url.searchParams.get("code_challenge") ?? "",
        redirectUri,
      });
      const back = new URL(redirectUri);
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      response.writeHead(302, { location: back.toString() });
      return response.end();
    }

    if (url.pathname === "/protocol/openid-connect/auth" && options.loginForm) {
      // Keycloak's field and button ids, so a client driving the form is
      // driving the same shapes.
      const form = `<!doctype html><html><body><form id="kc-form-login" method="POST" action="/login-actions/authenticate${url.search}">
        <input id="username" name="username" autocomplete="username" />
        <input id="password" name="password" type="password" />
        <input id="kc-login" type="submit" value="Sign In" />
      </form></body></html>`;
      response.writeHead(200, { "content-type": "text/html", "content-length": String(Buffer.byteLength(form)) });
      return response.end(form);
    }

    if (url.pathname === "/login-actions/authenticate" && request.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const submitted = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      if (!submitted.get("username") || !submitted.get("password")) {
        response.writeHead(401, { "content-type": "text/html" });
        return response.end("<html><body><p id='input-error'>Invalid username or password.</p></body></html>");
      }
      subject = submitted.get("username") ?? subject;
      if (!profileCompleted) {
        // "Update Account Information", as Keycloak shows for a user with
        // no email: the browser stays here until it is filled in.
        const form = `<!doctype html><html><body><h1 id="kc-page-title">Update Account Information</h1>
          <form id="kc-update-profile-form" method="POST" action="/login-actions/profile${url.search}">
            <input id="email" name="email" /><input id="firstName" name="firstName" />
            <input id="lastName" name="lastName" /><input type="submit" value="Submit" />
          </form></body></html>`;
        response.writeHead(200, { "content-type": "text/html", "content-length": String(Buffer.byteLength(form)) });
        return response.end(form);
      }
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";
      const code = randomBytes(12).toString("hex");
      codes.set(code, {
        nonce: url.searchParams.get("nonce") ?? "",
        challenge: url.searchParams.get("code_challenge") ?? "",
        redirectUri,
      });
      const back = new URL(redirectUri);
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      response.writeHead(302, { location: back.toString() });
      return response.end();
    }

    if (url.pathname === "/protocol/openid-connect/auth") {
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";
      const code = randomBytes(12).toString("hex");
      codes.set(code, {
        nonce: url.searchParams.get("nonce") ?? "",
        challenge: url.searchParams.get("code_challenge") ?? "",
        redirectUri,
      });
      const back = new URL(redirectUri);
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      response.writeHead(302, { location: back.toString() });
      return response.end();
    }

    if (url.pathname === "/protocol/openid-connect/token" && request.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      const pending = codes.get(form.get("code") ?? "");
      codes.delete(form.get("code") ?? "");
      if (!pending) return json(400, { error: "invalid_grant" });
      if (form.get("client_secret") !== clientSecret) return json(401, { error: "invalid_client" });
      // PKCE, checked properly: the verifier must hash to the challenge sent
      // when the sign-in started.
      const verifier = form.get("code_verifier") ?? "";
      const computed = createHash("sha256").update(verifier).digest("base64url");
      if (computed !== pending.challenge) return json(400, { error: "invalid_grant", error_description: "PKCE mismatch" });

      const mode = misbehaviour;
      misbehaviour = "none";
      if (mode === "no-id-token") return json(200, { access_token: "x", token_type: "Bearer" });
      const nowSeconds = Math.floor(Date.now() / 1000);
      const payload = {
        iss: issuer,
        sub: subject,
        aud: mode === "wrong-audience" ? "some-other-client" : clientId,
        exp: mode === "expired" ? nowSeconds - 3600 : nowSeconds + 300,
        iat: mode === "expired" ? nowSeconds - 7200 : nowSeconds,
        nonce: mode === "wrong-nonce" ? "not-the-nonce" : pending.nonce,
        name: displayName,
      };
      return json(200, { access_token: "x", token_type: "Bearer", id_token: sign(payload, mode) });
    }

    json(404, { error: "not_found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    issuer,
    clientId,
    clientSecret,
    misbehave(mode) {
      misbehaviour = mode;
    },
    setSubject(next, name) {
      subject = next;
      if (name) displayName = name;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export interface TestGitHub {
  origin: string;
  clientId: string;
  clientSecret: string;
  setAccount(account: { id: number; login: string; name?: string }): void;
  close(): Promise<void>;
}

/** GitHub is OAuth2 without OIDC: no discovery, no ID token, identity from
 * the user endpoint. The stub behaves the same way. */
export async function startTestGitHub(): Promise<TestGitHub> {
  const clientId = "gh-client";
  const clientSecret = "gh-secret";
  let account = { id: 4242, login: "octocat", name: "The Octocat" };
  const codes = new Set<string>();
  let origin = "";

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", origin);
    const json = (status: number, body: unknown) => {
      const payload = JSON.stringify(body);
      response.writeHead(status, { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) });
      response.end(payload);
    };

    if (url.pathname === "/login/oauth/authorize") {
      const code = randomBytes(8).toString("hex");
      codes.add(code);
      const back = new URL(url.searchParams.get("redirect_uri") ?? "");
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      response.writeHead(302, { location: back.toString() });
      return response.end();
    }

    if (url.pathname === "/login/oauth/access_token" && request.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      if (!codes.delete(form.get("code") ?? "")) return json(200, { error: "bad_verification_code" });
      if (form.get("client_secret") !== clientSecret) return json(200, { error: "incorrect_client_credentials" });
      return json(200, { access_token: "gho_test", token_type: "bearer", scope: "read:user" });
    }

    if (url.pathname === "/user") {
      if (request.headers.authorization !== "Bearer gho_test") return json(401, { message: "Bad credentials" });
      return json(200, account);
    }

    json(404, { message: "Not Found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    origin,
    clientId,
    clientSecret,
    setAccount(next) {
      account = { ...next, name: next.name ?? next.login };
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
