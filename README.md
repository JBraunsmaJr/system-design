# System Design Editor

## Background

This project originally started off as a way to create diagrams, but has since evolved into a tool to collaborate on
requirements gathering.

Features:

- Collaborate in real-time with others
- Create diagrams
- Link diagram components to a requirement, and reverse look up the diagram component from a requirement
- Program Increment (PI) planning – with capacity reservations and sprint planning
- Create PowerPoint like presentations using the "scenario" ability in diagrams.

Ships as a fully static site. No backend, no database — runs entirely in the
browser and deploys straight to GitHub Pages. The collaboration feature requires a relay to 
handle the handshake between clients. Once the connection is established, clients no longer need the relay.

## Collaborative editing

Sessions are peer-to-peer: document data flows directly between browsers
and never through a server. The one piece of infrastructure required is a
**relay**, which carries only the initial handshake that lets two
browsers find each other. Once connected, the relay is out of the path.

There is no public default — you point the app at a relay you control, or
collaboration stays disabled. Quickest possible start:

```bash
docker run -d -p 4444:4444 ghcr.io/jbraunsmajr/system-design-relay:latest
```

then set **Collaborate → Relay Server URL** to `ws://localhost:4444`, or
bake in a default for everyone at build time:

```bash
VITE_SIGNALING_URL="wss://relay.example.com" npm run build
```

**See [docs/relay-server.md](docs/relay-server.md)** for hosting a relay
properly, TLS and reverse proxy configuration, access control, running in
restricted or air-gapped networks, and troubleshooting.

## Running with Docker

Pre-built Docker images are published to GitHub Container Registry:

```bash
docker run -d -p 8080:80 \
  -e RELAY="wss://relay.example.com" \
  -e APP_URL="https://design.example.com" \
  ghcr.io/jbraunsmajr/system-design:latest
```

See **[docs/container-configuration.md](docs/container-configuration.md)** for full container documentation, including environment variable reference, Docker Compose examples, and reverse proxy guidelines.

## Stack

- React + TypeScript, built with Vite
- [React Flow](https://reactflow.dev/) (`@xyflow/react`) for the canvas
- [lucide-react](https://lucide.dev/) for icons

## Running locally

```bash
npm install
npm run dev
```

## Building

```bash
npm run build   # outputs to dist/
npm run preview # serve the production build locally
```

Pushing to `main` automatically builds and deploys to GitHub Pages via
`../.github/workflows/deploy.yml`. First-time setup: in the repo's **Settings →
Pages**, set the source to **GitHub Actions**.

> The Vite `base` in `vite.config.ts` is set to `/system-design/` to match
> this repo's name. If you rename the repo, update that value too.