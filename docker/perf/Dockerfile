# Hermetic, self-contained performance testing container image
# Bundles Node.js, application production build with instrumentation, and pinned Playwright browser binaries.
FROM mcr.microsoft.com/playwright:v1.51.0-noble AS runner

WORKDIR /app

# Install dependencies with npm caching
COPY package.json package-lock.json ./
RUN npm ci
RUN npx playwright install chromium

# Copy full repository source
COPY . .

# Build application with perf instrumentation enabled
ENV VITE_PERF_INSTRUMENTATION=1
RUN npm run build -- --base=./

# Expose Vite preview default port
EXPOSE 4173

# Execute scenario test suite
CMD ["npx", "tsx", "scripts/execute-perf-suite.ts"]
