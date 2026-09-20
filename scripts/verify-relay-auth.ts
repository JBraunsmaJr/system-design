/**
 * An authenticated relay (WS10-R6, R7).
 *
 * Until now, knowing a room name was the whole of the access control on a
 * session. With a secret shared between the store and the relay, a peer
 * must present a token the store issued for that room.
 *
 * Checked here against the real relay over real WebSockets: the tokens
 * themselves, what the relay refuses, and that an open relay still behaves
 * exactly as it did.
 */
import { spawn, type ChildProcess } from 'child_process';
import WebSocket from 'ws';
import { mintRoomToken, verifyRoomToken, RoomTokenError } from '../store/src/auth/roomTokens.ts';

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const SECRET = 'a'.repeat(48);

console.log('=== The tokens ===');
{
  const { token } = mintRoomToken({ room: 'room-a', subject: 'alice', secret: SECRET });
  check(
    verifyRoomToken(token, { room: 'room-a', secret: SECRET }).subject === 'alice',
    'a token admits its holder to its room',
  );

  const refusals: [string, () => unknown, RoomTokenError['reason']][] = [
    [
      'a token for another room',
      () => verifyRoomToken(token, { room: 'room-b', secret: SECRET }),
      'wrong-room',
    ],
    [
      'a token signed with another secret',
      () => verifyRoomToken(token, { room: 'room-a', secret: 'b'.repeat(48) }),
      'signature',
    ],
    [
      'an expired token',
      () =>
        verifyRoomToken(
          mintRoomToken({ room: 'room-a', subject: 'alice', secret: SECRET, ttlMs: -60_000 }).token,
          {
            room: 'room-a',
            secret: SECRET,
          },
        ),
      'expired',
    ],
    [
      'something that is not a token',
      () => verifyRoomToken('nonsense', { room: 'room-a', secret: SECRET }),
      'malformed',
    ],
    [
      'a token whose claims were edited',
      () => {
        const [, signature] = token.split('.');
        const forged = Buffer.from(
          JSON.stringify({ room: 'room-b', subject: 'alice', exp: 9e9, iat: 0 }),
        ).toString('base64url');
        return verifyRoomToken(`${forged}.${signature}`, { room: 'room-b', secret: SECRET });
      },
      'signature',
    ],
  ];
  for (const [description, attempt, expected] of refusals) {
    try {
      attempt();
      failures++;
      console.error(`  FAIL: ${description} is refused (it was accepted)`);
    } catch (error) {
      const reason = error instanceof RoomTokenError ? error.reason : 'other';
      check(reason === expected, `${description} is refused as ${reason}`);
    }
  }
}

