# System Design Editor

A node-based diagramming tool purpose-built for software architects — typed
components (microservices, databases, gateways, queues...) connected by typed
traffic (HTTP, gRPC, TCP, webhooks...), not generic boxes and lines.

Ships as a fully static site. No backend, no database — runs entirely in the
browser and deploys straight to GitHub Pages.

## Stack

- React 19 + TypeScript, built with Vite
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

## How it's structured

```
src/
  domain/
    types.ts            # NodeTypeDefinition, EdgeTypeDefinition, and the
                         # per-instance data shapes stored on each node/edge
    nodeRegistry.ts      # the extensible catalog of node types (add here)
    edgeRegistry.ts      # the extensible catalog of traffic/edge types (add here)
    serialization.ts     # save/open a diagram as a local .json file
  components/
    nodes/TypedNode.tsx  # renders a node using its registry definition
    edges/TypedEdge.tsx  # renders an edge using its registry definition
    Palette.tsx          # left sidebar - drag a type onto the canvas
    Inspector.tsx        # right sidebar - edit label/description/properties/tags
    Toolbar.tsx          # New / Open / Save
    Canvas.tsx           # the React Flow canvas itself
  App.tsx                # wires state + layout together
```

Everything is **type-registry driven**: to add a new node or edge type, add
one entry to `nodeRegistry.ts` or `edgeRegistry.ts` — no component code
changes needed.

## What's here (v0.1)

- Drag-and-drop typed nodes from a categorized palette
- Connect nodes with typed, styled edges (sync/async/data/file/generic)
- Label, describe, and attach free-form key/value properties + tags to any
  node or edge
- Save/open diagrams as local `.json` files

## What's next

Roughly following the phased roadmap in the design doc:

- [ ] Groups/boundaries (VPC, bounded context, trust boundary...) that visually
      contain nodes
- [ ] Scenario walkthroughs + Presentation Mode (step through a diagram like
      a slideshow, highlighting the relevant nodes/edges per step)
- [ ] Autosave to browser storage + File System Access API for in-place save
- [ ] PNG/SVG export
- [ ] Optional GitHub-backed open/save (repo or Gist), for version history and
      sharing without a custom backend
