FROM node:26.7.0-alpine
WORKDIR /app

RUN apk update && apk upgrade

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && \
    npm cache clean --force && \
    rm -rf /root/.npm /root/.cache

COPY store ./store
COPY src/crypto ./src/crypto

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Runs as a non-root user; the store writes nothing to its own filesystem.
USER node

# The health route is unauthenticated on purpose, for exactly this.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--experimental-strip-types", "store/src/main.ts"]
