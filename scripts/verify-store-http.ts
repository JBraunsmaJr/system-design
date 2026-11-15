/**
 * The store's HTTP service on its own: what every request passes through,
 * and the few routes that are not the workspace API.
 *
 * Workspaces and documents are verify-store-v2.ts; sign-in is
 * verify-store-auth.ts; relay tokens against a real relay are
 * verify-relay-auth.ts. This covers what is left, and that the routes the
 * encrypted workspace had are gone rather than half-working.
 *
 * Run with: npx tsx scripts/verify-store-http.ts
 */
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createHttpService, createMemoryAuditSink, HttpError } from '../store/src/httpService.ts';
import { verifyRoomToken } from '../store/src/auth/roomTokens.ts';

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const EDITOR = 'https://editor.example';
const SECRET = 'verify-store-http-relay-secret-0123456789abcdef';

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

interface Body {
  [key: string]: unknown;
  error?: { reason?: string; message?: string };
  providers?: string[];
  token?: string;
}
type Reply = { status: number; body: Body; headers: Headers };
const parse = (text: string): Body => {
  try {
    return text ? (JSON.parse(text) as Body) : {};
  } catch {
    return { unparsed: text };
  }
};
const caller =
  (origin: string) =>
  async (method: string, path: string, init: RequestInit = {}): Promise<Reply> => {
    const response = await fetch(`${origin}${path}`, { method, ...init });
    return {
      status: response.status,
      body: parse(await response.text()),
      headers: response.headers,
    };
  };

console.log('=== Refusing to start without sign-in ===');
{
  let threw = false;
  try {
    createHttpService({});
  } catch {
    threw = true;
  }
  check(threw, 'the service refuses to start unauthenticated unless the caller says so explicitly');
}

