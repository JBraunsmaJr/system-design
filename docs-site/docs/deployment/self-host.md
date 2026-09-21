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
alongside the editor, so a deployment carries its own copy with no internet
access required.

Unlike the editor — which uses a relative base so one image works at a
domain's root or behind any reverse proxy path — VitePress bakes absolute
asset URLs at build time. The path is therefore a build argument:

```bash
# Editor at https://example.gov/ , docs at https://example.gov/docs/
docker build -t system-design .

# Editor at https://example.gov/system-design/ , docs one level in
docker build --build-arg DOCS_BASE=/system-design/docs/ -t system-design .
```

If the docs load but every stylesheet and link 404s, `DOCS_BASE` does not
match the path the container is actually served from.
