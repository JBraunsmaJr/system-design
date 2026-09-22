# Self-Hosting

The editor runs entirely in the browser, so you can host it for your team
with no database at all. Choose the path that fits.

| | [Core](/deployment/core) | [With workspaces](/deployment/with-workspaces) |
| :--- | :--- | :--- |
| Draw, save to the browser and to files | ✓ | ✓ |
| Live sessions, by sharing a link | ✓ | ✓ |
| Shared team storage | | ✓ |
| Sign in with your identity provider | | ✓ |
| Live sessions only for people who signed in | | ✓ |
| Documents open from any browser you sign in on | | ✓ |
| Services | editor, relay | editor, relay, store, PostgreSQL |
| Stores documents on your server | No | Yes, encrypted - the server cannot read them |
| You look after | a TLS certificate | a certificate, a database, backups, and a recovery key |
| Setup time | ~10 minutes | ~30 minutes |

**Not sure?** Start with [Core](/deployment/core). Moving to workspaces later
means adding services, not replacing anything, and documents people already
have stay in their browsers until they choose to save them to the workspace.

Both paths use one domain and one TLS proxy with every service behind it by
path. That keeps browsers' cookie and cross-origin rules out of the way, so
there are fewer settings to get wrong.

## Container images

| Image | Service |
| :--- | :--- |
| `ghcr.io/jbraunsmajr/system-design` | The editor, with this documentation at `/docs/` |
| `ghcr.io/jbraunsmajr/system-design-relay` | The relay, for live sessions |
| `ghcr.io/jbraunsmajr/system-design-store` | The workspace store - with workspaces only |

Each is tagged `latest` and with its release date. The three are released
together; pin the same date on all of them.

## Networks without direct paths

Live sessions connect browsers directly to each other. On air-gapped
networks, or where firewalls block that, they need a **TURN server** to relay
through. Add one beside either deployment:

::: code-group

```yaml [turnserver.compose.yml]
<!--@include: @/files/turnserver.compose.yml -->
```

```ini [turnserver.conf]
<!--@include: @/files/turnserver.conf -->
```

:::

Then set `ICE_SERVERS` in `.env`, using the same user name and password as the
`user=` line above:

```ini
ICE_SERVERS=turn:design.example.gov:3478|webrtc|CHANGEME-long-random-string
```

Replace `CHANGEME-long-random-string` in both places with a real secret, and
open port 3478 plus the relay range (49160–49200) on the host.

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
than obviously broken - the page loads, then the router rewrites the URL to
the path the build assumed. So the image is built with a placeholder, and
the entrypoint replaces it with the path you are actually serving from.
:::
