# ---- Build stage: compiles the Vite/React app into static assets ----
FROM node:26.7.0-alpine AS build
WORKDIR /app

# Installing dependencies before copying the rest of the source lets
# Docker cache this layer - it only re-runs when package*.json actually
# change, not on every source edit, which keeps rebuilds fast.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# --base=./ (relative, not absolute) overrides vite.config.ts's configured
# '/system-design/' base, which is specific to this project's GitHub
# Pages deployment at <user>.github.io/system-design/ - that deployment
# is untouched, since it builds separately via .github/workflows/deploy.yml
# without this flag.
#
# Relative rather than root-absolute (--base=/) is deliberate: this image
# needs to work whether it's hosted at the root of a domain OR behind a
# reverse proxy at some arbitrary subpath, without knowing which in
# advance and without a rebuild per deployment. A relative base makes
# every asset reference resolve against wherever index.html actually was
# loaded from, whatever that turns out to be. Verified this concretely,
# not just by inspecting the built HTML: served the same build through
# nginx at both a root path and a simulated subpath and confirmed assets
# loaded correctly (200) in both cases, and specifically confirmed they
# do NOT resolve at the wrong (root) location when served from a subpath
# (404 there) - proving genuine relative resolution rather than a
# coincidence. See docker/nginx.conf's comment on why the SPA fallback
# was removed as a direct consequence of this choice.
RUN npm run build -- --base=./

# ---- Runtime stage: serves the built static files via nginx ----
FROM nginx:stable-alpine AS runtime

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
