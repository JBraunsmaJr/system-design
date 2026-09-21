import { defineConfig } from 'vitepress';

export default defineConfig({
  base: '/system-design/docs/',
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
