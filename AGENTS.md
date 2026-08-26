# AGENTS.md - how to build PlotlineAI

This file tells an AI agent how to work in this repo. Read it fully before writing
code. The full design is in `docs/superpowers/specs/2026-08-26-plotlineai-design.md`.
Also obey `CLAUDE.MD` at the repo root (no em dashes, no agent co-author lines in
commits, prefer quality over dev-cost shortcuts, reproduce bugs E2E first).

## What this project is

A CSV goes in; an AI agent proposes the 3 best charts (the user can also describe their
own); the chosen chart is rendered from the real data, refinable by follow-up prompt,
with PNG export and shareable links. A landing page shows ~6 curated example charts
with downloadable CSVs.

## Architecture you must respect

Three containers, wired by the root `docker-compose.yml`:

- **web** - Next.js 16. UI + all AI orchestration. Holds `OPENAI_API_KEY`. The only
  publicly exposed service.
- **api** - Spring Boot 4.1 / Java 25. Data service: CSV upload, parsing, schema
  inference, Postgres storage, the aggregation engine, share persistence. Internal
  only.
- **db** - Postgres 16. Internal only.

Rules:

- The **browser talks only to `web`**. Never point the browser at `api` directly.
- `web/next.config.ts` `rewrites` proxy `/api/backend/:path*` -> `http://api:8080/:path*`.
  Browser calls to `api` go through that path. `web` route handlers may also call `api`
  server-to-server.
- **AI code lives only in `web`** (`web/src/lib/ai/`), because the Vercel AI SDK and
  LangChain are JS/TS. Do not add an LLM client to the Spring Boot backend.
- **`api` computes all aggregation** (group-by, sum/avg/min/max/count, time buckets,
  filters, top-N) in Java, against the full dataset. `web` never aggregates.
- The LLM only ever sees a column schema + ~20 sample rows. The full dataset is never
  sent to any model.

## The framework versions are newer than your training data

- **Next.js 16.2.12.** `frontend/AGENTS.md` says it plainly: APIs, conventions, and
  file structure differ from what you remember. Before writing frontend code, read the
  relevant guide under `frontend/node_modules/next/dist/docs/`. Do not assume Pages
  Router, `next/legacy`, old `next.config` shapes, or old route-handler signatures.
- **Spring Boot 4.1 / Java 25.** Starter artifacts are renamed (`spring-boot-starter-webmvc`,
  not `-web`; split test starters). Check `backend/pom.xml` and the Spring Boot 4
  reference before adding dependencies or config. Use Java 25 language features where
  they make the code clearer.
- When unsure whether a pattern still applies, check the installed version's own docs
  or source before writing - do not guess from memory.

## The ChartSpec contract

`ChartSpec` is the one interface between the AI layer and the render backend.

- Authoritative definition: Zod schema in `web/src/lib/chart-spec.ts`.
- Mirror: Java records in `com.plotlineai.backend.chart.spec`.
- Keep them in sync. Each side has a contract test that round-trips the same example
  specs. If you change one, change the other and update both tests in the same PR.
- Shape is documented in the spec (section 5). Fields: `chartType`, `stacked?`,
  `title`, `dimension`, `measures[]`, `breakdown?`, `filters[]`, `sort?`, `limit?`.

## The LLM is untrusted - `api` is the gatekeeper

- `api` **must validate every `ChartSpec`** before rendering: referenced columns exist
  in that dataset's schema, aggregation is valid for the column type, enums and numeric
  bounds are in range, array sizes are bounded. Invalid -> `400`. Never render an
  unvalidated spec.
- Dataset column names and cell values are untrusted input. The system prompt says so;
  `generateObject` schema-constrains the output; `api` re-checks. All three layers
  stay.

## Security checklist (see spec section 8 for detail)

- Uploads: `.csv` + `text/csv` only; own generated IDs, never the client filename;
  nothing written to disk; byte/row/column/cell caps enforced during a streaming parse;
  strict UTF-8; malformed CSV -> structured `422`, never a stack trace.
- Rate limit `/api/suggest` and `/api/chart-spec` per IP (token bucket). Global daily
  OpenAI call ceiling as a cost circuit breaker.
- `OPENAI_API_KEY` only in `web` server env. Never sent to the browser, never logged.
- `api` + `db` never publicly exposed. `api` rejects cross-origin requests.
- Bean Validation on every DTO; Jackson `FAIL_ON_UNKNOWN_PROPERTIES = true`;
  parameterized DB access only.
- Actuator: `/health` + `/info` only, internal-only.
- `web` security headers (CSP, `nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`).
- Generic error responses; logs exclude secrets and full dataset contents.
- Dockerfiles: minimal base image, non-root user.

## Workflow

- **TDD.** Write the failing test first, then the implementation. This is required for
  every feature and bugfix. The aggregation engine in particular gets table-driven
  tests covering each aggregation, time bucket, filter, breakdown, top-N, and
  empty/degenerate input.
- **Reproduce bugs E2E first** (per `CLAUDE.MD`) - as close to how a user hits it as
  possible - before proposing a fix.
- **One branch + one PR per build phase.** Never commit straight to `main`. Push the
  branch, open the PR with `gh`, summarize what changed, and leave the merge to the
  owner. Follow `CLAUDE.MD` commit rules (plain `-`, no agent co-author line).
- Build phases are listed in the spec (section 12). Follow that order.
- Fix lint failures, test failures, and flakiness you encounter, even if unrelated to
  your current task (per `CLAUDE.MD`).
- Before spawning a large swarm of subagents or using "ultra"/"dynamic" harness
  features, explain the tradeoffs and ask the owner first (per `CLAUDE.MD`).

## Commands

Backend (`backend/`):

- Run: `./mvnw spring-boot:run`
- Test: `./mvnw verify` (includes Testcontainers - Docker must be running)
- Build: `./mvnw -q package`

Frontend (`frontend/`):

- Dev: `npm run dev`
- Lint: `npm run lint`
- Types: `npx tsc --noEmit`
- Unit: `npx vitest run`
- E2E: `npx playwright test` (needs `docker compose up`)

Whole stack:

- `docker compose up --build` -> `web` on `http://localhost:3000`; `api` and `db`
  internal.
- `.env` (git-ignored) holds `OPENAI_API_KEY`, `POSTGRES_*`, `AI_MODEL`, and the cap
  values. `.env.example` lists every key with safe placeholders.

## Deployment scope

This project builds the **local `docker compose` experience only**. Do not add
Terraform, CDK, cloud pipelines, or provider-specific infra unless the owner asks. Keep
the app deploy-ready: env-var config (no hardcoded hosts), clean non-root Dockerfiles,
`web` as `output: "standalone"`, healthchecks, Flyway-on-startup. The likely future
target is a single cheap VPS (e.g. Hetzner) + Caddy/Traefik; a
`docker-compose.prod.yml` overlay stub is the only nod to it.

## Definition of done for a phase

- New behavior is covered by tests written test-first.
- `cd backend && ./mvnw verify` is green (Testcontainers included).
- `cd frontend && npm run lint && npx tsc --noEmit && npx vitest run` is green.
- `npx playwright test` is green against `docker compose up` (once the E2E phase
  exists).
- `docker compose up --build` brings all three services healthy and the phase's
  user-visible behavior works when clicked through in a browser.
- GitHub Actions CI is green on the PR.
- The `ChartSpec` Zod schema and its Java mirror agree (contract tests pass on both
  sides).
