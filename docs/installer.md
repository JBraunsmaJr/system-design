# Installing and upgrading with the installer

The installer is a container that sets up a complete deployment (editor,
relay, store, PostgreSQL, and optionally Keycloak, coturn and a reverse
proxy) and keeps it up to date. It asks for what it cannot decide, writes
plain files you can read (`compose.yml`, `.env`, a proxy config), and drives
Docker on the host through its socket.

Everything it writes lives in one **install directory**. Nothing else on
the host is touched.

## Quick start

```bash
sudo mkdir -p /opt/system-design
docker run --rm -it \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /opt/system-design:/opt/system-design -w /opt/system-design \
  ghcr.io/jbraunsmajr/system-design-installer install
```

Later, from the same directory:

```bash
docker run --rm -it -v /var/run/docker.sock:/var/run/docker.sock \
  -v /opt/system-design:/opt/system-design -w /opt/system-design \
  ghcr.io/jbraunsmajr/system-design-installer upgrade
```

A shell alias saves typing:

```bash
alias sd='docker run --rm -it -v /var/run/docker.sock:/var/run/docker.sock -v /opt/system-design:/opt/system-design -w /opt/system-design ghcr.io/jbraunsmajr/system-design-installer'
sd status
```

### Why the directory is mounted at the same path

Compose resolves paths such as `./keys/recovery-public.pem` on the **host**,
because the Docker daemon does the mounting. If the install directory were
`/opt/system-design` on the host but `/install` inside the installer, every
bind mount would silently become an empty directory. The installer checks
for this and refuses to continue. On Docker Desktop, where host paths are
translated, pass `--skip-mount-check`.

## Commands

| Command             | What it does                                                                                                 |
|---------------------|--------------------------------------------------------------------------------------------------------------|
| `install`           | First-time setup. Asks what it needs (or reads a manifest), generates secrets and the recovery key, deploys. |
| `upgrade`           | Resolves new image versions, shows what changes, backs up, deploys, waits for health. Restores on failure.   |
| `reconfigure`       | Asks the questions again with your previous answers filled in, and redeploys.                                |
| `status`            | Installed versions, container health, and whether newer images exist.                                        |
| `backup` / `--list` | Dumps both databases and archives the configuration under `backups/<id>/`.                                   |
| `restore <id>`      | Puts a backup's configuration back. `--with-data` restores the databases too.                                |
| `rollback`          | Undoes the most recent install, upgrade or reconfigure, using the backup taken just before it.               |
| `promote-admin`     | Adds a store administrator (`ADMIN_SUBJECTS`). `--username` for Keycloak, `--subject issuer#sub` otherwise.  |
| `render`            | Writes the configuration files and starts nothing. With `--dry-run`, only shows the diff.                    |
| `doctor`            | Checks Docker, compose, the mount, disk, DNS and the registry, and changes nothing.                          |

Useful options: `--manifest <file>`, `--non-interactive`, `--yes`,
`--dry-run`, `--to <version>` (or `--editor`/`--relay`/`--store`),
`--force`, `--no-diff`. `--help` lists them all.

## What ends up in the install directory

```
compose.yml              all services; image references and secrets come from .env
.env                     image references and every secret (mode 0600)
Caddyfile | nginx/ …     the proxy configuration, for the proxy you chose
keycloak-realm.json      realm, client and groups; no users, no secret
turnserver.conf          when coturn runs here
keys/recovery-public.pem the organization's recovery public key
proxy-snippets/          with an external proxy: blocks to paste into yours
backups/<id>/            database dumps, configuration archive, meta.json
.sd-install/config.yml   your answers, secrets replaced by "stored"
.sd-install/state.json   deployment history and fingerprints of written files
```

Every generated file is fingerprinted. If you edit one by hand, the next run
notices, shows the difference, and asks whether to replace it (your version
is copied to `.sd-install/replaced/`). A non-interactive run stops instead of
guessing; `--force` replaces and keeps the copy.

## Manifests

A manifest is a YAML file holding any of the answers. Anything it gives is
not asked; anything it leaves out is asked, or, with `--non-interactive`,
taken from the default or reported as missing. A complete installation from
CI looks like:

```bash
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /opt/system-design:/opt/system-design -w /opt/system-design \
  -v ./manifest.yml:/manifest.yml:ro \
  -e CLOUDFLARE_API_TOKEN \
  ghcr.io/jbraunsmajr/system-design-installer install -m /manifest.yml --non-interactive --yes
```

