# TaskFlow — Distributed Background Job Processing System

TaskFlow is a production-ready, distributed background job processing system designed to handle asynchronous task execution with high scalability and resilience. This repository is being constructed through an incremental multi-day architecture build; currently, it represents **Day 2 — Foundation & Database Schema**, establishing the environment configuration, Prisma ORM initialization, Express application server layout, structured health reporting, centralized error handling, and the core database models (`User`, `Job`, `JobAttempt`).

## Prerequisites

- **Node.js**: `v18.x` or higher (Supports native `--watch` mode in Node 18+)
- **PostgreSQL**: PostgreSQL instance running locally or via Docker (Note: Full container orchestration will be integrated in subsequent milestones).

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

### Intentionally Deferred Features (Future Milestones):
- [ ] User Authentication & JWT Security
- [ ] Redis Integration & BullMQ Queue Manager
- [ ] Asynchronous Worker Processes
- [ ] Job Retries, Exponential Backoff, & Dead Letter Queues (DLQ)
- [ ] Job CRUD / Enqueue APIs (basic schema is ready)
- [ ] Rate Limiting & Idempotency
- [ ] Admin Management APIs & Job Dashboards
