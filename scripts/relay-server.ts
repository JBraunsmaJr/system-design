/**
 * The session relay, with optional authentication (WS10-R6, R7).
 *
 *   npx tsx scripts/relay-server.ts            # open, as before
 *   RELAY_TOKEN_SECRET=... npx tsx scripts/relay-server.ts
 *
 * y-webrtc's own server is what this project has used until now, and it
 * admits anyone who can reach it: knowing a room name is the whole of the
 * access control. That is defensible for a deployment where the relay is
 * only reachable inside a network, and indefensible for one where it is
 * not - so this speaks exactly the same protocol and adds one thing: with
 * a secret configured, a peer must present a token from the store
 * (store/src/auth/roomTokens.ts) naming the room it is joining.
 *
 * scripts/verify-signaling-server.ts runs its protocol checks against both
 * this and y-webrtc's own server, so "the same protocol" is a tested claim
 * rather than an intention.
 *
 * The relay still learns nothing: it holds a shared secret and relays
 * ciphertext. Session content is encrypted with the key from the link
 * (WS3-R1), which never reaches it.
 */
import { createServer } from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import { verifyRoomToken, RoomTokenError } from '../store/src/auth/roomTokens.ts';

const port = Number(process.env.PORT ?? 4444);
const secret = process.env.RELAY_TOKEN_SECRET?.trim() || null;
const pingTimeoutMs = Number(process.env.RELAY_PING_TIMEOUT_MS ?? 30_000);

/** Subscribers per topic. A topic is a room name. */
const topics = new Map<string, Set<WebSocket>>();
/** What each connection is subscribed to, so a close can be cleaned up. */
const subscriptions = new Map<WebSocket, Set<string>>();

interface SignalMessage {
  type?: string;
  topic?: string;
  topics?: string[];
  /** Only read when a secret is configured. */
  token?: string;
  [key: string]: unknown;
}

const send = (socket: WebSocket, message: unknown) => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
};

function subscribe(socket: WebSocket, topic: string) {
  const subscribers = topics.get(topic) ?? new Set<WebSocket>();
  subscribers.add(socket);
  topics.set(topic, subscribers);
  const mine = subscriptions.get(socket) ?? new Set<string>();
  mine.add(topic);
  subscriptions.set(socket, mine);
}

function unsubscribe(socket: WebSocket, topic: string) {
  topics.get(topic)?.delete(socket);
  if (topics.get(topic)?.size === 0) topics.delete(topic);
  subscriptions.get(socket)?.delete(topic);
}

function disconnect(socket: WebSocket) {
  for (const topic of subscriptions.get(socket) ?? []) {
    topics.get(topic)?.delete(socket);
    if (topics.get(topic)?.size === 0) topics.delete(topic);
  }
  subscriptions.delete(socket);
}

const server = createServer((request, response) => {
  if (request.url === '/health') {
    const body = JSON.stringify({
      status: 'ok',
      authentication: secret ? 'required' : 'none',
      rooms: topics.size,
    });
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    });
    return response.end(body);
  }
  response.writeHead(404);
  response.end();
});

const sockets = new WebSocketServer({ server });

sockets.on('connection', (socket, request) => {
  // A token may arrive in the connection's query string, which is the only
  // place y-webrtc's client can carry one without modifying it, or in each
  // subscribe message for a client that can.
  const url = new URL(request.url ?? '/', 'http://relay.local');
  const connectionToken = url.searchParams.get('token');
  let alive = true;

  const refuse = (topic: string, reason: string, message: string) => {
    // Named, not silent: a peer that cannot join needs to know whether to
    // ask for a new token or stop trying.
    send(socket, { type: 'refused', topic, reason, message });
  };

  socket.on('message', (raw) => {
    let message: SignalMessage;
    try {
      message = JSON.parse(String(raw)) as SignalMessage;
    } catch {
      return;
    }
    if (typeof message.type !== 'string') return;

    switch (message.type) {
      case 'subscribe':
        for (const topic of message.topics ?? []) {
          if (typeof topic !== 'string') continue;
          if (secret) {
            const offered = message.token ?? connectionToken;
            if (!offered) {
              refuse(
                topic,
                'no-token',
                'This relay requires a token from the store. Sign in and try again.',
              );
              continue;
            }
            try {
              verifyRoomToken(offered, { room: topic, secret });
            } catch (error) {
              const reason = error instanceof RoomTokenError ? error.reason : 'invalid';
              refuse(
                topic,
                reason,
                error instanceof Error ? error.message : 'This token was refused.',
              );
              continue;
            }
          }
          subscribe(socket, topic);
        }
        break;

      case 'unsubscribe':
        for (const topic of message.topics ?? [])
          if (typeof topic === 'string') unsubscribe(socket, topic);
        break;

      case 'publish': {
        const topic = message.topic;
        if (typeof topic !== 'string') break;
        // A publisher that is not subscribed to the topic is not in the
        // room: with a secret configured that means it never presented a
        // token, and relaying for it would be the hole the token closes.
        // Checked before the room is looked up, or a publisher into an
        // empty room would be dropped silently and never learn why.
        if (secret && !subscriptions.get(socket)?.has(topic)) {
          refuse(topic, 'not-subscribed', 'Subscribe to this room before publishing to it.');
          break;
        }
        const subscribers = topics.get(topic);
        if (!subscribers) break;
        for (const subscriber of subscribers) {
          if (subscriber !== socket) send(subscriber, message);
        }
        break;
      }

      case 'ping':
        send(socket, { type: 'pong' });
        break;
    }
  });

  socket.on('pong', () => {
    alive = true;
  });
  socket.on('close', () => disconnect(socket));

  // Drops connections that have gone away without closing, which is what
  // keeps a room's peer list honest.
  const heartbeat = setInterval(() => {
    if (!alive) {
      clearInterval(heartbeat);
      disconnect(socket);
      return socket.terminate();
    }
    alive = false;
    socket.ping();
  }, pingTimeoutMs);
  socket.on('close', () => clearInterval(heartbeat));
});

server.listen(port, () => {
  console.log(`Relay listening on ${port}.`);
  console.log(
    secret
      ? 'Authentication: required - peers must present a room token from the store (WS10-R6).'
      : 'Authentication: NONE - anyone who can reach this relay and knows a room name can join it.',
  );
});