Secret fields take a reference rather than necessarily the value:

| Value         | Meaning                                                                |
|---------------|------------------------------------------------------------------------|
| `generate`    | Make a random one on first install; afterwards keep the one in `.env`. |
| `env:NAME`    | Read from the installer's environment (`docker run -e NAME`).          |
| `file:/path`  | Read from a file mounted into the installer.                           |
| `stored`      | Must already be in `.env` (what saved configurations use).             |
| anything else | The value itself. Avoid this in files you commit.                      |

Examples for each proxy option are in [`installer/examples/`](../installer/examples).

### Reference

```yaml
domain: design.example.com          # required
project: system-design              # compose project; volume names derive from it
routing:
  mode: path                        # path: /editor /store /relay /keycloak on one host
                                    # subdomain: a hostname per service
  hosts:                            # subdomain mode; defaults shown
    editor: design.example.com
    store: store.design.example.com
    relay: relay.design.example.com
    auth: auth.design.example.com

proxy:                              # one of:
  type: caddy
  acme: http                        # or cloudflare-dns
  email: ops@example.com
  cloudflareApiToken: env:CLOUDFLARE_API_TOKEN   # cloudflare-dns only
  resolvers: [clyde.ns.cloudflare.com]           # optional DNS-01 tuning
  propagationDelay: 30s
  propagationTimeout: 10m
# type: nginx
#   tls: certbot-http | certbot-cloudflare | provided
#   email, cloudflareApiToken, certPath, keyPath, staging: false
# type: cloudflare-tunnel
#   token: env:TUNNEL_TOKEN
# type: external
#   upstreamHost: 192.168.2.146     # how your proxy reaches this host
#   bindAddress: 192.168.2.146      # interface service ports are published on

identity:                           # one of:
  type: keycloak
  realm: system-design
  clientId: system-design-store
  clientSecret: generate
  adminPassword: generate
  dbPassword: generate
  groups: [design-team-a]
  initialUser:                      # optional; becomes a store administrator
    username: jdoe
    email: jdoe@example.com
    groups: [design-team-a]
    admin: true
# type: oidc
#   issuer: https://login.example.com/realms/corp
#   internalUrl: http://idp.internal:8080   # optional back-channel address
#   clientId, clientSecret, groupsClaim: groups, scopes
# type: github
#   clientId, clientSecret

turn:
  type: none                        # or bundled, or external
# bundled: host, externalIp, username: webrtc, password: generate,
#          port: 3478, minPort: 49160, maxPort: 49200, denyPrivatePeers: true
# external: iceServers: "stun:h:3478,turn:h:3478|user|pass"

recovery:
  mode: generate                    # or existing
  publicKeyPath: keys/recovery-public.pem   # existing only

store:
  retention: 30d                    # immediate | indefinite | 7d, 12w, 6m, 7y
  autoAccess: true
  relayAuth: true
  adminSubjects: []                 # issuer#subject; promote-admin maintains this

secrets:
  postgresPassword: generate
  relayTokenSecret: generate

versions:                           # latest | a dated tag | sha256:…
  editor: latest
  relay: latest
  store: latest

images:                             # third-party images, all overridable
  registry: ghcr.io/jbraunsmajr     # for mirrors
  postgres: postgres:16-alpine
  keycloak: quay.io/keycloak/keycloak:26.0
  coturn: coturn/coturn:4.6
  caddy: caddy:2.8
  caddyBuilder: caddy:2.8-builder
  nginx: nginx:1.27-alpine
  cloudflared: cloudflare/cloudflared:latest
  certbot: certbot/certbot:latest
  certbotCloudflare: certbot/dns-cloudflare:latest

ports:                              # external proxy only
  editor: 8888
  store: 8889
  relay: 4444
  keycloak: 8001

backups:
  keep: 10
```

## Choosing a proxy

**Caddy** obtains and renews certificates by itself. With `acme: http` the
host must be reachable on 80 and 443 from the internet. With
`acme: cloudflare-dns` it proves ownership through the Cloudflare API
instead, which works for hosts only reachable on a private network; the
installer builds a Caddy image with the Cloudflare module for this.

