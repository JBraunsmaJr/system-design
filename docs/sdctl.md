# System Design Editor — `sdctl` Operations Guide

`sdctl` is the self-contained installer and operations tool for deploying, configuring, verifying, and maintaining the System Design Editor stack across public, enterprise, and air-gapped environments.

---

## 1. Overview & Architecture

`sdctl` manages the sibling container lifecycle on the host via Docker Compose. It eliminates cross-component configuration errors by generating deterministic configuration artifacts from a declarative specification (`deployment.yaml`).

```
                    ┌────────────────────────────┐
                    │      sdctl container       │
                    │   (system-design-installer)│
                    └─────────────┬──────────────┘
                                  │ /var/run/docker.sock
                                  ▼
                    ┌────────────────────────────┐
                    │     Host Docker Daemon     │
                    └─────────────┬──────────────┘
            ┌─────────────────────┼─────────────────────┐
            ▼                     ▼                     ▼
┌───────────────────────┐ ┌───────────────┐ ┌───────────────────────┐
│     Proxy (Caddy)     │ │ Relay Server  │ │  Editor SPA (nginx)   │
│  HTTPS / WSS Gateway  │ │  (y-webrtc)   │ │  Static Asset Host    │
└───────────────────────┘ └───────────────┘ └───────────────────────┘
```

---

## 2. Building & Invocation

### Building the Installer Container

```bash
docker build -f docker/installer/Dockerfile -t ghcr.io/jbraunsmajr/system-design-installer:0.1.0 .
```

### Running with Docker (Recommended)

Run `sdctl` with the host Docker socket and working directory mounted at the same absolute path:

```bash
docker run -it --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v $(pwd):$(pwd) \
  -w $(pwd) \
  ghcr.io/jbraunsmajr/system-design-installer:0.1.0 <command> [flags]
```

### Local Development / Node CLI

```bash
npx tsx sdctl/bin/sdctl.ts <command> [flags]
# or
npm run sdctl -- <command> [flags]
```

---

## 3. Command Reference

### `sdctl init`

Initializes a new deployment configuration interactively or non-interactively.

```bash
# Interactive setup wizard
sdctl init

# Non-interactive initialization via answers file (CI)
sdctl init --answers answers.yaml

# Non-interactive quick local evaluation defaults
sdctl init --yes
```

**Flags:**

- `--answers <file>`: Load deployment choices from a YAML/JSON answers file.
- `--yes`, `-y`: Non-interactive mode using default evaluation settings.
- `--registry <prefix>`: Prefix image references with an internal or custom registry (e.g., `registry.internal:5000/sd`).
- `--output json|text`: Output format.

---

### `sdctl validate`

Validates `deployment.yaml` against the schema and reports path-level errors with suggested remediations.

```bash
sdctl validate
sdctl validate --spec /path/to/deployment.yaml --output json
```

---

### `sdctl preflight`

Performs non-destructive environment and artifact validation before any services are started or changed.

```bash
# Run all preflight checks
sdctl preflight

# Bypass specific check IDs if running in custom environment
sdctl preflight --force PRE-HOST-SOCK,PRE-TLS-CERTS

# Machine-readable JSON report
sdctl preflight --output json
```

**Preflight Checks:**

| Check ID          | Description                                                      | Remediation                                                                            |
| ----------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `PRE-HOST-SOCK`   | Checks Docker/Podman socket availability                         | Mount `/var/run/docker.sock` into the container                                        |
| `PRE-HOST-MOUNT`  | Verifies working directory mount parity                          | Ensure host and container working directory paths match (`-v $(pwd):$(pwd) -w $(pwd)`) |
| `PRE-CFG-SPEC`    | Validates `deployment.yaml` schema                               | Correct reported YAML fields according to `sdctl validate`                             |
| `PRE-REG-DIGESTS` | Validates release manifest image SHA-256 digests                 | Ensure release manifest contains valid immutable digests                               |
| `PRE-TLS-CERTS`   | Validates custom TLS certificate, key matching, SANs, and expiry | Check certificate paths, match private key, and renew if <30 days to expiry            |
| `PRE-TLS-DNS`     | Validates DNS-01 ACME credentials (e.g. Cloudflare API token)    | Set `CLOUDFLARE_API_TOKEN` in environment or `secrets.env`                             |

---

### `sdctl generate`

Generates all derived configuration files from `deployment.yaml` and release manifest without modifying running containers.

```bash
sdctl generate
```

**Generated Artifacts:**

- `compose.yaml`: Docker Compose stack definition pinned by digest.
- `Caddyfile`: Reverse proxy TLS, WSS routing, and CIDR allowlist rules (when TLS mode is `acme`, `acme-dns`, or `provided`).
- `turnserver.conf`: Coturn STUN/TURN server configuration (when TURN is enabled).
- `secrets.env`: Isolated credentials with restricted permissions.

---

### `sdctl plan`

Displays a structured diff comparing the desired state (`deployment.yaml` + release manifest) against the current running revision.

```bash
sdctl plan
sdctl plan --output json
```

**Detected Differences:**