/** The relay, as a deployment runs it. */
async function startRelay(port: number, secret: string | null): Promise<ChildProcess> {
  const relay = spawn(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'scripts/relay-server.ts'],
    {
      env: {
        ...process.env,
        PORT: String(port),
        ...(secret ? { RELAY_TOKEN_SECRET: secret } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return relay;
    } catch {
      // Not listening yet.
    }
    await sleep(200);
  }
  throw new Error('the relay did not start');
}

/** A peer: subscribes, collects what it is sent. */
function connect(
  port: number,
  query = '',
): Promise<{ socket: WebSocket; received: Record<string, unknown>[] }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${query}`);
    const received: Record<string, unknown>[] = [];
    socket.on('message', (raw) =>
      received.push(JSON.parse(String(raw)) as Record<string, unknown>),
    );
    socket.on('open', () => resolve({ socket, received }));
    socket.on('error', reject);
  });
}

console.log('\n=== A relay that requires them ===');
{
  const port = 14471;
  const relay = await startRelay(port, SECRET);
  try {
    const health = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as {
      authentication: string;
    };
    check(health.authentication === 'required', 'says so on its health route');

    const room = 'room-shared';
    const alice = await connect(port);
    alice.socket.send(JSON.stringify({ type: 'subscribe', topics: [room] }));
    await sleep(200);
    check(
      alice.received.some((message) => message.type === 'refused' && message.reason === 'no-token'),
      'a peer with no token is refused, and told why',
    );

    const stale = mintRoomToken({ room, subject: 'alice', secret: SECRET, ttlMs: -60_000 }).token;
    alice.socket.send(JSON.stringify({ type: 'subscribe', topics: [room], token: stale }));
    await sleep(200);
    check(
      alice.received.some((message) => message.reason === 'expired'),
      'an expired token is refused by name',
    );

    const forRoomB = mintRoomToken({
      room: 'another-room',
      subject: 'alice',
      secret: SECRET,
    }).token;
    alice.socket.send(JSON.stringify({ type: 'subscribe', topics: [room], token: forRoomB }));
    await sleep(200);
    check(
      alice.received.some((message) => message.reason === 'wrong-room'),
      'a token for another room does not open this one',
    );

    // Publishing without having joined: the hole a token would otherwise
    // leave open.
    alice.socket.send(JSON.stringify({ type: 'publish', topic: room, data: 'uninvited' }));
    await sleep(200);
    check(
      alice.received.some((message) => message.reason === 'not-subscribed'),
      'and neither does publishing into a room without joining it',
    );

    // Two peers with proper tokens.
    const aliceToken = mintRoomToken({ room, subject: 'alice', secret: SECRET }).token;
    const bobToken = mintRoomToken({ room, subject: 'bob', secret: SECRET }).token;
    const bob = await connect(port, `?token=${encodeURIComponent(bobToken)}`);
    alice.socket.send(JSON.stringify({ type: 'subscribe', topics: [room], token: aliceToken }));
    bob.socket.send(JSON.stringify({ type: 'subscribe', topics: [room] }));
    await sleep(300);
    alice.received.length = 0;
    bob.received.length = 0;

    bob.socket.send(JSON.stringify({ type: 'publish', topic: room, data: 'hello' }));
    await sleep(300);
    check(
      alice.received.some((message) => message.data === 'hello'),
      'two peers with tokens reach each other',
    );
    check(
      !bob.received.some((message) => message.data === 'hello'),
      'and a publisher is not sent its own message',
    );
    check(
      bob.received.length === 0 || bob.received.every((message) => message.type !== 'refused'),
      'a token in the connection URL works, for a client that cannot add one to a message',
    );

    // Someone in another room hears nothing of this one.
    const eaveToken = mintRoomToken({ room: 'another-room', subject: 'eve', secret: SECRET }).token;
    const eve = await connect(port);
    eve.socket.send(
      JSON.stringify({ type: 'subscribe', topics: ['another-room'], token: eaveToken }),
    );
    await sleep(200);
    bob.socket.send(JSON.stringify({ type: 'publish', topic: room, data: 'private' }));
    await sleep(300);
    check(
      !eve.received.some((message) => message.data === 'private'),
      'and a peer in another room hears none of it',
    );

    for (const peer of [alice, bob, eve]) peer.socket.close();
  } finally {
    relay.kill('SIGTERM');
  }
}

console.log('\n=== A relay that does not ===');
{
  // The deployment shape this project has always had: unchanged.
  const port = 14472;
  const relay = await startRelay(port, null);
  try {
    const health = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as {
      authentication: string;
    };
    check(health.authentication === 'none', 'says plainly that it admits anyone');
    const first = await connect(port);
    const second = await connect(port);
    first.socket.send(JSON.stringify({ type: 'subscribe', topics: ['open-room'] }));
    second.socket.send(JSON.stringify({ type: 'subscribe', topics: ['open-room'] }));
    await sleep(300);
    second.socket.send(
      JSON.stringify({ type: 'publish', topic: 'open-room', data: 'no token needed' }),
    );
    await sleep(300);
    check(
      first.received.some((message) => message.data === 'no token needed'),
      'and peers reach each other with no token at all',
    );
    first.socket.close();
    second.socket.close();
  } finally {
    relay.kill('SIGTERM');
  }
}

console.log('\n=== The client asking for a token ===');
{
  // What the editor does before joining: ask the store whether the relay
  // needs a token, and get one for this room if it does.
  const { createMemoryBlobStore } = await import('../store/src/blobStore.ts');
  const { createDocumentService } = await import('../store/src/documentService.ts');
  const { createHttpService } = await import('../store/src/httpService.ts');
  const { authorizeRelayUrls } = await import('../src/collab/relayAccess.ts');

  const blobs = createMemoryBlobStore();
  const store = createDocumentService({
    blobs,
    begin: () => blobs.begin(),
    commit: (tx) => blobs.commit(tx),
    rollback: (tx) => blobs.rollback(tx),
  });

  const withRelayAuth = createHttpService({
    store: store as never,
    allowUnauthenticated: true,
    relayTokenSecret: SECRET,
  });
  const open = createHttpService({ store: store as never, allowUnauthenticated: true });
  await new Promise<void>((resolve) => withRelayAuth.listen(14473, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => open.listen(14474, '127.0.0.1', resolve));

  try {
    const room = 'room-from-client';
    const urls = ['ws://relay.example:4444'];

    const authorised = await authorizeRelayUrls({ storeUrl: 'http://127.0.0.1:14473', room, urls });
    check(
      authorised.urls[0].includes('token='),
      'a relay that requires tokens gets one on the URL',
    );
    const token =
      new URL(authorised.urls[0].replace('ws://', 'http://')).searchParams.get('token') ?? '';
    check(
      verifyRoomToken(token, { room, secret: SECRET }).room === room,
      'and it is a token for this room',
    );

    const untouched = await authorizeRelayUrls({ storeUrl: 'http://127.0.0.1:14474', room, urls });
    check(untouched.urls[0] === urls[0], 'a relay that does not is left alone');

    const noStore = await authorizeRelayUrls({ storeUrl: null, room, urls });
    check(noStore.urls[0] === urls[0], 'and a deployment with no store is unaffected entirely');

    const unreachable = await authorizeRelayUrls({ storeUrl: 'http://127.0.0.1:9', room, urls });
    check(
      unreachable.urls[0] === urls[0] && unreachable.note !== null,
      `an unreachable store says so rather than failing silently (${unreachable.note?.slice(0, 60)})`,
    );
  } finally {
    await new Promise<void>((resolve) => withRelayAuth.close(() => resolve()));
    await new Promise<void>((resolve) => open.close(() => resolve()));
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll relay authentication checks passed.');
