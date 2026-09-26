# The Relay Server

Live sessions need one small piece of infrastructure: a **relay** (a
signaling server). This page covers what it does, how to run it, how the
editor finds it, who can use it, and what changes on networks without
internet access.

Both deployment guides already include it - [Core](/deployment/core) and
[with Workspaces](/deployment/with-workspaces) - behind the same proxy as the
editor, at `wss://<your domain>/relay/`. This page is the reference behind
them.

---

## What the relay is and isn't

When two people open the same session, their browsers need a way to find
each other and exchange the handshake that establishes a direct WebRTC
connection. The relay carries that handshake. Once the peers are connected,
document data flows **directly between browsers** and the relay is no longer
in the path.

### The relay is:

- A single-purpose WebSocket server speaking the
  [`y-webrtc`](https://github.com/yjs/y-webrtc) signaling protocol. The
  published image runs this project's own implementation, which CI checks
  against y-webrtc's own server, so "the same protocol" is tested rather
  than assumed.
- Stateless. It stores nothing on disk, keeps no database, and forgets
  everything when it restarts.
- Unaware of your content. Session traffic is encrypted with the key in the
  session's link before it reaches the relay, and the relay never has that
  key.
- Optionally restricted to people who have signed in, where you also run a
  workspace. See [Who can use it](#who-can-use-it).

### The relay is not:

- A server for the editor itself, which is a static site.
- A place your documents live. It holds nothing.

### What this means practically

Because the relay only carries the handshake, its load is negligible. A
single small container comfortably handles far more concurrent sessions than
most teams will ever have, and it is **not** a bottleneck for document size
or edit frequency, since neither passes through it.

The flip side: if the relay is down, **existing sessions keep working** but
nobody new can join, and a peer who reloads can't get back in.

---

## Running it

```
ghcr.io/jbraunsmajr/system-design-relay:latest
```

| Variable                | Default   | Purpose                                                                                                              |
| :---------------------- | :-------- | :------------------------------------------------------------------------------------------------------------------- |
| `PORT`                  | `4444`    | The port it listens on inside the container.                                                                         |
| `RELAY_TOKEN_SECRET`    | _(unset)_ | Require a room token from the workspace store. See [Who can use it](#who-can-use-it). At least 32 random characters. |
| `RELAY_PING_TIMEOUT_MS` | `30000`   | How often it pings each connection; one that misses a ping is dropped, which keeps a room's peer list honest.        |

It answers one plain HTTP request, for health checks:

```bash
curl http://localhost:4444/health
# {"status":"ok","authentication":"none","rooms":0}
```

`authentication` is `required` when `RELAY_TOKEN_SECRET` is set; `rooms` is
how many sessions are currently open. Every other HTTP path answers 404 -
the relay's real work is WebSocket connections.

The image runs as an unprivileged user, writes nothing to its own
filesystem, and has a built-in health check on `/health`.

---

## TLS

::: warning HTTPS requirement
**If the editor is served over HTTPS, the relay must be reachable over
`wss://`.** A browser on an HTTPS page refuses to open a plain `ws://`
WebSocket as mixed content, and does so quietly - a console error and
nothing else. This is the single most common reason a correctly running
relay appears not to work.
:::

The relay speaks plain WebSocket and has no TLS of its own. Put a reverse
proxy in front of it.

**Behind the editor's own proxy, at a path** - what both deployment guides
do, with one certificate for everything:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

# inside the server { } block for your domain:
location /relay/ {
    proxy_pass http://relay:4444/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_read_timeout 1h;
    proxy_send_timeout 1h;
}
```

The trailing slashes strip `/relay/` before the request reaches the relay,
so `https://<domain>/relay/health` is the relay's `/health`. Point the editor
at `wss://<domain>/relay/` **with** the trailing slash: without it, nginx
answers with a redirect, which WebSocket clients do not follow.

**On a host of its own** - Caddy handles both the certificate and the
upgrade with no further configuration:

```caddyfile
relay.example.gov {
    reverse_proxy relay:4444
}
```

The relay ignores `X-Forwarded-*` headers, so adding them buys nothing.

The relay pings every connection every 30 seconds, so idle timeouts on
intermediaries are rarely a problem - but a proxy with a short read timeout
can still cut a session off mid-edit. Give it an hour.

---

## Pointing the editor at your relay

A relay URL can come from three places, checked in this order:

1. **The person's own setting**, saved in their browser under
   `system-design-editor:signaling-urls`. Set in the editor under
   **Collaborate → Settings → Relay server URL**.
2. **The deployment default**, from the editor container's `RELAY`
   variable (`RELAY_URL` and `SIGNALING_URL` also work):

   ```yaml
   editor:
     environment:
       RELAY: wss://design.example.gov/relay/
   ```

3. **A build-time default** (`VITE_SIGNALING_URL`), only for someone building
   the editor from source.

A person's saved setting always wins. There is no fallback to any public
infrastructure: if none is set, sessions are disabled with an explanatory
message, rather than silently connecting somewhere you don't control.

### Multiple relays

Every source accepts a comma-separated list:

```
wss://relay-a.example.gov, wss://relay-b.example.gov
```

Browsers connect to all of them, and find each other as long as they share
**at least one** reachable relay. That gives you redundancy with no
coordination between relays - they never talk to each other. (With
`RELAY_TOKEN_SECRET`, give every relay the same secret.)

### A caveat on changing the default

Someone who has ever saved their own relay URL has a permanent override.
Changing `RELAY` and restarting will **not** move them. To migrate everyone,
they clear the field in the editor (which restores the deployment default),
or you tell them the new URL.

---

## Who can use it

Two separate questions, with separate answers.

**Who can read a session?** Only people with its link. A session's link
carries a key; everything the session sends - through the relay and
directly between browsers - is encrypted with it, and neither the relay nor
the workspace store ever has it. This is always on. Someone who learns only a
session's room name can connect to the relay and see that the room exists,
and nothing more.

**Who can connect to the relay at all?** By default, anyone who can reach it.
That's fine where the relay is only reachable inside your network, and worth
restricting where it isn't. Three ways, roughly in order of strength:

1. **Network reachability.** A relay on an internal network, behind a VPN,
   or restricted by source address at your proxy is not reachable by
   strangers at all.
2. **Membership, with a workspace.** Set the same `RELAY_TOKEN_SECRET` on the
   relay and the [workspace store](/deployment/workspace-store). The store
   then issues a short-lived token for one room to someone it has signed in,
   and the relay refuses anyone without a valid one - including someone
   holding a token for a different room, or one that has expired.
   [Deployment with Workspaces](/deployment/with-workspaces) sets this up.
3. **Treat links as secrets.** Share them over a channel you trust. Anyone
   with a link can read the session, whatever the relay allows.

**Check membership took effect** rather than assuming so. Both must say
`required`:

```bash
curl https://design.example.gov/relay/health
# {"status":"ok","authentication":"required","rooms":0}

curl https://design.example.gov/store/v1/health
# {..., "relayAuthentication":"required"}
```

If the relay says `required` and the store says `none`, the secret reached
the relay but not the store: signed-in people will be refused too, because
nothing can issue them a token.

::: warning Relay images from v0.93.01 and earlier
They ran y-webrtc's own server, which ignores `RELAY_TOKEN_SECRET`: setting it
did nothing. Update the image, then check `/health`.
:::

Do not rely on the relay being obscure. If it has a public DNS name and a
certificate, assume it will be found.

---

## Restricted and air-gapped environments

The editor is a static site: it makes **no outbound requests** - fonts and
icons are bundled, and there are no CDN references - so it can be served
from anywhere inside an isolated network. (With workspaces, the store and
its database are on your network too.)

WebRTC, however, has a dependency that isn't obvious.

### ICE servers (STUN and TURN)

To establish a direct peer connection, WebRTC gathers **ICE candidates**

- possible network paths between two browsers. The underlying library
  ships with two public STUN servers configured by default:

```
stun:stun.l.google.com:19302
stun:global.stun.twilio.com:3478
```

**In an environment with no internet access, these are unreachable.**
What that costs you depends on your network:

| Situation                                       | Works without STUN?                                                                                                   |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| All users on the same flat LAN / subnet         | **Yes.** Host candidates are sufficient - the browsers can see each other's local addresses directly.                 |
| Users across subnets, with routing between them | **Usually.** Depends on whether the routed addresses appear as host candidates. Test it.                              |
| Users behind NAT from each other                | **No.** Requires STUN to discover external addresses, and often TURN to relay when a direct connection can't be made. |
| Users on different sites / VPN split tunnels    | **No.** Requires TURN.                                                                                                |

Even in the cases that work, leaving unreachable STUN servers configured
is not free: every connection attempt waits for them to time out before
falling back to the host candidates that were sufficient all along.

#### Configuring them

ICE servers are configured exactly like the relay URL: a deployment
default from the editor container's `ICE_SERVERS` variable, overridable per
browser under **Collaborate → Settings → ICE servers**. A browser's own
setting wins, and is stored under `system-design-editor:ice-servers`.

```yaml
editor:
  environment:
    ICE_SERVERS: stun:stun.internal:3478
```

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
passed through - `RTCPeerConnection` rejects a half-specified server, and
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
`ICE_SERVERS` at it. [Networks without direct paths](/deployment/self-host#networks-without-direct-paths)
has a ready-to-copy coturn setup.

### A checklist for an isolated deployment

1. Follow [Core](/deployment/core) or [with Workspaces](/deployment/with-workspaces)
   on a host inside the network. The images can be pulled elsewhere and
   loaded with `docker save` / `docker load` if the host has no registry
   access.
2. Set the editor's `ICE_SERVERS`: `none` if everyone shares one LAN, or your
   internal STUN/TURN server if they don't.
3. Make sure every client can reach the relay's address.
4. Confirm two browsers on the target network can actually connect before
   rolling out: start a session in one, open its link in the other.

---

## Troubleshooting

Work down the layers; the first failure tells you where the problem is.

```bash
# 1. DNS - does the name resolve from a client machine?
dig +short design.example.gov

# 2. TLS, the proxy and the relay - should print {"status":"ok",...}
curl https://design.example.gov/relay/health

# 3. From the host, bypassing the proxy - should print the same
docker compose exec relay wget -qO- http://localhost:4444/health

# 4. The WebSocket upgrade itself - should print "Connected"
npx wscat -c wss://design.example.gov/relay/
```

Common causes:

| Symptom                                         | Likely cause                                                                                                            |
| :---------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| Step 2 fails, step 3 works                      | The proxy: its WebSocket settings, or the path.                                                                         |
| `curl` works, the editor never connects         | `ws://` on an HTTPS page, blocked silently. Use `wss://`.                                                               |
| The editor connects, then drops within a minute | A proxy read timeout shorter than the session.                                                                          |
| Signed-in people cannot join a session          | The relay requires tokens and the store cannot issue them. Check both `/health` responses (above).                      |
| Connected, but people never see each other      | They are using different relays, or a network that blocks direct paths - see [ICE servers](#ice-servers-stun-and-turn). |
| `relay.example.gov` rejected as a URL           | No scheme. Relay URLs start with `wss://` or `ws://`.                                                                   |
