# plotlineai

Upload a CSV, let an AI agent suggest the best charts, and render them from the
real data.

## Stack

- `frontend/` - Next.js 16 (`web` service): UI + AI orchestration, the only public port.
- `backend/` - Spring Boot 4.1 / Java 25 (`api` service): CSV parsing, storage, aggregation.
- Postgres 16 (`db` service).

## Run locally

```bash
cp .env.example .env    # then edit values; OPENAI_API_KEY can stay blank for now
docker compose up --build
```

- App: http://localhost:3000
- Backend health (through the proxy): http://localhost:3000/api/backend/actuator/health

`api` and `db` are not published to the host by design.

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
cd frontend && npm run lint && npx tsc --noEmit && npm run build
```
