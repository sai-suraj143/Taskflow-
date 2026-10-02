import request from 'supertest';
import app from '../src/app.js';
import { cleanDatabase } from './helpers/db.js';

// Supertest drives the app object exported by src/app.js, which never calls .listen() —
// so the suite binds an ephemeral port per request and no real server is started. Nothing
// here starts the BullMQ worker: job processing is out of scope for Jest (see README).

const VALID_USER = {
  name: 'Auth Tester',
  email: 'auth.tester@example.com',
  password: 'supersecret123',
};

beforeEach(async () => {
  await cleanDatabase();
});

describe('POST /api/auth/register', () => {
  it('creates a user and returns 201 without the password field', async () => {
    const res = await request(app).post('/api/auth/register').send(VALID_USER);

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      email: VALID_USER.email,
      name: VALID_USER.name,
      role: 'USER',
    });
    expect(res.body.user).toHaveProperty('id');
    expect(res.body.user).not.toHaveProperty('password');
    expect(res.body).not.toHaveProperty('token');
  });

  it('rejects a duplicate email with 409', async () => {
    await request(app).post('/api/auth/register').send(VALID_USER).expect(201);

    const res = await request(app).post('/api/auth/register').send(VALID_USER);

    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({
      message: 'User with this email already exists',
      status: 409,
    });
  });

  it('rejects a missing field with 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: VALID_USER.email, password: VALID_USER.password });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('name, email and password are required');
    expect(res.body.error.status).toBe(400);
  });

  it('rejects an email without @ with 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...VALID_USER, email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('A valid email address is required');
  });

  it('rejects a password shorter than 8 characters with 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...VALID_USER, password: 'short7c' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Password must be at least 8 characters long');
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/auth/register').send(VALID_USER).expect(201);
  });

  it('returns 200 with a token and no password field for valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: VALID_USER.password });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.split('.')).toHaveLength(3);
    expect(res.body.user.email).toBe(VALID_USER.email);
    expect(res.body.user).not.toHaveProperty('password');
  });

  it('returns 401 for a wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: 'wrong-password-123' });

    expect(res.status).toBe(401);
    expect(res.body.error).toEqual({
      message: 'Invalid email or password',
      status: 401,
    });
  });

  it('returns 401 for a non-existent email with a byte-identical message', async () => {
    // Security requirement from Day 3: a wrong password and an unknown account must be
    // indistinguishable to the caller, otherwise the endpoint becomes an account
    // enumeration oracle. Asserting string equality (not just status) is the point.
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: 'wrong-password-123' });

    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody.here@example.com', password: VALID_USER.password });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message);
    expect(JSON.stringify(unknownEmail.body)).toBe(JSON.stringify(wrongPassword.body));
  });

  it('returns 400 when credentials are missing', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: VALID_USER.email });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('email and password are required');
  });
});