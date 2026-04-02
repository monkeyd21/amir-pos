import request from 'supertest';
import app from '../../../app';
import { prismaMock, testUsers, authHeader } from '../../../__tests__/setup';

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  jest.restoreAllMocks();
});
beforeEach(() => {
  jest.clearAllMocks();
});

const BASE = '/api/v1/users';

const fakeUser = {
  id: 10,
  email: 'john@store.com',
  firstName: 'John',
  lastName: 'Doe',
  role: 'cashier',
  branchId: 1,
  isActive: true,
  commissionRate: 5,
  createdAt: new Date(),
  branch: { id: 1, name: 'Main Branch' },
};

describe('Users Module', () => {
  // ─── GET /me ─────────────────────────────────────────
  describe('GET /me', () => {
    it('should return the current user', async () => {
      prismaMock.user.findUnique.mockResolvedValue(fakeUser);

      const res = await request(app)
        .get(`${BASE}/me`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('email');
    });

    it('should return 401 without auth', async () => {
      const res = await request(app).get(`${BASE}/me`);
      expect(res.status).toBe(401);
    });
  });

  // ─── GET / (list users) ──────────────────────────────
  describe('GET / (list users)', () => {
    it('should list users with pagination', async () => {
      prismaMock.user.findMany.mockResolvedValue([fakeUser]);
      prismaMock.user.count.mockResolvedValue(1);

      const res = await request(app)
        .get(BASE)
        .set('Authorization', authHeader(testUsers.manager));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  // ─── GET /:id ────────────────────────────────────────
  describe('GET /:id', () => {
    it('should return a user by id', async () => {
      prismaMock.user.findUnique.mockResolvedValue(fakeUser);

      const res = await request(app)
        .get(`${BASE}/10`)
        .set('Authorization', authHeader(testUsers.manager));

      expect(res.status).toBe(200);
      expect(res.body.data.firstName).toBe('John');
    });

    it('should return 404 for non-existent user', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get(`${BASE}/999`)
        .set('Authorization', authHeader(testUsers.manager));

      expect(res.status).toBe(404);
    });
  });

  // ─── POST / (create user) ────────────────────────────
  describe('POST / (create user)', () => {
    it('should create a user (owner)', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue(fakeUser);

      const res = await request(app)
        .post(BASE)
        .set('Authorization', authHeader(testUsers.owner))
        .send({
          email: 'john@store.com',
          password: 'Password123',
          firstName: 'John',
          lastName: 'Doe',
          role: 'cashier',
          branchId: 1,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe('john@store.com');
    });

    it('should return 403 if cashier tries to create user', async () => {
      const res = await request(app)
        .post(BASE)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({
          email: 'test@store.com',
          password: 'Password123',
          firstName: 'Test',
          lastName: 'User',
          role: 'cashier',
          branchId: 1,
        });

      expect(res.status).toBe(403);
    });

    it('should return 400 for missing required fields', async () => {
      const res = await request(app)
        .post(BASE)
        .set('Authorization', authHeader(testUsers.owner))
        .send({ firstName: 'John' });

      expect(res.status).toBe(400);
    });
  });

  // ─── PUT /:id (update user) ──────────────────────────
  describe('PUT /:id (update user)', () => {
    it('should update a user (owner)', async () => {
      prismaMock.user.findUnique.mockResolvedValue(fakeUser);
      prismaMock.user.update.mockResolvedValue({ ...fakeUser, firstName: 'Jane' });

      const res = await request(app)
        .put(`${BASE}/10`)
        .set('Authorization', authHeader(testUsers.owner))
        .send({ firstName: 'Jane' });

      expect(res.status).toBe(200);
      expect(res.body.data.firstName).toBe('Jane');
    });

    it('should return 403 if cashier tries to update user', async () => {
      const res = await request(app)
        .put(`${BASE}/10`)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({ firstName: 'Hack' });

      expect(res.status).toBe(403);
    });
  });

  // ─── DELETE /:id ─────────────────────────────────────
  describe('DELETE /:id', () => {
    it('should delete a user (owner)', async () => {
      prismaMock.user.findUnique.mockResolvedValue(fakeUser);
      prismaMock.user.update.mockResolvedValue({ ...fakeUser, isActive: false });

      const res = await request(app)
        .delete(`${BASE}/10`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 403 if cashier tries to delete user', async () => {
      const res = await request(app)
        .delete(`${BASE}/10`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(403);
    });
  });
});