**nginx** uses certbot. The first certificate is requested before nginx
starts, and a `certbot` service renews it twice a day while nginx reloads
every six hours to pick it up. `tls: provided` mounts certificate files you
manage yourself.

**Cloudflare Tunnel** needs no inbound ports. `cloudflared` connects out to
Cloudflare, and a small internal Caddy routes the paths. After installing,
open your tunnel in Zero Trust → Networks → Tunnels and route each public
hostname to `http://proxy:80`. A tunnel cannot carry TURN's UDP: a bundled
TURN server still needs its own DNS-only record and open ports.

**External** is for a proxy you already run, possibly on another machine.
The services publish their ports on `bindAddress`, and `proxy-snippets/`
holds ready-made Caddy and nginx blocks pointing at `upstreamHost`.
PostgreSQL is never published.

## Versions, upgrades and rollback

Images are published with the UTC date they were built and, for full
releases, `latest`. The editor, relay and store are built by separate
workflows, so their dates can differ. The installer resolves each
separately: `latest` becomes the dated tag that has the same digest, and that
fixed reference is what goes into `.env`, so a later `rollback` returns to
exactly the same images.

An upgrade:

1. resolves versions and renders the configuration;
2. shows the image changes and file diffs, and asks to continue;
3. dumps both databases and archives the configuration;
4. writes the files, pulls, starts, and waits for every health check;
5. if anything fails to come up, restores the previous configuration and
   starts it again.

The store migrates its own schema at startup, and migrations only go
forward. Step 5 does **not** restore the databases, because the failed version
may have written nothing. If it did change the schema, run
`restore <id> --with-data` with the backup id it printed. `rollback` asks the
same question.

Backups live on the same disk as the data. Copy `backups/` elsewhere for
protection against losing the machine.

## Keycloak

Keycloak only imports `keycloak-realm.json` when the realm does not exist.
After that, the installer applies changes through `kcadm.sh` inside the
Keycloak container: the client's redirect URI, web origins and secret,
missing groups, and the first user. The first user's Keycloak id is their
OIDC subject, so the installer adds them to `ADMIN_SUBJECTS` right away.
Others can be added with `promote-admin --username <name>` once they exist.

The realm file never contains the client secret. Keycloak substitutes
`${OIDC_CLIENT_SECRET}` from its environment at import. Nor does it contain
users; the old demo accounts are reported if an earlier import left them.

## The recovery key

`recovery.mode: generate` runs the store image's own `generate-recovery-key`
and leaves `keys/recovery-private.pem` next to the public half. Interactive
installs then offer to display it for copying and to delete it. Until it is
gone, `status` and `doctor` keep warning. Backups never include it.

With `recovery.mode: existing`, give the **public** half only.

## Adopting an existing deployment

A directory that already holds a hand-made `compose.yml` and `.env` can be
taken over in place:

1. Run `install` in that directory with a manifest describing the setup (see `installer/examples/external-caddy.yml`).
   Use the **same project
   name** compose has been using, normally the directory name in lower case,
   so the existing volumes are found.
2. The installer copies the original files to `.sd-install/adopted-<time>/`,
   reuses every secret already in `.env` (so the databases keep their
   passwords), backs up the running databases, and replaces the files.
3. An existing `keys/recovery-public.pem` can be kept with
   `recovery.mode: existing`.

Things that change on adoption: PostgreSQL is no longer published on the
host; service ports are bound to `bindAddress` only; coturn gets a new
generated credential and is pinned to a version; and the realm file loses
its demo users (remove any that were already imported, in the Keycloak
admin console).

## Troubleshooting

- **"is not mounted at the same path"**: mount the install directory as
  `-v /x:/x -w /x`.
- **"edited by hand"** in a non-interactive run: review with
  `render --dry-run`, then re-run with `--force`.
- **"differs from the value the database was created with"**: a database
  password changed in `.env` or the manifest. PostgreSQL ignores the variable
  after its first start; change the password inside PostgreSQL first, then use
  `--force`.
- **Keycloak rejected the bootstrap admin credentials**: the admin password
  was changed in Keycloak. Set `KEYCLOAK_ADMIN_PASSWORD` in `.env` to match.
- **Registry unreachable**: pin versions (`--to 2026-10-03`) to skip the
  lookup, or set `images.registry` to a mirror.
- Set `SD_DEBUG=1` for stack traces.
