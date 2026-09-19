import {defineConfig} from 'vitepress'

export default defineConfig({
    base: '/system-design/docs/',
    outDir: '../../dist/docs',
    title: "System Design Editor",
    description: "Documentation for System Design Editor: collaborative architecture, requirement linking, and capacity planning.",
    cleanUrls: true,
    themeConfig: {
        nav: [
            {text: 'Home', link: '/'},
            {text: 'Guide', link: '/guide/getting-started'},
            {text: 'Deployment', link: '/deployment/relay-server'},
            {text: 'Testing', link: '/testing/performance-testing'}
        ],

        sidebar: [
            {
                text: 'Getting Started',
                items: [
                    {text: 'Overview', link: '/guide/overview'},
                ]
            },
            {
                text: 'Deployment & Infrastructure',
                items: [
                    {text: 'Relay Server (Signaling)', link: '/deployment/relay-server'},
                    {text: 'Self Hosting', link: '/deployment/self-host.md'}
                ]
            },
            {
                text: 'Engineering & Testing',
                items: [
                    {text: 'Performance Testing Harness', link: '/testing/performance-testing'}
                ]
            }
        ],

        search: {
            provider: 'local'
        },

        socialLinks: [
            {icon: 'github', link: 'https://github.com/jbraunsmajr/system-design'}
        ],

        footer: {
            message: 'System Design Editor Documentation',
            copyright: 'Released under the MIT License'
        }
    }
})
