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