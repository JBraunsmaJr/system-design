# Self Hosted Compose

This guide walks through deploying the System Design Editor stack using Docker Compose. The platform consists of two primary services and one optional service:

- **Editor**: Static web application and canvas UI served through an Nginx container.
- **Relay**: Lightweight WebSocket signaling server for real-time peer-to-peer WebRTC collaboration.
- **Workspace Store (Optional)**: Central encrypted storage service for shared team workspaces and documents.

::: warning HTTPS/WSS Requirement
Browsers require WebRTC signaling on secure origins (`https://`) to use secure WebSockets (`wss://`). Ensure your
reverse proxy terminates TLS for both the editor and the relay.
:::

```yaml
<!--@include: @/files/deployment.compose.yml -->
```

::: details Nginx Sample Configuration
`nginx.conf`

```conf
<!--@include: @/files/nginx.conf -->
```

:::

::: details Environment Variable Example

```env
<!--@include: @/files/example.env -->
```

:::

## Editor & Relay Environment Variables

| Variable      | Primary / Purpose              | Example                        | Description                                                           |
| :------------ | :----------------------------- | :----------------------------- | :-------------------------------------------------------------------- |
| `RELAY`       | **Primary (Signaling URL)**    | `wss://relay.example.com`      | Default WebSocket URL for the WebRTC signaling relay.                 |
| `APP_URL`     | **Primary (Base URL)**         | `https://design.example.com`   | Public base URL used when generating shareable session links.         |
| `STORE_URL`   | **Optional (Workspace Store)** | `https://store.example.com`    | Public URL of the workspace store service for shared team workspaces. |
| `ICE_SERVERS` | **Primary (STUN/TURN)**        | `stun:stun.l.google.com:19302` | Comma-separated list of STUN/TURN server URLs for NAT traversal.      |

---

## Adding the Workspace Store

By default, documents live entirely inside the user's browser, and collaboration takes place directly between peers over WebRTC. Adding the optional **Workspace Store** provides persistent team workspaces, cross-device document synchronization, and version history while maintaining zero-knowledge encryption.

### Container Images

The store image is published alongside the editor and relay:

```
ghcr.io/jbraunsmajr/system-design-store:latest
ghcr.io/jbraunsmajr/system-design-store:<yyyy-mm-dd>
```

### Requirements

To self-host the store, you will need:
- **PostgreSQL 16 or later**: The store automatically applies its database schema on initial startup.
- **An Identity Provider (IdP)**: Any OIDC-compliant provider (Keycloak, Entra ID, Okta, Auth0, GitLab, Google) or GitHub OAuth.
- **A Recovery Keypair**: Generated prior to running the store for the first time.
- **HTTPS**: Required for cross-origin cookie authentication between the editor and store.

### Store Environment Configuration

The store reads its configuration from environment variables:

| Variable                   | Required | Purpose                                                                            |
| :------------------------- | :------- | :--------------------------------------------------------------------------------- |
| `PUBLIC_URL`               | yes      | Public URL where users and identity providers reach the store.                     |
| `DATABASE_URL`             | yes      | PostgreSQL connection string (`postgresql://user:pass@host:5432/store`).           |
| `ALLOWED_ORIGINS`          | yes      | Exact origins where the editor is hosted (e.g. `https://design.example.com`).     |
| `AFTER_LOGIN_URL`          | no       | Where to redirect users after sign-in (defaults to the first editor origin).       |
| `AUTH_PROVIDERS`           | yes      | Authentication providers enabled (`oidc`, `github`, or both).                      |
| `OIDC_ISSUER`              | w/ oidc  | Public issuer URL as seen by the browser.                                          |
| `OIDC_INTERNAL_URL`        | optional | Internal issuer URL reachable from within container networks.                      |
| `OIDC_CLIENT_ID`          | w/ oidc  | Client ID configured in your IdP.                                                  |
| `OIDC_CLIENT_SECRET`      | w/ oidc  | Client Secret configured in your IdP.                                              |
| `RECOVERY_PUBLIC_KEY_FILE` | yes      | Path to the organization's recovery **public** key PEM file.                       |
| `ADMIN_SUBJECTS`           | no       | `issuer#subject` of administrators authorized to manage legal holds and purges.   |
| `RETENTION_PERIOD`         | no       | Soft deletion retention duration (e.g. `30d`, `90d`, `indefinite`). Default `30d`. |
| `RELAY_TOKEN_SECRET`       | no       | Shared secret with the relay to restrict room access to authenticated users.       |

### Compose Example with Store