console.log('\n=== What it answers on its own ===');
{
  const audit = createMemoryAuditSink();
  const calls: string[] = [];
  const server = createHttpService({
    allowUnauthenticated: true,
    audit,
    allowedOrigins: [EDITOR],
    relayTokenSecret: SECRET,
    maxRequestBytes: 64,
    // Stands in for the workspace API, to see what it is handed.
    v2: async (request) => {
      calls.push(`${request.method} /${request.parts.join('/')}`);
      if (request.parts[0] === 'echo') return request.send(200, await request.readJson(), 7);
      if (request.parts[0] === 'refuse') {
        request.describeForAudit('test.refuse', 'doc-1');
        throw new HttpError(403, 'forbidden', 'Not you.');
      }
      if (request.parts[0] === 'break') throw new Error('a bug, with details nobody should see');
      return request.send(204, {});
    },
  });
  const origin = await listen(server);
  const call = caller(origin);
  try {
    const health = await call('GET', '/v1/health');
    check(
      health.status === 200 &&
        health.body.status === 'ok' &&
        health.body.authentication === 'none' &&
        health.body.relayAuthentication === 'required',
      'health says it is up, whether it wants sign-in, and whether the relay wants tokens',
    );
    check(
      !('cryptoMode' in health.body) && !('escrow' in health.body),
      'and no longer speaks of encryption modes or escrow',
    );
    const root = await call('GET', '/');
    check(
      root.status === 200 && root.body.workspaces === '/v2/workspaces',
      'the root says what this is and where its API is',
    );

    // --- Gone ----------------------------------------------------------------
    const gone: [string, string][] = [
      ['GET', '/v1/docs'],
      ['POST', '/v1/docs'],
      ['GET', '/v1/docs/some-document'],
      ['GET', '/v1/recovery-key'],
      ['GET', '/v1/users/me'],
      ['GET', '/v1/users/me/devices'],
      ['GET', '/v1/workspace/members'],
      ['GET', '/v1/workspaces/default'],
      ['GET', '/v1/workspaces/default/access-rule'],
      ['GET', '/v1/workspaces/default/join-requests'],
      ['POST', '/v1/join-requests'],
      ['GET', '/v1/admin/users'],
      ['POST', '/v1/admin/purge-due'],
    ];
    const stillThere = [];
    for (const [method, path] of gone) {
      const reply = await call(method, path);
      if (reply.status !== 404) stillThere.push(`${method} ${path} (${reply.status})`);
    }
    check(
      stillThere.length === 0,
      `every route of the encrypted workspace answers 404${stillThere.length ? `: ${stillThere.join(', ')}` : ''}`,
    );
    check((await call('GET', '/nonsense')).status === 404, 'as does any unknown path');

    // --- The hand-off to the workspace API -----------------------------------
    const echoed = await call('POST', '/v2/echo/a%20b', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ n: 1 }),
    });
    check(
      echoed.status === 200 &&
        echoed.body.n === 1 &&
        echoed.headers.get('x-document-version') === '7' &&
        calls.includes('POST /echo/a%20b'),
      'a /v2 request reaches the workspace API with its path, body and a way to reply with a version',
    );
    const tooLarge = await call('POST', '/v2/echo', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(200) }),
    });
    check(
      tooLarge.status === 413 && tooLarge.body.error?.reason === 'too-large',
      'a body over the limit is refused',
    );
    const malformed = await call('POST', '/v2/echo', {
      headers: { 'content-type': 'application/json' },
      body: '{ broken',
    });
    check(
      malformed.status === 400 && malformed.body.error?.reason === 'bad-request',
      'a body that is not JSON is a 400, not a failure',
    );
    const refused = await call('GET', '/v2/refuse');
    check(
      refused.status === 403 && refused.body.error?.message === 'Not you.',
      'a refusal from the workspace API is replied to as it was raised',
    );
    const broken = await call('GET', '/v2/break');
    check(
      broken.status === 500 &&
        broken.body.error?.reason === 'internal' &&
        !JSON.stringify(broken.body).includes('nobody should see'),
      'an unexpected failure is a 500 that gives nothing away',
    );
    const entries = audit.all();
    check(
      entries.some(
        (entry) =>
          entry.operation === 'test.refuse' &&
          entry.docId === 'doc-1' &&
          entry.outcome === 'denied',
      ) && entries.some((entry) => entry.outcome === 'error'),
      'refusals and failures are in the audit trail, named as the workspace API named them',
    );

    // --- Replies ---------------------------------------------------------------
    const cors = await call('GET', '/v1/health', { headers: { origin: EDITOR } });
    check(
      cors.headers.get('access-control-allow-origin') === EDITOR &&
        cors.headers.get('access-control-allow-credentials') === 'true',
      'an allowed editor origin may read replies and send its cookie',
    );
    const stranger = await call('GET', '/v1/health', {
      headers: { origin: 'https://elsewhere.example' },
    });
    check(
      stranger.headers.get('access-control-allow-origin') === null,
      'any other origin is given no such permission',
    );
    const preflight = await call('OPTIONS', '/v2/echo', { headers: { origin: EDITOR } });
    check(
      preflight.status === 204 &&
        (preflight.headers.get('access-control-allow-methods') ?? '').includes('PATCH') &&
        !(preflight.headers.get('access-control-allow-headers') ?? '').includes('x-device-id'),
      'a preflight allows the methods the API uses, and no headers it no longer reads',
    );
    check(
      [health, root, refused, broken, preflight].every(
        (reply) => reply.headers.get('cache-control') === 'no-store',
      ),
      'and nothing is cacheable',
    );

    // --- Relay tokens for sessions people start themselves -------------------
    const token = await call('POST', '/v1/rooms/session-abc123/token');
    check(
      token.status === 200 &&
        verifyRoomToken(token.body.token ?? '', { room: 'session-abc123', secret: SECRET }).room ===
          'session-abc123',
      'a room token is issued for a session started by link',
    );
    check(
      (await call('POST', `/v1/rooms/wsdoc-${'0'.repeat(32)}/token`)).status === 403,
      "but not for a workspace document's room, with or without a workspace API behind it",
    );
  } finally {
    await close(server);
  }
}

console.log('\n=== With sign-in required, and no relay secret ===');
{
  const server = createHttpService({
    providers: [
      {
        id: 'none',
        describe: () => ({ kind: 'oidc' as const, clientId: 'x' }),
        begin: async () => {
          throw new Error('not used');
        },
        complete: async () => {
          throw new Error('not used');
        },
      },
    ],
    sessions: (await import('../store/src/auth/sessions.ts')).createSessionStore(),
  });
  const origin = await listen(server);
  const call = caller(origin);
  try {
    const health = await call('GET', '/v1/health');
    check(
      health.body.authentication === 'required' && health.body.relayAuthentication === 'none',
      'health stays open, and says sign-in is required and the relay is not guarded',
    );
    check(
      (await call('GET', '/v1/auth/providers')).body.providers?.[0] === 'none',
      'the ways to sign in are listed without signing in',
    );
    check((await call('GET', '/v1/auth/session')).status === 401, 'nobody is signed in');
    const token = await call('POST', '/v1/rooms/session-abc123/token');
    check(
      token.status === 401 && token.body.error?.reason === 'unauthenticated',
      'a room token is refused to someone who has not signed in',
    );
  } finally {
    await close(server);
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll store HTTP checks passed.');
