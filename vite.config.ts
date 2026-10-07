import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import react from '@vitejs/plugin-react';
import {VitePWA} from 'vite-plugin-pwa';

// https://vite.dev/config/
// Base path matches the GitHub Pages project-site URL:
// https://<user>.github.io/system-design/
// If you rename the repo, update this to match.
const isPerfBuild = process.env.VITE_PERF_INSTRUMENTATION === '1';

export default defineConfig({
  base: '/system-design/',
  // The SRD's PDF engine is imported lazily, so the dev server would only
  // discover these when it is first turned on - then re-bundle and reload
  // the page mid-session. Pre-bundling them at startup avoids that.
  // ES-module workers, so the SRD's PDF worker shares code-split chunks
  // (react-pdf, the templates) with the page instead of failing to build.
  worker: { format: 'es' },
  optimizeDeps: {
    include: ['@react-pdf/renderer', 'pdfjs-dist/legacy/build/pdf.mjs'],
  },
  resolve: {
    alias: {
      // Markdown's entity decoder (used by remark) has a browser variant that
      // decodes through the DOM, which the SRD's PDF worker does not have;
      // the dev server shares one resolution between page and worker. The
      // universal variant decodes from a table instead - same results,
      // anywhere.
      // An absolute path: the package's exports map does not expose the file.
      'decode-named-character-reference': fileURLToPath(
        new URL('./node_modules/decode-named-character-reference/index.js', import.meta.url),
      ),
      ...(isPerfBuild ? { 'react-dom/client': 'react-dom/profiling' } : {}),
    },
  },
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
    react({
      // The SRD's PDF engine runs in a worker (srdPdf.worker.ts), and Fast
      // Refresh's runtime assumes a page - it references \`window\` and stops
      // the worker loading. Its files describe PDF documents for react-pdf,
      // never mounted in the page's React tree, so they gain nothing from
      // Fast Refresh. The preview, a page component, keeps it.
      exclude: [/\/src\/components\/srd\/pdf\/(?!SrdPdfPreview\.tsx)/, /\/node_modules\//],
    }),

    VitePWA({
      registerType: 'autoUpdate',

      includeAssets: ['favicon_16x16.png, favicon_144x144.png'],

      manifest: {
        name: 'Engineers Notebook',
        short_name: 'Engineers Notebook',
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
        navigateFallbackDenylist: [/\/docs(\/|$)/],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,png,jpg,jpeg,gif,svg,ico}'],
      },
    }),
  ],
});
