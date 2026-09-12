# Container Configuration & Deployment

This document describes how to configure, run, and deploy the containerized **System Design Editor** web application.

---

### Overview

The System Design Editor container image is a lightweight Nginx web server packaging the pre-built, static single-page application (SPA).

- **Base Image:** `nginx:stable-alpine`
- **Port:** `80` (HTTP)
- **Runtime Configuration:** Environment variables are injected on container startup via `/docker-entrypoint.d/40-env-config.sh` into `window.__APP_CONFIG__` (`/usr/share/nginx/html/env-config.js`).

---

### Environment Variables

To minimize deployment complexity, standard environment variables are provided with clear primary names.

| Variable      | Primary / Purpose           | Example                        | Description                                                      |
|:--------------|:----------------------------|:-------------------------------|:-----------------------------------------------------------------|
| `RELAY`       | **Primary (Signaling URL)** | `wss://relay.example.com`      | Default WebSocket URL for the WebRTC signaling relay.            |
| `APP_URL`     | **Primary (Base URL)**      | `https://design.example.com`   | Public base URL used when generating shareable session links.    |
| `ICE_SERVERS` | **Primary (STUN/TURN)**     | `stun:stun.l.google.com:19302` | Comma-separated list of STUN/TURN server URLs for NAT traversal. |

#### Aliases & Fallback Resolution

To prevent silent failures and accommodate different naming conventions across container platforms and build environments, the container resolves variables in the following prioritized order:

1. **Signaling / Relay:** `RELAY` &rarr; `RELAY_URL` &rarr; `SIGNALING_URL` &rarr; `VITE_SIGNALING_URL`
2. **App Base URL:** `APP_URL` &rarr; `BASE_URL` &rarr; `VITE_APP_URL`
3. **ICE / STUN / TURN:** `ICE_SERVERS` &rarr; `VITE_ICE_SERVERS`

> **Best Practice:** When writing new Docker run scripts, Docker Compose files, or Kubernetes manifests, use the primary variables (`RELAY`, `APP_URL`, `ICE_SERVERS`).

---

### Quick Start

#### 1. Docker CLI

Run the editor and point it to an existing relay:

```bash
docker run -d \
  --name system-design-editor \
  -p 8080:80 \
  -e RELAY="wss://relay.example.com" \
  -e APP_URL="https://design.example.com" \
  ghcr.io/jbraunsmajr/system-design:latest
```

Open `http://localhost:8080` in your browser.

---

#### 2. Docker Compose (Editor + Relay)

To run both the editor and a dedicated signaling relay together:

```yaml
services:
  editor:
    image: ghcr.io/jbraunsmajr/system-design:latest
    container_name: system-design-editor
    ports:
      - "8080:80"
    environment:
      # If accessed directly by the browser:
      - RELAY=ws://localhost:4444
      - APP_URL=http://localhost:8080
    restart: unless-stopped
    depends_on:
      - relay

  relay:
    image: ghcr.io/jbraunsmajr/system-design-relay:latest
    container_name: system-design-relay
    ports:
      - "4444:4444"
    restart: unless-stopped
```

Start the stack:
```bash
docker compose up -d
```

---

### Production & Reverse Proxy Deployment

When deploying behind a reverse proxy (e.g., Nginx, Caddy, Traefik, AWS ALB, Cloudflare):

1. **HTTPS / WSS Requirement:** Browsers require WebRTC signaling on secure origins (`https://`) to use secure WebSockets (`wss://`). Ensure your reverse proxy terminates TLS for both the editor and the relay.
2. **Subpath Hosting:** The Docker container is built with relative base paths (`--base=./`). It can be served from any domain root (`https://example.com/`) or subpath (`https://example.com/system-design/`) without rebuilding. Set `APP_URL` to the full public URL so shared session links format correctly.
3. **Caching:** Nginx inside the container automatically configures:
   - `assets/*` &rarr; Long-term immutable caching (`Cache-Control: public, immutable`).
   - `index.html` & `env-config.js` &rarr; Revalidated on every request (`Cache-Control: no-cache`).

---

### Build-Time Configuration (Alternative)

If you are building the static assets directly with `npm run build` rather than using the pre-built Docker runtime entrypoint:

```bash
VITE_SIGNALING_URL="wss://relay.example.com" \
VITE_APP_URL="https://design.example.com" \
npm run build
```
