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

Two services, run locally by the root `docker compose` and on AWS as two Lambda
functions behind CloudFront (`infra/`, `docs/deploy-aws.md`,
`docs/superpowers/specs/2026-09-29-aws-serverless-design.md`):

- **web** - Next.js 16. UI + all AI orchestration. Holds `OPENAI_API_KEY`. The only
  service the browser reaches.
- **api** - Spring Boot 4.1 / Java 25. Data service: presigned CSV uploads, parsing,
  schema inference, DynamoDB + S3 storage, the aggregation engine, share persistence.
  Internal only (on AWS its function URL accepts only SigV4 requests from web's role).
- Storage is DynamoDB and S3. Locally, DynamoDB Local and S3Mock stand in for them, so
  nothing needs an AWS account.

Rules:

- The **browser talks only to `web`**, plus the one presigned PUT straight to S3 that
  `api` hands out for an upload. Never point the browser at `api` directly.
- `/api/backend/[...path]` is a route handler that forwards the allowed paths
  (`frontend/lib/security/backend-paths.ts`) to `api`, signing them with SigV4 on AWS.
  `web` route handlers may also call `api` server-to-server.
- **AI code lives only in `web`** (`frontend/lib/ai/`), because the Vercel AI SDK and
  LangChain are JS/TS. Do not add an LLM client to the Spring Boot backend.
- **`api` computes all aggregation** (group-by, sum/avg/min/max/count, time buckets,
  filters, top-N) in Java, against the full dataset. `web` never aggregates.
- The LLM only ever sees a column schema + ~20 sample rows. The full dataset is never
  sent to any model.

## The framework versions are newer than your training data

- **Next.js 16.3.** `frontend/AGENTS.md` says it plainly: APIs, conventions, and
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

- Authoritative definition: Zod schema in `frontend/lib/chart-spec.ts`.
- Mirror: Java records in `com.plotlineai.backend.chart.spec`.
- Keep them in sync. Both contract tests (`ChartSpecContractTest` and
  `frontend/lib/chart-spec.test.ts`) read one fixture file,
  `backend/src/test/resources/contracts/chart-spec-fixtures.json`. Add cases there, never
  in either test. If you change one side, change the other in the same PR.
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
  presigned PUTs signed for the exact size and type; nothing written to local disk;
  byte/row/column/cell caps enforced during a streaming parse; strict UTF-8; malformed
  CSV -> structured `422`, never a stack trace.
- Rate limit the AI routes and `/api/backend` writes and renders per client and globally
  (DynamoDB fixed windows). Global daily OpenAI call ceiling as a cost circuit breaker.
- `OPENAI_API_KEY` only in `web` server env (SSM Parameter Store on AWS). Never sent to
  the browser, never logged.
- `api` and storage never publicly exposed. `web` refuses cross-site writes and, on AWS,
  any request that did not come through CloudFront.
- Bean Validation on every DTO; Jackson `FAIL_ON_UNKNOWN_PROPERTIES = true`.
- Actuator: `/health` + `/info` only, internal-only.
- `web` security headers (CSP, `nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`).
- Generic error responses; logs exclude secrets and full dataset contents.
- Dockerfiles: minimal base image, non-root user.

## Design comes before frontend code

The design pass is spec phase 5, and it is a **prerequisite for every frontend phase**.
Do not build a screen, a component, or a chart style before it has landed.

- `docs/design-system.md` is the written source of truth: color roles, type scale,
  spacing scale, radii, elevation, component patterns, and the per-screen layout rules.
- The Tailwind v4 `@theme` tokens in `frontend/app/globals.css` are the machine-readable
  half of the same thing. Consume those tokens. Do not hardcode hex values, arbitrary
  Tailwind values (`text-[#3b82f6]`, `p-[13px]`), or a spacing step that is not on the
  scale.
- Series colors come from the shared categorical chart palette, so the gallery and the
  analyze results color identical categories identically.
- If a screen needs something the design system does not cover, raise it and extend the
  design system deliberately. Do not invent a one-off value in a component.

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
- Build phases are listed in the spec (section 12). Follow that order. Phase 5 is the
  design pass; no frontend phase starts before it is merged.
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

- `docker compose up --build` -> the app on `http://localhost:3000` (through the
  `proxy` service); `api` and the storage stand-ins internal.
- `.env` (git-ignored) holds `OPENAI_API_KEY`, `AI_MODEL`, and the cap values.
  `.env.example` lists every key with safe placeholders.

Infra (`infra/`):

- Types and tests: `npm run typecheck && npm test` (CDK assertions plus cdk-nag).
- Synth offline, without the CDK CLI: `CDK_OUTDIR=<dir>
  CDK_CONTEXT_JSON='{"alertEmail":"x@example.com"}' npx tsx bin/plotlineai.ts`.

## Deployment scope

Production is AWS serverless, defined in `infra/` (CDK) and deployed by
`.github/workflows/deploy.yml` after the owner approves each run. The owner's rules:
- No command that talks to AWS (`aws ...`, `cdk diff/deploy/bootstrap`, even read-only
  ones) runs without the owner's explicit yes, each time. Explain first what it does,
  what it creates, what it costs and how to undo it.
- The agent never handles the OpenAI key; the owner puts it in SSM themselves.
- Every accepted cdk-nag finding is acknowledged next to its resource, with a reason
  (`infra/lib/nag.ts`).

## Definition of done for a phase

- New behavior is covered by tests written test-first.
- `cd backend && ./mvnw verify` is green (Testcontainers included).
- `cd frontend && npm run lint && npx tsc --noEmit && npx vitest run` is green.
- `npx playwright test` is green against `docker compose up` (once the E2E phase
  exists).
- `docker compose up --build` brings every service healthy and the phase's
  user-visible behavior works when clicked through in a browser.
- GitHub Actions CI is green on the PR.
- The `ChartSpec` Zod schema and its Java mirror agree (contract tests pass on both
  sides).
- For frontend phases: every color, spacing, and type value traces to a token in
  `frontend/app/globals.css`, and the screen matches `docs/design-system.md`.
