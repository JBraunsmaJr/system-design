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
# loaded from, whatever that turns out to be.
RUN npm run build:app -- --base=./

# ---- Runtime stage: serves the built static files via nginx ----
FROM nginx:stable-alpine AS runtime

RUN apk update && apk upgrade

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/docker-entrypoint.d/ /docker-entrypoint.d/
RUN sed -i 's/\r$//' /docker-entrypoint.d/*.sh && chmod +x /docker-entrypoint.d/*.sh
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
