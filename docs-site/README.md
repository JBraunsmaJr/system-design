# System Design Editor - Documentation Site

This repository contains the official documentation for [System Design Editor](https://github.com/jbraunsmajr/system-design), powered by [VitePress](https://vitepress.dev/).

---

## Quick Start

### Installation

```bash
npm install
```

### Local Development

Start the development server with live reloading:

```bash
npm run dev
```

The documentation will be available locally at `http://localhost:5173`.

### Production Build

Build the static site:

```bash
npm run build
```

The output files will be generated in `docs/.vitepress/dist`.

### Local Preview

Preview the production build locally:

```bash
npm run preview
```

---

## Repository Structure

```
docs-site/
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Pages automated deployment workflow
├── .gitignore
├── README.md
├── package.json
└── docs/
    ├── .vitepress/
    │   └── config.mts          # Navigation, sidebar, search, and site metadata
    ├── index.md                # Homepage with hero & feature highlights
    ├── guide/
    │   ├── overview.md         # Architecture, tenets & tech stack
    │   └── getting-started.md  # Local installation & quick setup
    ├── deployment/
    │   ├── relay-server.md     # WebRTC signaling relay deployment & TLS
    │   └── container-configuration.md # Docker & environment variable reference
    └── testing/
        └── performance-testing.md # 3-layer performance testing harness
```

---

## Deployment to GitHub Pages

This repository is ready to be initialized as its own standalone Git repository:

1. Create a new repository on GitHub (e.g. `system-design-docs`).
2. Initialize and push:
   ```bash
   cd docs-site
   git init
   git add .
   git commit -m "feat: bootstrap documentation site"
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git branch -M main
   git push -u origin main
   ```
3. In your new GitHub repository, navigate to **Settings → Pages** and set **Source** to **GitHub Actions**.
4. The included `.github/workflows/deploy.yml` workflow will automatically build and publish the site on push to `main`.
