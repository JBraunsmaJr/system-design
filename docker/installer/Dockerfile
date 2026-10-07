# The installer: a Node CLI that drives the host's Docker through its socket.
# Build context is installer/ (see .github/workflows/installer-publish.yml).
FROM node:26.7.0-alpine

# docker-cli-compose provides `docker compose`; tar is GNU tar for --exclude.
RUN apk add --no-cache docker-cli docker-cli-compose tar

WORKDIR /opt/sd-installer
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src

# Runs as root: it needs the Docker socket and writes the install directory,
# which compose then reads on the host. Mount that directory at the same
# path inside and out, and make it the working directory:
#   docker run --rm -it -v /var/run/docker.sock:/var/run/docker.sock \
#     -v /opt/system-design:/opt/system-design -w /opt/system-design \
#     ghcr.io/jbraunsmajr/system-design-installer install
ENV NODE_ENV=production
ENTRYPOINT ["node", "/opt/sd-installer/src/main.ts"]
CMD ["--help"]
