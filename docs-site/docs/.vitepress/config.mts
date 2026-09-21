import { defineConfig } from 'vitepress';

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
