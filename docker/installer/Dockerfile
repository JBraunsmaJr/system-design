FROM node:22-alpine

# Install Docker CLI and Docker Compose plugin
RUN apk add --no-cache docker-cli docker-cli-compose

WORKDIR /app

COPY package*.json ./
COPY sdctl/ ./sdctl/
COPY tsconfig*.json ./

RUN npm ci --omit=dev || npm install --omit=dev

ENTRYPOINT ["npx", "tsx", "/app/sdctl/bin/sdctl.ts"]
CMD ["--help"]
