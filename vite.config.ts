import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
// Base path matches the GitHub Pages project-site URL:
// https://<user>.github.io/system-design/
// If you rename the repo, update this to match.
export default defineConfig({
  base: '/system-design/',
  plugins: [
      react(),

      VitePWA({
        registerType: 'autoUpdate',

        includeAssets: ["favicon.png"],

        manifest: {
          name: "System Design Editor",
          short_name: "System Design",
          description: "A node-based system design and architecture diagram editor",
          start_url: "/system-design/",
          scope: "/system-design/",
          display: "standalone",

          theme_color: "#1e1e1e",
          background_color: "#1e1e1e",

          icons: [
            {
              src: "favicon_16x16.png",
              sizes:"16x16",
              type: "image/png",
              purpose: "any"
            },
            {
              src: "favicon_144x144.png",
              sizes:"144x144",
              type: "image/png",
              purpose: "any"
            }
          ]
        },

        workbox: {
          globPatterns: [
            "**/*.{js,css,html,png,jpg,jpeg,gif,svg,ico}"
          ]
        }
      })
  ]
})
