import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import app from '../../../app';
import { config } from '../../../config';
import { prismaMock, testUsers, authHeader, generateRefreshToken } from '../../../__tests__/setup';

// Suppress console.error from errorHandler during tests
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Auth Module', () => {
  // ─── POST /api/v1/auth/login ─────────────────────────────────
  describe('POST /api/v1/auth/login', () => {
    const validUser = {
      id: 1,
      email: 'admin@store.com',
      passwordHash: bcrypt.hashSync('Password123', 10),
      firstName: 'Admin',
      lastName: 'User',
      role: 'owner',
      branchId: 1,
      isActive: true,
      branch: { id: 1, name: 'Main Branch' },
    };

    it('should login with valid credentials and return tokens', async () => {
      prismaMock.user.findUnique.mockResolvedValue(validUser);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'admin@store.com', password: 'Password123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('accessToken');
      expect(res.body.data).toHaveProperty('refreshToken');
      expect(res.body.data.user).toHaveProperty('email', 'admin@store.com');
      // Password hash must NOT be in the response
      expect(res.body.data.user).not.toHaveProperty('passwordHash');
    });

    it('should return 401 for invalid password', async () => {
      prismaMock.user.findUnique.mockResolvedValue(validUser);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'admin@store.com', password: 'WrongPassword' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/invalid email or password/i);
    });

    it('should return 401 for non-existent email', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@store.com', password: 'Password123' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should return 401 for inactive user', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ ...validUser, isActive: false });

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'admin@store.com', password: 'Password123' });

      expect(res.status).toBe(401);
    });

    it('should return 400 for missing email', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ password: 'Password123' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 400 for invalid email format', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email', password: 'Password123' });

      expect(res.status).toBe(400);
    });
  });

  // ─── POST /api/v1/auth/refresh ───────────────────────────────
  describe('POST /api/v1/auth/refresh', () => {
    it('should return new tokens for a valid refresh token', async () => {
      const refreshToken = generateRefreshToken(testUsers.owner);

      prismaMock.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'owner@test.com',
        role: 'owner',
        branchId: 1,
        isActive: true,
      });

      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('accessToken');
      expect(res.body.data).toHaveProperty('refreshToken');

      // Verify the new access token is valid
      const decoded = jwt.verify(res.body.data.accessToken, config.jwt.secret) as any;
      expect(decoded.userId).toBe(1);
    });

    it('should return 401 for an expired refresh token', async () => {
      const expiredToken = jwt.sign(
        { userId: 1, email: 'a@b.com', role: 'owner', branchId: 1 },
        config.jwt.refreshSecret,
        { expiresIn: '0s' }
      );

      // Small delay to ensure token is expired
      await new Promise((r) => setTimeout(r, 50));

      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: expiredToken });

      expect(res.status).toBe(401);
    });

    it('should return 401 for inactive user on refresh', async () => {
      const refreshToken = generateRefreshToken(testUsers.owner);

      prismaMock.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'owner@test.com',
        role: 'owner',
        branchId: 1,
        isActive: false,
      });

      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });

      expect(res.status).toBe(401);
    });

    it('should return 400 for missing refreshToken field', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ─── POST /api/v1/auth/change-password ───────────────────────
  describe('POST /api/v1/auth/change-password', () => {
    it('should change password with valid old password', async () => {
      const hashed = bcrypt.hashSync('OldPass123', 10);

      prismaMock.user.findUnique.mockResolvedValue({
        id: 1,
        passwordHash: hashed,
      });
      prismaMock.user.update.mockResolvedValue({ id: 1 });

      const res = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', authHeader(testUsers.owner))
        .send({ oldPassword: 'OldPass123', newPassword: 'NewPass456' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/changed successfully/i);
    });

    it('should return 400 for incorrect old password', async () => {
      const hashed = bcrypt.hashSync('OldPass123', 10);

      prismaMock.user.findUnique.mockResolvedValue({
        id: 1,
        passwordHash: hashed,
      });

      const res = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', authHeader(testUsers.owner))
        .send({ oldPassword: 'WrongOldPass', newPassword: 'NewPass456' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/old password/i);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/v1/auth/change-password')
        .send({ oldPassword: 'OldPass123', newPassword: 'NewPass456' });

      expect(res.status).toBe(401);
    });

    it('should return 400 for too-short new password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', authHeader(testUsers.owner))
        .send({ oldPassword: 'OldPass123', newPassword: '12345' });

      expect(res.status).toBe(400);
    });
  });
});
