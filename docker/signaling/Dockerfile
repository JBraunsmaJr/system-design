# The session relay (WS10-R6, R7).
#
# Built from the REPOSITORY ROOT, not this directory:
#
#   docker build -f docker/signaling/Dockerfile .
#
# because the relay's source lives in scripts/ and store/, and copying it
# in is better than keeping a second copy here that could drift from the
# one the tests exercise.
#
# This used to run y-webrtc's own bin/server.js, which admits anyone who
# can reach it. The documentation described RELAY_TOKEN_SECRET as
# requiring membership, and with that image setting it did nothing at all -
# the one outcome worse than a missing control is one that appears to be
# on. scripts/relay-server.ts speaks the same protocol (CI runs y-webrtc's
# protocol checks against both) and honours the secret; without one it
# behaves exactly as the old image did, so existing deployments are
# unaffected.
FROM node:26.7.0-alpine

WORKDIR /app

RUN apk update && apk upgrade

# The manifest first, so the dependency layer is cached until it changes.
COPY docker/signaling/package.json ./
RUN npm install --omit=dev && \
    npm cache clean --force && \
    rm -rf /usr/local/lib/node_modules/npm /root/.npm /root/.cache

# Exactly what the relay imports, at the paths it imports them from.
# scripts/verify-relay-image-contents.ts walks the relay's import graph and
# fails if anything it reaches is missing here.
COPY scripts/relay-server.ts ./scripts/relay-server.ts
COPY store/src/auth/roomTokens.ts ./store/src/auth/roomTokens.ts

ENV PORT=4444
EXPOSE 4444

# The relay writes nothing to its own filesystem.
USER node

# /health answers whether authentication is required, so an operator can
# check the secret took effect without trying to join a room.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4444)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--experimental-strip-types", "scripts/relay-server.ts"]
