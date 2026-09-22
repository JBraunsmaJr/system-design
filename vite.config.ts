import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
// Base path matches the GitHub Pages project-site URL:
// https://<user>.github.io/system-design/
// If you rename the repo, update this to match.
const isPerfBuild = process.env.VITE_PERF_INSTRUMENTATION === '1';

export default defineConfig({
  base: '/system-design/',
  resolve: isPerfBuild
    ? {
        alias: {
          'react-dom/client': 'react-dom/profiling',
        },
      }
    : undefined,
  plugins: [
    {
      name: 'docs-redirect',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url || '';
          if (
            url === '/system-design/docs' ||
            url === '/system-design/docs/' ||
            url === '/docs' ||
            url === '/docs/' ||
            url.endsWith('/docs') ||
            url.endsWith('/docs/')
          ) {
            const target = url.replace(/\/docs\/?(\?.*)?$/, '/docs/index.html$1');
            res.writeHead(302, { Location: target });
            res.end();
            return;
          }
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url || '';
          if (
            url === '/system-design/docs' ||
            url === '/system-design/docs/' ||
            url === '/docs' ||
            url === '/docs/' ||
            url.endsWith('/docs') ||
            url.endsWith('/docs/')
          ) {
            const target = url.replace(/\/docs\/?(\?.*)?$/, '/docs/index.html$1');
            res.writeHead(302, { Location: target });
            res.end();
            return;
          }
          next();
        });
      },
    },
    react(),

    VitePWA({
      registerType: 'autoUpdate',

      includeAssets: ['favicon_16x16.png, favicon_144x144.png'],

      manifest: {
        name: 'System Design Editor',
        short_name: 'System Design',
        description: 'A node-based system design and architecture diagram editor',
        start_url: '/system-design/',
        scope: '/system-design/',
        display: 'standalone',

        theme_color: '#1e1e1e',
        background_color: '#1e1e1e',

        icons: [
          {
            src: 'favicon_16x16.png',
            sizes: '16x16',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'favicon_144x144.png',
            sizes: '144x144',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },

      workbox: {
        navigateFallbackDenylist: [
          /\/docs(\/|$)/,
          /\/store(\/|$)/,
          /\/relay(\/|$)/,
          /\/auth(\/|$)/,
        ],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,png,jpg,jpeg,gif,svg,ico}'],
      },
    }),
  ],
});
