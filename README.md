# plotlineai

Upload a CSV, let an AI agent suggest the best charts, and render them from the
real data.

## Stack

- `deploy/Caddyfile` - Caddy (`proxy` service): the only published port. It sets the
  client address that rate limiting keys on, and terminates TLS in production.
- `frontend/` - Next.js 16 (`web` service): UI + AI orchestration. `proxy.ts` sets the
  per-request CSP and decides which api paths the browser may reach.
- `backend/` - Spring Boot 4.1 / Java 25 (`api` service): CSV parsing, storage, aggregation.
- Postgres 16 (`db` service).
- `e2e/` - the Playwright suite, and `e2e/ai-stub`, a stand-in for the OpenAI API.

## Run locally

```bash
cp .env.example .env    # then edit values; OPENAI_API_KEY can stay blank for now
docker compose up --build
```

- App: http://localhost:3000
- Backend health: `docker compose exec api curl -s localhost:8081/actuator/health`

Only `proxy` is published. `web`, `api` and `db` sit on the internal network, and
actuator listens on a management port that no browser path reaches.

## Develop without Docker

```bash
# database
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db

# backend
cd backend && ./mvnw spring-boot:run

# frontend
cd frontend && npm install && npm run dev
```

The dev overlay publishes Postgres on localhost:5432; the backend's application.yaml defaults then connect without further configuration. The base compose file never publishes db or api ports.

## Tests

```bash
cd backend  && ./mvnw verify          # needs Docker (Testcontainers)
cd frontend && npm run lint && npm run typecheck && npm test && npm run build
```

End to end, against the full stack with the AI stub in place of OpenAI:

```bash
docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d --build --wait
cd e2e && npm ci && npx playwright install chromium && npx playwright test
```

The rate-limit spec drains a bucket on purpose. It refills within a minute, so wait that
long before running the suite again on the same stack.

## Production (Cloud Run)

The public deployment is one Google Cloud Run service. `web` receives the traffic, and
`api` runs beside it as a sidecar on `localhost:8080`. It uses a free Neon Postgres, and
Google terminates TLS, so Caddy is not part of it. At portfolio traffic it fits in the free
allowances. Its only running cost is OpenAI usage, which the daily call limit caps.

```bash
PROJECT_ID=my-project deploy/cloudrun/deploy.sh
```

The one-time setup, a smoke checklist and operations are in
[docs/deploy-cloud-run.md](docs/deploy-cloud-run.md). The service is pinned to one instance
(`maxScale: 1`) because the rate limiters live in `web`'s memory.

## Production (single VPS)


`docker-compose.prod.yml` is a stub for one small box, such as a Hetzner CX22. Point a DNS
record at the box, open ports 80 and 443, and set `POSTGRES_PASSWORD` and
`OPENAI_API_KEY` in `.env`. Then:

```bash
DOMAIN=charts.example.com docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Caddy obtains and renews the certificate on its own and adds HSTS. The overlay refuses to
start without the password, the key or the domain.

Back up the database:

```bash
docker compose exec -T db pg_dump -U plotlineai -Fc plotlineai > plotlineai-$(date +%F).dump
```

Restore it with `pg_restore -U plotlineai -d plotlineai --clean`, piping the dump in
through `docker compose exec -T db`.
