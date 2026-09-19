# Quick Start

Get up and running with System Design Editor locally or via Docker.

---

## Running Locally

### Prerequisites
- Node.js (v20+ recommended)
- npm or pnpm

### Steps

```bash
# Clone the repository
git clone https://github.com/jbraunsmajr/system-design.git
cd system-design

# Install dependencies
npm install

# Start local development server
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## Production Build

To compile static assets for deployment:

```bash
npm run build
```

Assets will be output to the `dist/` directory.

To preview the built production site locally:

```bash
npm run preview
```

---

## Connecting to a Signaling Relay

Collaborative sessions require a signaling relay for WebRTC handshakes:

1. Start a local relay:
   ```bash
   docker run -d -p 4444:4444 ghcr.io/jbraunsmajr/system-design-relay:latest
   ```
2. In the running application, navigate to **Collaborate → Relay Server URL** and enter:
   ```
   ws://localhost:4444
   ```
3. Share your generated session link or room code with teammates.

For production relay hosting, TLS certificates, and air-gapped setup, see the [Relay Server Guide](/deployment/relay-server).
