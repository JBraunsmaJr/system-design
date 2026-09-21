# Self Hosted Compose

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

| Variable      | Primary / Purpose           | Example                        | Description                                                      |
| :------------ | :-------------------------- | :----------------------------- | :--------------------------------------------------------------- |
| `RELAY`       | **Primary (Signaling URL)** | `wss://relay.example.com`      | Default WebSocket URL for the WebRTC signaling relay.            |
| `APP_URL`     | **Primary (Base URL)**      | `https://design.example.com`   | Public base URL used when generating shareable session links.    |
| `ICE_SERVERS` | **Primary (STUN/TURN)**     | `stun:stun.l.google.com:19302` | Comma-separated list of STUN/TURN server URLs for NAT traversal. |

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