A complete, working reference compose configuration with the Editor, Relay, Store, PostgreSQL, and Keycloak is located in [`docker/store/compose.yaml`](https://github.com/jbraunsmajr/system-design/blob/main/docker/store/compose.yaml) in the repository.

```yaml
services:
  store:
    image: ghcr.io/jbraunsmajr/system-design-store:latest
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      PORT: 8080
      PUBLIC_URL: https://store.example.com
      DATABASE_URL: postgresql://store:${POSTGRES_PASSWORD}@postgres:5432/store
      ALLOWED_ORIGINS: https://design.example.com
      AFTER_LOGIN_URL: https://design.example.com
      AUTH_PROVIDERS: oidc
      OIDC_ISSUER: https://idp.example.com/realms/system-design
      OIDC_CLIENT_ID: system-design-store
      OIDC_CLIENT_SECRET: ${OIDC_CLIENT_SECRET}
      RECOVERY_PUBLIC_KEY_FILE: /run/secrets/recovery-public.pem
      RETENTION_PERIOD: 30d
    volumes:
      - ./keys/recovery-public.pem:/run/secrets/recovery-public.pem:ro
    ports:
      - '8080:8080'
```

For full details on IdP setup, token exchange, and legal hold administration, refer to the [Workspace Store Guide](/deployment/workspace-store) and [Administering a Workspace](/deployment/administration).

---

## Setting Up the Recovery Key using Docker

In default encrypted operation (`webcrypto`), document payloads are encrypted in the client browser. In addition to user workspace keys, each document is escrowed to the organization's **recovery public key**. This ensures that the organization can restore access if workspace keys are lost or all member devices become inaccessible.

::: warning Recovery Key Requirement
**The store deliberately refuses to accept documents if encryption is enabled without a configured recovery key.** Generate the keypair before storing your first document.
:::

### 1. Generate the Keypair

Run the key generation tool using the official store container image on a secure administration machine (outside the public server environment):

```bash
# Create a local directory for keys
mkdir -p ./keys

# Generate the recovery key pair using the store container
docker run --rm \
  -u $(id -u):$(id -g) \
  -v ./keys:/keys \
  ghcr.io/jbraunsmajr/system-design-store:latest \
  generate-recovery-key --out /keys/recovery
```

*(On Windows PowerShell, replace `-v ./keys:/keys` with `-v ${PWD}/keys:/keys` and omit the `-u` flag).*

This command creates two files inside `./keys`:
- **`recovery-public.pem`**: The organization's recovery **public** key.
- **`recovery-private.pem`**: The organization's recovery **private** key.

### 2. Configure the Public Key on the Store

Mount `recovery-public.pem` into the store container and point `RECOVERY_PUBLIC_KEY_FILE` to its mounted path:

```yaml
store:
  image: ghcr.io/jbraunsmajr/system-design-store:latest
  environment:
    RECOVERY_PUBLIC_KEY_FILE: /run/secrets/recovery-public.pem
  volumes:
    - ./keys/recovery-public.pem:/run/secrets/recovery-public.pem:ro
```

Alternatively, inject the PEM contents directly via the `RECOVERY_PUBLIC_KEY` environment variable if using a secret management service.

### 3. Store the Private Key Offline

- Keep `recovery-private.pem` **strictly offline** in secure custody (e.g. encrypted physical backup or hardware security module).
- **Do not** store the private key on the production server or in database backups.
- The server never requires the private key during normal operations.

### 4. Disaster Recovery / Document Recovery

If access to workspace keys is lost, encrypted document packages exported from backups can be decrypted offline using the private key and the store Docker image:

```bash
docker run --rm \
  -u $(id -u):$(id -g) \
  -v ./keys:/keys \
  -v ./backups:/backups \
  ghcr.io/jbraunsmajr/system-design-store:latest \
  recover-document \
    --key /keys/recovery-private.pem \
    --package /backups/document.json \
    --out /backups/recovered.json
```

---

::: details Air Gapped Deployment
Air-gapped networks will need a TURN server. This is required for WebRTC to function in such an environment.
Use the snippets below to add the TURN service.

```yaml
<!--@include: @/files/turnserver.compose.yml -->
```

`turnserver.conf`

```conf
<!--@include: @/files/turnserver.conf -->
```

:::

::: tip Subpath Hosting
The Docker container is built with relative base paths (`--base=./`). It can be served from any domain root
(`https://example.com/`) or subpath (`https://example.com/system-design/`) without rebuilding. Set `APP_URL` to the
full public URL so shared session links format correctly.
:::

::: tip Caching
Nginx inside the container automatically configures:

`assets/*` - Long-term immutable caching (`Cache-Control: public, immutable`).
`index.html` & `env-config.js` - Revalidated on every request (`Cache-Control: no-cache`).
:::

## Documentation in the container

This documentation is built into the image and served at **`/docs/`**
alongside the editor, so a deployment carries its own copy and needs no
internet access to read it.

The path is applied when the container starts, not when the image is built,
so one image works anywhere:

| Setting | Result |
| :--- | :--- |
| Nothing set | Docs at `/docs/` |
| `APP_URL=https://example.gov/system-design/` | Docs at `/system-design/docs/` |
| `DOCS_BASE=/help/` | Docs at `/help/` |

`DOCS_BASE` wins where both are set. A value without a leading or trailing
slash is corrected rather than rejected.

::: details Why this is not a relative path like the editor's
The editor is built with a relative base, so a single build resolves its
assets against wherever `index.html` was loaded from. VitePress cannot do
that: it writes absolute asset URLs and hands its own client router a base
to compare against the address bar. Getting it wrong is confusing rather
than obviously broken — the page loads, then the router rewrites the URL to
the path the build assumed. So the image is built with a placeholder, and
the entrypoint replaces it with the path you are actually serving from.
:::
