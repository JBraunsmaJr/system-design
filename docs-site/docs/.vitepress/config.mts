import { defineConfig } from 'vitepress';

/**
 * Where the editor is, for the link back to it.
 *
 * In the container image this is a placeholder: the editor and the docs
 * are mounted wherever the deployment puts them, so the entrypoint
 * (docker-entrypoint.d/45-docs-base.sh) writes the real address in at
 * start-up, exactly as it does the docs' own base path. On GitHub Pages
 * the editor is the repository's own site. Anywhere else, the domain root.
 */
const editorUrl =
  process.env.DOCS_APP_URL ??
  (process.env.GITHUB_REPOSITORY
    ? `https://${process.env.GITHUB_REPOSITORY.split('/')[0].toLowerCase()}.github.io/${process.env.GITHUB_REPOSITORY.split('/')[1]}/`
    : '/');

export default defineConfig({
  // GitHub Pages serves this repository at <user>.github.io/system-design/,
  // which is why that is the default. Any other host needs its own path:
  // the container image builds with DOCS_BASE=/docs/, and a deployment
  // behind a reverse proxy at some prefix passes the full path through
  // the image's DOCS_BASE build argument. VitePress bakes the base into
  // every asset URL at build time, so this cannot be decided at runtime
  // the way the app's relative base can.
  base: process.env.DOCS_BASE ?? '/system-design/docs/',
  outDir: '../../dist/docs',
  title: 'System Design Editor',
  description:
    'Documentation for System Design Editor: collaborative architecture, requirement linking, and capacity planning.',
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/diagram' },
      { text: 'Deployment', link: '/deployment/self-host' },
      // Back to the editor these docs belong to. Same tab: this is the way
      // home, not an outside link.
      { text: 'Open the editor', link: editorUrl, target: '_self', rel: '' },
    ],

    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Overview', link: '/guide/overview' },
          { text: 'Diagrams', link: '/guide/diagram' },
          { text: 'Requirements', link: '/guide/requirement' },
          { text: 'Timeline & Planning', link: '/guide/timeline' },
          { text: 'Team & Capacity', link: '/guide/team' },
          { text: 'Workspaces', link: '/guide/workspaces' },
          { text: 'How your work is protected', link: '/guide/security' },
        ],
      },
      {
        text: 'Deployment & Infrastructure',
        items: [
          { text: 'Self Hosting', link: '/deployment/self-host' },
          { text: 'Relay Server (Signaling)', link: '/deployment/relay-server' },
          { text: 'Workspace Store', link: '/deployment/workspace-store' },
          { text: 'Administering a Workspace', link: '/deployment/administration' },
        ],
      },
    ],

    search: {
      provider: 'local',
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/jbraunsmajr/system-design' }],

    footer: {
      message: 'System Design Editor Documentation',
      copyright: 'Released under the MIT License',
    },
  },
});
