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

const BASE = '/api/v1/branches';

const fakeBranch = {
  id: 1,
  name: 'Main Branch',
  address: '123 Main St',
  phone: '03001234567',
  isActive: true,
  createdAt: new Date(),
};

describe('Branches Module', () => {
  // ─── GET / (list branches) ───────────────────────────
  describe('GET / (list branches)', () => {
    it('should list all branches', async () => {
      prismaMock.branch.findMany.mockResolvedValue([fakeBranch]);

      const res = await request(app)
        .get(BASE)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should return 401 without auth', async () => {
      const res = await request(app).get(BASE);
      expect(res.status).toBe(401);
    });
  });

  // ─── GET /:id ────────────────────────────────────────
  describe('GET /:id', () => {
    it('should return a branch by id', async () => {
      prismaMock.branch.findUnique.mockResolvedValue(fakeBranch);

      const res = await request(app)
        .get(`${BASE}/1`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Main Branch');
    });

    it('should return 404 for non-existent branch', async () => {
      prismaMock.branch.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get(`${BASE}/999`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(404);
    });
  });

  // ─── POST / (create branch) ──────────────────────────
  describe('POST / (create branch)', () => {
    it('should create a branch (owner only)', async () => {
      prismaMock.branch.findUnique.mockResolvedValue(null);
      prismaMock.branch.create.mockResolvedValue(fakeBranch);

      const res = await request(app)
        .post(BASE)
        .set('Authorization', authHeader(testUsers.owner))
        .send({ name: 'Main Branch', code: 'MAIN', address: '123 Main St', phone: '03001234567' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Main Branch');
    });

    it('should return 403 if manager tries to create branch', async () => {
      const res = await request(app)
        .post(BASE)
        .set('Authorization', authHeader(testUsers.manager))
        .send({ name: 'New Branch', address: '456 St', phone: '03009999999' });

      expect(res.status).toBe(403);
    });

    it('should return 403 if cashier tries to create branch', async () => {
      const res = await request(app)
        .post(BASE)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({ name: 'New Branch', address: '456 St', phone: '03009999999' });

      expect(res.status).toBe(403);
    });

    it('should return 400 for missing name', async () => {
      const res = await request(app)
        .post(BASE)
        .set('Authorization', authHeader(testUsers.owner))
        .send({ address: '123 Main St' });

      expect(res.status).toBe(400);
    });
  });

  // ─── PUT /:id (update branch) ────────────────────────
  describe('PUT /:id (update branch)', () => {
    it('should update a branch (owner)', async () => {
      prismaMock.branch.findUnique.mockResolvedValue(fakeBranch);
      prismaMock.branch.update.mockResolvedValue({ ...fakeBranch, name: 'Updated Branch' });

      const res = await request(app)
        .put(`${BASE}/1`)
        .set('Authorization', authHeader(testUsers.owner))
        .send({ name: 'Updated Branch' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Updated Branch');
    });

    it('should return 403 if cashier tries to update branch', async () => {
      const res = await request(app)
        .put(`${BASE}/1`)
        .set('Authorization', authHeader(testUsers.cashier))
        .send({ name: 'Hack' });

      expect(res.status).toBe(403);
    });
  });

  // ─── DELETE /:id ─────────────────────────────────────
  describe('DELETE /:id', () => {
    it('should delete a branch (owner only)', async () => {
      prismaMock.branch.findUnique.mockResolvedValue(fakeBranch);
      prismaMock.branch.update.mockResolvedValue({ ...fakeBranch, isActive: false });

      const res = await request(app)
        .delete(`${BASE}/1`)
        .set('Authorization', authHeader(testUsers.owner));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 403 if cashier tries to delete branch', async () => {
      const res = await request(app)
        .delete(`${BASE}/1`)
        .set('Authorization', authHeader(testUsers.cashier));

      expect(res.status).toBe(403);
    });
  });
});
