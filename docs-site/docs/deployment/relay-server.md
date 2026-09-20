# The Relay Server

Collaborative editing needs one small piece of infrastructure: a **relay**
(a signaling server). This document covers what it does, how to run one,
how to point the app at it, and what changes when your users have no
access to the public internet.

---

## What the relay is and isn't

When two people open the same session, their browsers need a way to find
each other and exchange the handshake that establishes a direct WebRTC
connection. The relay is what carries that handshake. Once the peers are
connected, document data flows **directly between browsers** and the
relay is no longer in the path.

### The relay is:

- A single-purpose WebSocket server, about 100 lines, from the
  [`y-webrtc`](https://github.com/yjs/y-webrtc) project.
- Stateless. It stores nothing on disk, keeps no database, and forgets
  everything when it restarts.
- Unaware of your content. It routes messages between clients subscribed
  to the same topic and never parses them.

### The relay is not:

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

## TLS

::: warning HTTPS Requirement
**If the app is served over HTTPS, the relay must be reachable over `wss://`.**
A browser on an HTTPS page will refuse to open a plain `ws://` WebSocket as mixed content, and it does so quietly — you'll see a console error and nothing else. This is the single most common reason a correctly-running relay appears not to work.
:::

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

---

## Pointing the app at your relay

There are two places a relay URL can come from. They are checked in this
order:

1. **The user's own setting**, saved in their browser's `localStorage`
   under `system-design-editor:signaling-urls`. Set in the app via
   **Collaborate → Relay Server URL**.
2. **The deployment default**, baked in at build time from the
   `VITE_SIGNALING_URL` environment variable (or injected via container config).

A user's saved setting always wins. There is no fallback to any public
infrastructure: if neither is set, collaboration is disabled with an
explanatory message rather than silently connecting somewhere you don't
control.

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

---

## Access control

The relay has no authentication. The upstream source has a comment where
an auth check would go, and no check:

```js
server.on('upgrade', (request, socket, head) => {
  // You may check auth of request here..
});
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

---

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

| Situation                                       | Works without STUN?                                                                                                   |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| All users on the same flat LAN / subnet         | **Yes.** Host candidates are sufficient — the browsers can see each other's local addresses directly.                 |
| Users across subnets, with routing between them | **Usually.** Depends on whether the routed addresses appear as host candidates. Test it.                              |
| Users behind NAT from each other                | **No.** Requires STUN to discover external addresses, and often TURN to relay when a direct connection can't be made. |
| Users on different sites / VPN split tunnels    | **No.** Requires TURN.                                                                                                |

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

There are three meaningful states:

| Value         | Result                                                  |
| ------------- | ------------------------------------------------------- |
| unset / blank | The library's own defaults stay in place (public STUN). |
| `none`        | **No ICE servers at all.** Host candidates only.        |
| a list        | Exactly those servers, replacing the defaults.          |

`none` is the right answer for a single-site isolated deployment where
everyone shares a LAN. It makes those sessions connect promptly rather
than after a timeout.

For topologies that genuinely need TURN, run something like
[coturn](https://github.com/coturn/coturn) internally and point
`VITE_ICE_SERVERS` at it.

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
   STUN/TURN server if they aren't.

3. Run the relay somewhere reachable from every client.
4. Terminate TLS in front of it if the app is served over HTTPS.
5. Confirm two browsers on the target network can actually reach each
   other before rolling out.

---

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

Common causes:

- **`ws://` on an HTTPS page**: Blocked as mixed content, silently. Use `wss://`.
- **No scheme at all**: `relay.example.com` is not valid; specify `wss://` or `ws://`.
- **A TLS alert during handshake**: Certificate issuance issue on your proxy.
- **Internal DNS name, external users**: Unreachable across network boundaries.
- **Connects, but peers never see each other**: Verify relay URL and session code match.
