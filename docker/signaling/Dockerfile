# Standalone y-webrtc signaling server - see this directory's own
# package.json for why this is a completely separate image from the
# main app's own Dockerfile at the project root. No build stage is
# needed here at all (unlike the main app's multi-stage Vite build) -
# there's nothing to compile, just a dependency to install and a
# bundled server script to run.
FROM node:26.7.0-alpine

WORKDIR /app

RUN apk update && apk upgrade

# Copying just the manifest before running install (rather than
# COPY . . first) means this layer is cached and only re-runs when the
# manifest itself actually changes - same reasoning as the main app's
# own Dockerfile.
COPY package.json ./
RUN npm install --omit=dev && npm update

# y-webrtc's own bundled server (node_modules/y-webrtc/bin/server.js)
# reads process.env.PORT directly, defaulting to 4444 if it's unset -
# confirmed directly against that script's own source, not assumed.
# Overriding this (docker run -e PORT=... or a compose/orchestrator
# env setting) changes what the container listens on internally; EXPOSE
# below is documentation for that default, not an enforced restriction -
# whatever you map this container's actual port to externally is what
# your users' VITE_SIGNALING_URL should point at (see the main project
# README's "Collaborative editing" section).
ENV PORT=4444
EXPOSE 4444

CMD ["node", "node_modules/y-webrtc/bin/server.js"]
