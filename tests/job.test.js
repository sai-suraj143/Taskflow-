import request from 'supertest';
import app from '../src/app.js';
import { cleanDatabase } from './helpers/db.js';
import prisma from '../src/lib/prisma.js';

// These tests assert the HTTP + Postgres layer only, immediately after the response.
// No test waits for the BullMQ worker to pick anything up: worker execution is
// timing-dependent and stays a manual verification step (see README, Day 9).

const USER_A = { name: 'User A', email: 'user.a@example.com', password: 'password-a-123' };
const USER_B = { name: 'User B', email: 'user.b@example.com', password: 'password-b-123' };

const VALID_JOB = { type: 'SEND_EMAIL', payload: { to: 'someone@example.com' } };

// Registers + logs in through the real endpoints so the tokens under test are genuine
// JWTs signed by the app itself, not hand-built strings.
const signUpAndLogIn = async (credentials) => {
  await request(app).post('/api/auth/register').send(credentials).expect(201);

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: credentials.email, password: credentials.password })
    .expect(200);

  return { token: res.body.token, userId: res.body.user.id };
};

let tokenA;
let tokenB;
let userIdA;
let userIdB;

beforeEach(async () => {
  await cleanDatabase();

  const a = await signUpAndLogIn(USER_A);
  const b = await signUpAndLogIn(USER_B);

  tokenA = a.token;
  userIdA = a.userId;
  tokenB = b.token;
  userIdB = b.userId;
});

describe('POST /api/jobs', () => {
  it('returns 401 when the Authorization header is missing', async () => {
    const res = await request(app).post('/api/jobs').send(VALID_JOB);

    expect(res.status).toBe(401);
    expect(res.body.error).toEqual({
      message: 'Authorization header missing or malformed',
      status: 401,
    });
  });

  it('accepts a valid job with 202 as QUEUED and ignores any userId in the body', async () => {
    const res = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${tokenA}`)
      // userId is never taken from the body; the token is the only source of identity.
      .send({ ...VALID_JOB, userId: userIdB });

    expect(res.status).toBe(202);
    expect(res.body.data).toMatchObject({
      type: 'SEND_EMAIL',
      payload: { to: 'someone@example.com' },
      status: 'QUEUED',
      priority: 'NORMAL',
      attempts: 0,
      maxAttempts: 3,
      userId: userIdA,
    });
    expect(res.body.data.idempotencyKey).toBeNull();

    // Confirmed against the database, not just the response body.
    const persisted = await prisma.job.findUnique({ where: { id: res.body.data.id } });
    expect(persisted.userId).toBe(userIdA);
  });

  it('rejects an unknown job type with 400', async () => {
    const res = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ type: 'NOT_A_REAL_TYPE', payload: {} });

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({
      message: 'type must be one of the following: SEND_EMAIL, PROCESS_DATA, GENERATE_REPORT, SEND_WEBHOOK',
      status: 400,
    });
  });

  it('rejects a missing payload with 400', async () => {
    const res = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ type: 'SEND_EMAIL' });

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({
      message: 'payload must be a JSON object',
      status: 400,
    });
  });

  it('rejects an array payload with 400', async () => {
    const res = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ type: 'SEND_EMAIL', payload: ['not', 'an', 'object'] });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('payload must be a JSON object');
  });

  it('rejects an empty Idempotency-Key header with 400', async () => {
    const res = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('Idempotency-Key', '   ')
      .send(VALID_JOB);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Idempotency-Key header must not be empty if provided');
  });

  it('rate limiting happy path: several creates inside one window all succeed', async () => {
    // Only the allow-path is asserted here. Whether the 429 threshold itself fires is a
    // Day 8 concern that depends on wall-clock window boundaries, so it is left to
    // manual verification rather than made flaky in CI.
    for (let i = 0; i < 5; i += 1) {
      const res = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ type: 'PROCESS_DATA', payload: { index: i } });

expect(res.status).toBe(202);
    }

    expect(await prisma.job.count({ where: { userId: userIdA } })).toBe(5);
  });
});

describe('GET /api/jobs', () => {
  it('returns only the caller\'s own jobs', async () => {
    const createdForA = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(VALID_JOB)
      .expect(202);

    const createdForB = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ type: 'GENERATE_REPORT', payload: {} })
      .expect(202);

    const res = await request(app).get('/api/jobs').set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ total: 1, page: 1, limit: 20 });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(createdForA.body.data.id);
    expect(res.body.data.map((job) => job.id)).not.toContain(createdForB.body.data.id);
    expect(res.body.data.every((job) => job.userId === userIdA)).toBe(true);
  });
});

describe('GET /api/jobs/:id', () => {
  it("returns 404 (not 403) when another user's job id is requested", async () => {
    const createdForB = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${tokenB}`)
      .send(VALID_JOB)
      .expect(202);

    const res = await request(app)
      .get(`/api/jobs/${createdForB.body.data.id}`)
      .set('Authorization', `Bearer ${tokenA}`);

    // 404 rather than 403 is deliberate: a 403 would confirm the id belongs to a real
    // job owned by someone else, turning the endpoint into an enumeration oracle.
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ message: 'Job not found', status: 404 });
  });

  it("returns the caller's own job with 200", async () => {
    const created = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(VALID_JOB)
      .expect(202);

    const res = await request(app)
      .get(`/api/jobs/${created.body.data.id}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(created.body.data.id);
  });
});

describe('DELETE /api/jobs/:id (cancel)', () => {
  it('cancels a QUEUED job owned by the caller with 200', async () => {
    const created = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(VALID_JOB)
      .expect(202);

    const res = await request(app)
      .delete(`/api/jobs/${created.body.data.id}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
  });

  it('returns 409 when the same job is cancelled a second time', async () => {
    const created = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(VALID_JOB)
      .expect(202);

    await request(app)
      .delete(`/api/jobs/${created.body.data.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const res = await request(app)
      .delete(`/api/jobs/${created.body.data.id}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({
      message: 'Only jobs in QUEUED status can be cancelled',
      status: 409,
    });
  });

  it("returns 404 when cancelling another user's job", async () => {
    const createdForB = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${tokenB}`)
      .send(VALID_JOB)
      .expect(202);

    const res = await request(app)
      .delete(`/api/jobs/${createdForB.body.data.id}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Job not found');
  });
});

describe('Idempotency-Key replay', () => {
  it('returns 202 then 200 with X-Idempotent-Replay: true and the same job id', async () => {
    const idempotencyKey = 'replay-key-001';

    const first = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(VALID_JOB);

    const second = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(VALID_JOB);

    expect(first.status).toBe(202);
    expect(first.headers['x-idempotent-replay']).toBeUndefined();

    expect(second.status).toBe(200);
    expect(second.headers['x-idempotent-replay']).toBe('true');
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.data.idempotencyKey).toBe(idempotencyKey);

    // Exactly one row exists: the replay must not have created a second job.
    expect(await prisma.job.count({ where: { userId: userIdA } })).toBe(1);
  });

  it('scopes the key per user: user B reusing the same key gets its own job', async () => {
    const idempotencyKey = 'shared-key-002';

    const forA = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(VALID_JOB);

    const forB = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${tokenB}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(VALID_JOB);

    expect(forA.status).toBe(202);
    expect(forB.status).toBe(202);
    expect(forB.body.data.id).not.toBe(forA.body.data.id);
    expect(forB.body.data.userId).toBe(userIdB);
  });
});