- Component additions and removals (e.g. proxy, coturn).
- Pinned image reference and digest changes.
- Environment variables (`PUBLIC_RELAY_URL`, `PUBLIC_ICE_SERVERS`).
- Exposed container ports.
- Reverse proxy TLS modes and routing rules.

---

### `sdctl apply`

Renders configuration files, pulls images by immutable digest, brings up sibling containers via Compose, and runs post-apply verification.

```bash
# Apply desired deployment state and verify
sdctl apply

# Apply with automatic rollback on verification failure
sdctl apply --auto-rollback

# Skip live service verification suite
sdctl apply --skip-verify

# Bypass preflight check failures
sdctl apply --force PRE-HOST-SOCK,PRE-HOST-MOUNT
```

**Workflow & Safety:**

1. Runs preflight checks (aborts if checks fail, unless bypassed with `--force`).
2. Calculates plan difference.
3. Renders `compose.yaml`, `Caddyfile`, `turnserver.conf`, and `secrets.env`.
4. Brings up services via Docker Compose.
5. Records applied revision in `.sdctl/state.json`.
6. Prints client diagnostics URL (`https://<host>/diag.html`) and test code.
7. Executes layered verification; automatically triggers rollback if `--auto-rollback` is active and verification fails.

---

### `sdctl upgrade`

Upgrades an active deployment to the release manifest carried by the installer image.

```bash
# Upgrade to installer version with automatic schema migration and rollback protection
sdctl upgrade

# Force upgrade bypassing host checks
sdctl upgrade --force PRE-HOST-SOCK
```

**Safety Guarantees:**

- Refuses versions below the manifest's declared `minUpgradeFrom` version.
- Prohibits downgrades (downgrades must be executed via `sdctl rollback`).
- Automatically creates `deployment.yaml.bak` before schema migration.
- Warns operators if `RELAY` or `ICE_SERVERS` endpoints have changed to alert users with custom browser overrides.
- Performs preflight, plan, apply, and post-upgrade verification with automatic rollback enabled by default.

---

### `sdctl rollback`

Restores configuration artifacts, image digests, and runtime services to a prior known-good revision.

```bash
# Roll back to the immediately preceding revision
sdctl rollback

# Roll back to a specific recorded revision number
sdctl rollback --to 2
```

---

### `sdctl status`

Displays the current deployment revision, active configuration hash, and revision history.

```bash
sdctl status
sdctl status --output json
```

---

### `sdctl verify`

Executes layered verification against live services, probing endpoints internally and externally.

```bash
# Verify live deployment in layered sequence
sdctl verify

# Run all checks regardless of earlier layer failures
sdctl verify --all

# Await browser client diagnostics reports
sdctl verify --await-clients 2 --timeout-sec 45

# Verify external deployment with explicit endpoints
sdctl verify --editor-url https://editor.example.com --relay-url wss://relay.example.com
```

**Verification Layers:**

1. **Layer 1 (Host & Socket)**: Docker daemon reachability and mount integrity (`L1-HOST-SOCK`, `L1-HOST-MOUNT`).
2. **Layer 2 (Artifacts & Spec)**: Compose definition and profile consistency (`L2-CFG-COMPOSE`, `L2-SPEC-PROFILE`).
3. **Layer 3 (Edge & Endpoints)**: Public HTTP reachability, status codes, and TLS validation (`L3-EDGE-EDITOR-HTTP`).
4. **Layer 4 (Relay Protocol)**: WebSocket handshake, publish/subscribe delivery, topic isolation, and byte-for-byte message integrity (`L4-RELAY-HANDSHAKE`, `L4-RELAY-PUBSUB`, `L4-RELAY-INTEGRITY`, `L4-RELAY-ISOLATION`).
5. **Layer 5 (Client Diagnostics)**: Collection of browser diagnostic test reports via relay topic (`L5-CLIENT-DIAG-AWAIT`).

---

## 4. Client-Side Diagnostics (`/diag.html`)

The editor image includes a standalone diagnostics tool accessible at `/diag.html`. It tests WebRTC from the user's browser without external dependencies.

### Capabilities

- **Mixed Content Check**: Detects unsafe `ws://` relay URLs on `https://` origins.
- **Relay WebSocket Probe**: Tests WebSocket handshake and measures latency to the signaling relay.
- **ICE Candidate Gathering**: Tests STUN/TURN candidate discovery (`host`, `srflx`, `relay`) and flags slow or unreachable ICE servers.
- **Peer-to-Peer DataChannel Test**: Performs WebRTC data channel negotiation and latency measurement.
- **Automated Report Publishing**: Emits test reports to topic `sdctl-diag-report-<code-or-room>` to integrate with `sdctl verify --await-clients`.

---

## 5. Exit Codes

| Exit Code | Meaning                                                         |
| --------- | --------------------------------------------------------------- |
| `0`       | Success / All checks passed                                     |
| `1`       | Validation error, preflight failure, or verification failure    |
| `2`       | Configuration / command-line argument error                     |
| `126`     | Environment or permission error (e.g. Docker socket unreadable) |
