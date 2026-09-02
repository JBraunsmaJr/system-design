import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted fonts (bundled by Vite at build time, not fetched from
// fonts.googleapis.com at runtime) - see index.css's comment on the
// --sans/--mono variables for why this replaced a Google Fonts @import.
// Weights match what was previously requested from Google Fonts: Inter
// 400/500/600/700, JetBrains Mono 400/500.
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
