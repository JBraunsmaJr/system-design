# System Design installer

Terminal installer and upgrader for a self-hosted deployment. See [docs/installer.md](../docs/installer.md).

```bash
npm ci
npm run typecheck
npm test                       # unit tests
REAL_COMPOSE=$(which docker-compose) REAL_CADDY=$(which caddy) node --test test/e2e.test.ts
COMPOSE="docker compose" sh test/validate-rendered.sh   # needs caddy and nginx
node src/main.ts --help
```
