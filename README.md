# TaskFlow — Distributed Background Job Processing System

TaskFlow is a production-ready, distributed background job processing system designed to handle asynchronous task execution with high scalability and resilience. This repository is being constructed through an incremental multi-day architecture build; currently, it represents **Day 9 — Automated Tests & Full Dockerization**, on top of the JWT auth, job CRUD API, BullMQ worker, retry/backoff/DLQ, priority mapping, rate limiting and idempotency built in Days 3-8.

## Prerequisites

- **Node.js**: `v18.x` or higher (Supports native `--watch` mode in Node 18+; Docker images pin `node:22-alpine`)
- **Docker** + **Docker Compose**: required for Postgres/Redis (both host-mode and containerised)
- **PostgreSQL**: provided by the `postgres` compose service

## Quickstart Setup

1. **Clone repository and install dependencies**:
   ```bash
   npm install
   ```

2. **Environment Setup**:
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   *Ensure `DATABASE_URL` and `PORT` are properly set in `.env`.*

3. **Start PostgreSQL (optional)**:
   ```bash
   docker compose up -d
   ```

4. **Generate Prisma Client & Apply Migrations**:
   ```bash
   npx prisma generate
   npx prisma migrate deploy
   ```

5. **Start Development Server**:
   ```bash
   npm run dev
   ```

6. **Start the Worker (separate terminal)**:
   ```bash
   npm run worker
   ```

---

## Running the whole stack in Docker

```bash
docker compose up -d --build
docker compose ps
```

Four services come up from **one** image (`taskflow:latest`, built by the multi-stage
`Dockerfile`); `api` and `worker` differ only by the `command` they run:

| Service | Role | Command |
| --- | --- | --- |
| `postgres` | Database (also hosts `taskflow_test` for Jest) | official image + healthcheck |
| `redis` | Queue broker | official image + healthcheck |
| `api` | HTTP API on `:3000` | `npx prisma migrate deploy && node src/server.js` |
| `worker` | BullMQ consumer | `node src/worker.js` |

Notes:
- Inter-container traffic uses compose's service-name DNS — `postgres` and `redis`, never
  `localhost`. The container environment is supplied by `env_file: .env` plus `environment:`
  overrides for `DATABASE_URL`/`REDIS_URL`, so **`.env` itself is not modified** for
  container use and host-mode `npm run dev` keeps working unchanged.
- Only `api` runs migrations. The `worker` deliberately does not, so the two services can
  never race to migrate the same database.
- The `worker`'s `depends_on: api (service_started)` only narrows the window before
  migrations finish; it is **best-effort ordering, not a guarantee**.
- Mix freely: `docker compose stop api worker` leaves Postgres/Redis up for host-mode
  `npm run dev` / `npm run worker`.

---

## Automated tests

```bash
npm run db:create:test      # once, creates the taskflow_test database (idempotent)
npm run prisma:migrate:test # apply migrations to taskflow_test
npm test
```

- Jest + supertest against the app object exported by `src/app.js` (which never calls
  `.listen()`), running as native ES modules (`type: module`): `transform: {}` in
  `jest.config.js` plus `NODE_OPTIONS=--experimental-vm-modules` from the `test` script.
- `--runInBand` is **required**: all suites share the single `taskflow_test` database and
  each one truncates it in `beforeEach`, so parallel workers would delete each other's rows.
- Tests run against `taskflow_test` and Redis logical DB 1 only, never the dev database.
- Coverage: auth register/login (including the identical-message rule for bad password vs
  unknown email), job create/list/get/cancel, ownership and validation, plus the
  idempotency replay and rate-limit **happy paths**.
- **Not covered by Jest on purpose:** nothing starts the real worker and waits for a job
  to complete — that is timing-dependent and flaky in CI, so retries, backoff, DLQ,
  priority ordering and dead-lettering stay **manual** verification steps.


## Verification

To verify that the server and database connectivity check are functioning:
```bash
curl http://localhost:3000/health
```

**Response Example (DB Connected)**:
```json
{
  "status": "ok",
  "db": "connected",
  "timestamp": "2026-09-04T18:40:00.000Z"
}
```

**Response Example (DB Disconnected / Pending DB Start)**:
```json
{
  "status": "error",
  "db": "disconnected",
  "message": "Database connectivity check failed",
  "timestamp": "2026-09-04T18:40:00.000Z"
}
```

---

## Progress Roadmap & Deferred Scope

### Implemented in Day 1 — Foundation:
- [x] ES Module Express application structure (`src/app.js` & `src/server.js`)
- [x] Environment configuration validation (`src/config/env.js`)
- [x] Prisma Client singleton initialization (`src/lib/prisma.js` & `prisma/schema.prisma`)
- [x] Request logging middleware (`morgan`)
- [x] Health check endpoint (`GET /health`) with live DB query check
- [x] Centralized error handler and 404 handler (`src/middlewares/errorHandler.js`)

### Implemented in Day 2 — Database Schema & Core Models:
- [x] Core domain models: `User`, `Job`, and `JobAttempt` (`prisma/schema.prisma`)
- [x] Enums: `UserRole`, `JobStatus`, `JobPriority`, `AttemptStatus`
- [x] Job lifecycle fields: status, priority, attempts, `maxAttempts`, and timestamps (`startedAt`/`completedAt`/`failedAt`)
- [x] Attempt tracking and unique constraint per job attempt (`@@unique([jobId, attemptNumber])`)
- [x] Indexed columns for query optimization (`userId`, `status`, `createdAt`, `jobId`)
- [x] Prisma migration applied (`prisma/migrations`)
- [x] PostgreSQL containerized setup via `docker-compose.yml`

### Implemented in Day 9 — Automated Tests & Full Dockerization:
- [x] Jest + supertest suites for auth and the job API (`tests/`)
- [x] Isolated `taskflow_test` database with its own `.env.test`, never the dev DB
- [x] Reusable DB cleanup helper (`tests/helpers/db.js`)
- [x] Multi-stage `Dockerfile` (single image, dev deps pruned in the runtime stage)
- [x] `api` + `worker` services in `docker-compose.yml`, with postgres/redis healthchecks
- [x] `.dockerignore` keeping `tests/`, `.env`, `.env.test` and `.git` out of the image

### Intentionally Deferred Features (Future Milestones):
- [ ] API documentation (Swagger / OpenAPI) — Day 10
- [ ] CI/CD pipeline (GitHub Actions running `npm test` and the compose stack)
- [ ] Retry/backoff/DLQ/priority automated coverage (currently manual verification only)
- [ ] Robust migration gating (dedicated migration job instead of `service_started`)
- [ ] Outbox pattern / reconciliation sweep for enqueue failures
- [ ] Admin Management APIs & Job Dashboards

