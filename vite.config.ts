import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Base path matches the GitHub Pages project-site URL:
// https://<user>.github.io/system-design/
// If you rename the repo, update this to match.
export default defineConfig({
  plugins: [react()],
  base: '/system-design/',
})
