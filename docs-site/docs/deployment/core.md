# Core Deployment

The editor, relay, and coturn services - everything needed for people to draw, save to
their browsers and files, and edit together in live sessions. Coturn provides a
TURN/STUN fallback mechanism required for any user operating out of restrictive networks
such as convention centers or hotel wifi. Nothing is
stored on your server: documents live in each person's browser.

If you want shared team storage and sign-in as well, follow
[Deployment with Workspaces](/deployment/with-workspaces) instead. You can
start here and move to that later without losing anything.

**You'll end up with**

```
https://design.example.gov/          the editor
https://design.example.gov/docs/     this documentation, served by the editor
wss://design.example.gov/relay/      the relay, for live sessions
turn:design.example.gov:3478         coturn, TURN fallback for restrictive networks
```

## 1. Before you start

You need:

- A host with **Docker** and **Docker Compose** (v2 - the `docker compose`
  command).
- **A name for it** in DNS, such as `design.example.gov`, pointing at the host.
- **A TLS certificate and key** for that name. Browsers only allow live
  sessions over HTTPS. Your organization's CA, or Let's Encrypt, both work.
- Ports **80** and **443** open for web traffic and live sessions.
- Port **3478** (TCP and UDP) and the relay range (UDP **49160–49200**) open on the host for coturn (TURN/STUN fallback).

## 2. Create a folder with four files

```bash
mkdir system-design && cd system-design
mkdir certs
```

Create each of these files in that folder, exactly as shown.

::: code-group

```yaml [compose.yml]
<!--@include: @/files/core/compose.yml -->
```

```nginx [nginx.conf]
<!--@include: @/files/core/nginx.conf -->
```

```ini [.env]
<!--@include: @/files/core/core.env -->
```

```ini [turnserver.conf]
<!--@include: @/files/core/turnserver.conf -->
```

:::

::: tip The file is named `.env`
With the leading dot. Docker Compose reads it automatically from the folder
you run it in.
:::

## 3. Set your domain and TURN secret

Edit `.env` and set `DOMAIN` to your name:

```ini
DOMAIN=design.example.gov
```

Leave `VERSION=latest` to follow releases, or set a release date such as `2026-09-21` to pin one.

Then replace `CHANGEME-long-random-string` with a strong random secret in both `.env` and `turnserver.conf`:

```ini
# in .env
ICE_SERVERS=turn:design.example.gov:3478|webrtc|CHANGEME-long-random-string
```

```ini
# in turnserver.conf
user=webrtc:CHANGEME-long-random-string
```

This ensures that users behind restrictive networks (such as hotel Wi-Fi, convention centers, or strict corporate firewalls) can seamlessly establish WebRTC connections via the coturn fallback relay.

## 4. Add your certificate

Copy your certificate and key into `certs/`, named:

```
certs/fullchain.pem    the certificate, followed by any intermediates
certs/privkey.pem      its private key
```

::: details Just trying it out? A self-signed certificate

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
  -keyout certs/privkey.pem -out certs/fullchain.pem \
  -subj "/CN=design.example.gov"
```

Browsers will warn about it, and live sessions may refuse to connect until
you accept it. Use a real certificate for anything people depend on.
:::

## 5. Start it

```bash
docker compose up -d
```

The first start downloads the images. After that it takes seconds.

## 6. Check it works

```bash
curl https://design.example.gov/relay/health
# {"status":"ok","authentication":"none","rooms":0}
```

Then open `https://design.example.gov` in a browser. You should see the
editor; the book icon in the toolbar opens this documentation from your own
server.

To check live sessions, open the editor in two browsers, start a session in
one (**Collaborate → Start a new session**), and open its link in the other.

## Keeping it running

| Task                         | Command                                       |
| :--------------------------- | :-------------------------------------------- |
| See what is running          | `docker compose ps`                           |
| Read the logs                | `docker compose logs -f`                      |
| Update to the newest release | `docker compose pull && docker compose up -d` |
| Stop everything              | `docker compose down`                         |

There is nothing to back up: this deployment stores no documents.

## If something goes wrong

**The page loads but live sessions never connect.** The browser reached the
editor but not the relay. Check `curl https://<your domain>/relay/health`
answers; if it does, the network between the people in the session may be
blocking direct connections - see
[Networks without direct paths](/deployment/self-host#networks-without-direct-paths).

**nginx will not start.** `docker compose logs proxy` names the line. Usually
it's the certificate: both files must exist in `certs/` with those names.

**The browser warns about the certificate.** The certificate does not match
`DOMAIN`, or it is self-signed.
