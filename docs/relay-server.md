# The relay server

Collaborative editing needs one small piece of infrastructure: a **relay**
(a signaling server). This document covers what it does, how to run one,
how to point the app at it, and what changes when your users have no
access to the public internet.

## What the relay is and isn't

When two people open the same session, their browsers need a way to find
each other and exchange the handshake that establishes a direct WebRTC
connection. The relay is what carries that handshake. Once the peers are
connected, document data flows **directly between browsers** and the
relay is no longer in the path.

The relay is:

- A single-purpose WebSocket server, about 100 lines, from the
  [`y-webrtc`](https://github.com/yjs/y-webrtc) project.
- Stateless. It stores nothing on disk, keeps no database, and forgets
  everything when it restarts.
- Unaware of your content. It routes messages between clients subscribed
  to the same topic and never parses them.

The relay is **not**:

- A server for the application itself. The app is a fully static site.
- A place your documents live. Nothing is persisted anywhere except each
  participant's own browser.
- Authenticated. Anyone who can reach the relay can connect to it. See
  [Access control](#access-control) — this matters.

### What this means practically

Because the relay only carries the handshake, its load is negligible.
A single small container comfortably handles far more concurrent sessions
than most teams will ever have. It is also **not** a bottleneck for
document size or edit frequency, since neither passes through it.

The flip side: if the relay is down, **existing sessions keep working**
but nobody new can join, and a peer who reloads can't get back in.

## Running a relay

### Option 1: the published image

Every release publishes an image to GitHub Container Registry:

```bash
docker run -d --name relay -p 4444:4444 \
  ghcr.io/jbraunsmajr/system-design-relay:latest
```

The server listens on `4444` by default and reads `PORT` from the
environment if you need something else:

```bash
docker run -d --name relay -p 9000:9000 -e PORT=9000 \
  ghcr.io/jbraunsmajr/system-design-relay:latest
```

### Option 2: build it yourself

The image definition is in `docker/signaling/`. It's deliberately a
separate, minimal package from the main app — a signaling server has
nothing to do with React or Vite.

```bash
docker build -t my-relay ./docker/signaling
docker run -d -p 4444:4444 my-relay
```

### Option 3: no Docker

```bash
cd docker/signaling
npm install --omit=dev
PORT=4444 node node_modules/y-webrtc/bin/server.js
```

### Confirming it works

The server answers any plain HTTP GET with `okay`, which doubles as a
health check for uptime monitoring:

```bash
curl http://localhost:4444/          # -> okay
```

For a deeper check, this repo ships a script that starts a relay and
exercises the actual subscribe/publish protocol the app depends on,
including verifying that separate rooms don't leak into each other:

```bash
npx tsx scripts/verify-signaling-server.ts
```

## TLS

**If the app is served over HTTPS, the relay must be reachable over
`wss://`.** A browser on an HTTPS page will refuse to open a plain
`ws://` WebSocket as mixed content, and it does so quietly — you'll see a
console error and nothing else. This is the single most common reason a
correctly-running relay appears not to work.

The relay itself speaks plain WebSocket and has no TLS support. Put a
reverse proxy in front of it. Caddy handles both the certificate and the
WebSocket upgrade with no special configuration:

```caddyfile
relay.example.com {
    reverse_proxy 192.168.1.10:4444
}
```

That's genuinely all that's required. Caddy v2 detects and proxies
WebSocket upgrades automatically — no `Upgrade`/`Connection` header
plumbing, no `flush_interval`, no `Host` rewriting. The relay ignores
`X-Forwarded-*` headers entirely, so adding them buys nothing.

For nginx you do need the upgrade headers, and a generous read timeout so
long-lived connections aren't cut:

```nginx
location / {
    proxy_pass http://192.168.1.10:4444;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
```

The relay sends a WebSocket ping every 30 seconds and drops connections
that don't pong, so idle timeouts on intermediaries are usually not a
problem — but a proxy with a short read timeout can still sever
connections mid-session.

## Pointing the app at your relay

There are two places a relay URL can come from. They are checked in this
order:

1. **The user's own setting**, saved in their browser's `localStorage`
   under `system-design-editor:signaling-urls`. Set in the app via
   **Collaborate → Relay Server URL**.
2. **The deployment default**, baked in at build time from the
   `VITE_SIGNALING_URL` environment variable.

A user's saved setting always wins. There is no fallback to any public
infrastructure: if neither is set, collaboration is disabled with an
explanatory message rather than silently connecting somewhere you don't
control.

### Setting the deployment default

`VITE_SIGNALING_URL` is read at **build** time, not runtime, and inlined
into the JavaScript bundle:

```bash
VITE_SIGNALING_URL="wss://relay.example.com" npm run build
```

For GitHub Pages, add it to the build step in
`.github/workflows/deploy.yml`:

```yaml
      - run: npm run build
        env:
          VITE_SIGNALING_URL: ${{ vars.VITE_SIGNALING_URL }}
```

Use a repository **variable**, not a secret. The value is inlined into
publicly-served JavaScript, so a secret would be masked in the Actions
log and then published in the artifact anyway — creating the impression
of protection without any.

### Multiple relays

Both sources accept a comma-separated list:

```
wss://relay-a.example.com, wss://relay-b.example.com
```

Clients connect to all of them. Peers find each other as long as they
share **at least one** reachable relay, so this gives you redundancy
without any coordination between the relays themselves — they never talk
to each other.

### A caveat on changing the default

A user who has ever saved their own relay URL has a permanent override.
Changing `VITE_SIGNALING_URL` and redeploying will **not** move them. If
you need to migrate everyone, they have to clear the field in the app
(which restores the deployment default) or you have to tell them the new
URL.

## Access control

The relay has no authentication. The upstream source has a comment where
an auth check would go, and no check:

```js
server.on('upgrade', (request, socket, head) => {
    // You may check auth of request here..
})
```

Anyone who can reach the relay can subscribe to any topic, and **topics
are session codes**. Subscribing to a session code you know is enough to
join the peer mesh and read the document.

Mitigations, roughly in order of strength:

- **Network reachability.** The most effective control. A relay on an
  internal network, behind a VPN, or restricted by source IP in your
  reverse proxy is not reachable by strangers at all.
- **Session codes as secrets.** Generated codes are random; treat them
  like passwords and share them over a channel you trust.
- **Room passwords**, where available in your build. The room's contents
  are encrypted with a key derived from the password, so even a
  participant who reaches the relay cannot read the document without it.

Do not rely on the relay being obscure. If it has a public DNS name and a
certificate, assume it will be found.

## Restricted and air-gapped environments

The app is a fully static site with no runtime backend, so it can be
served from anywhere — including a plain nginx container inside an
isolated network. The bundle makes **no outbound HTTP requests**: fonts
are bundled, icons are bundled, and there are no CDN references.

WebRTC, however, has a dependency that isn't obvious.

### ICE servers (STUN and TURN)

To establish a direct peer connection, WebRTC gathers **ICE candidates**
— possible network paths between two browsers. The underlying library
ships with two public STUN servers configured by default:

```
stun:stun.l.google.com:19302
stun:global.stun.twilio.com:3478
```

**In an environment with no internet access, these are unreachable.**
What that costs you depends on your network:

| Situation | Works without STUN? |
|---|---|
| All users on the same flat LAN / subnet | **Yes.** Host candidates are sufficient — the browsers can see each other's local addresses directly. |
| Users across subnets, with routing between them | **Usually.** Depends on whether the routed addresses appear as host candidates. Test it. |
| Users behind NAT from each other | **No.** Requires STUN to discover external addresses, and often TURN to relay when a direct connection can't be made. |
| Users on different sites / VPN split tunnels | **No.** Requires TURN. |

Even in the cases that work, leaving unreachable STUN servers configured
is not free: every connection attempt waits for them to time out before
falling back to the host candidates that were sufficient all along.

#### Configuring them

ICE servers are configured exactly like the relay URL — a build-time
default, overridable per browser at runtime:

```bash
VITE_ICE_SERVERS="stun:stun.internal:3478" npm run build
```

or in the app under **Collaborate → ICE Servers**. The runtime setting
wins, and is stored under `system-design-editor:ice-servers`.

The format is a comma-separated list. TURN servers need credentials,
which follow the URL after pipes:

```
stun:stun.internal:3478
turn:turn.internal:3478|username|password
stun:stun.internal:3478, turn:turn.internal:3478|username|password
```

Pipe is the delimiter because RFC 7064/7065 don't permit it in a
STUN/TURN URI, so it can never appear inside the URL and never needs
escaping. A username given without a credential is discarded rather than
passed through — `RTCPeerConnection` rejects a half-specified server, and
failing at parse time is easier to trace back to a typo than failing at
connection time.

There are three meaningful states, and the difference between the last
two matters:

| Value | Result |
|---|---|
| unset / blank | The library's own defaults stay in place (public STUN). |
| `none` | **No ICE servers at all.** Host candidates only. |
| a list | Exactly those servers, replacing the defaults. |

`none` is the right answer for a single-site isolated deployment where
everyone shares a LAN. It is not a way of switching ICE off so much as a
statement that host candidates are all that is needed here — which is
true on a flat network, and makes those sessions connect promptly rather
than after a timeout.

For topologies that genuinely need TURN, run something like
[coturn](https://github.com/coturn/coturn) internally and point
`VITE_ICE_SERVERS` at it. Note that a TURN server, unlike the relay, does
carry your document traffic when it is used — it relays the media path
when peers can't connect directly. Host it accordingly.

### A checklist for an isolated deployment

1. Serve the app internally. The repository root has a `Dockerfile` and
   `docker/nginx.conf` for exactly this.
2. Build with your internal relay, and your ICE configuration, as the
   defaults:

   ```bash
   VITE_SIGNALING_URL="wss://relay.internal" \
   VITE_ICE_SERVERS="none" \
     npm run build
   ```

   Use `none` if every user is on one LAN; point it at an internal
   STUN/TURN server if they aren't. See
   [ICE servers](#ice-servers-stun-and-turn).
3. Run the relay somewhere reachable from every client.
4. Terminate TLS in front of it if the app is served over HTTPS — an
   internal CA is fine, as long as clients trust it.
5. Confirm two browsers on the target network can actually reach each
   other before rolling out. A quick session between two machines proves
   the whole path in a way no amount of configuration review does.

## Troubleshooting

Work down the layers; the first failure tells you where the problem is.

```bash
# 1. DNS — does the name resolve from a client machine?
dig +short relay.example.com

# 2. TLS and reachability — should print: okay
curl -v https://relay.example.com/

# 3. WebSocket upgrade — should print: Connected
npx wscat -c wss://relay.example.com

# 4. From the relay host, is the container actually up?
curl http://localhost:4444/
```

Common causes, in the order they actually occur:

- **`ws://` on an HTTPS page.** Blocked as mixed content, silently. Use
  `wss://`.
- **No scheme at all.** `relay.example.com` is not a valid URL here; it
  needs `wss://` or `ws://`.
- **A TLS alert during handshake** (`tlsv1 alert internal error` or
  similar) means the proxy has no certificate to present. That's a
  certificate issuance problem, not a relay problem — check your proxy's
  logs, not the relay's.
- **Internal DNS name, external users.** A relay that only resolves on
  your internal network is unreachable from a browser on the public
  internet, and vice versa.
- **Connects, but peers never see each other.** Confirm both users have
  exactly the same relay URL and the same session code. If your build
  supports room passwords, confirm the passwords match too — a mismatch
  is indistinguishable from an empty room, because the peers connect and
  then fail to decrypt each other's traffic.

If the relay is reachable but a session still doesn't sync, the problem
is almost certainly the peer connection rather than the relay — the two
fail independently, since the relay is how peers find each other and ICE
is how they reach each other. See
[ICE servers](#ice-servers-stun-and-turn) above.
