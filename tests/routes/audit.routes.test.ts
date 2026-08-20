/**
 * Unit tests for Audit Routes (GET /api/v1/facilities/:id/audit)
 *
 * Verifies:
 * - Admin role is required (non-admin gets 403)
 * - Unauthenticated requests get 401
 * - Valid admin request returns audit history with 200
 * - Invalid UUID returns 400 INVALID_FORMAT
 * - Empty history returns 200 with empty array
 *
 * Requirements: 11.2, 11.5, 11.6
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createAuditRouter } from '../../src/routes/audit.routes';
import { PrismaClient } from '@prisma/client';

const JWT_SECRET = 'test-secret-key';

function createMockPrisma() {
  return {
    auditEntry: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  } as unknown as PrismaClient & {
    auditEntry: {
      findMany: ReturnType<typeof vi.fn>;
    };
  };
}

function generateToken(role: 'user' | 'admin', userId = 'test-user-id') {
  return jwt.sign({ sub: userId, role }, JWT_SECRET);
}

describe('GET /api/v1/facilities/:id/audit', () => {
  let app: express.Application;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    process.env.JWT_SECRET = JWT_SECRET;
    mockPrisma = createMockPrisma();
    app = express();
    app.use(express.json());
    app.use('/api/v1', createAuditRouter(mockPrisma as unknown as PrismaClient));
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
  });

  it('should return 401 when no authentication token is provided', async () => {
    const response = await request(app)
      .get('/api/v1/facilities/550e8400-e29b-41d4-a716-446655440000/audit');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('should return 403 when user is not an admin', async () => {
    const token = generateToken('user');

    const response = await request(app)
      .get('/api/v1/facilities/550e8400-e29b-41d4-a716-446655440000/audit')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('INSUFFICIENT_PRIVILEGES');
  });

  it('should return 200 with audit history for admin user', async () => {
    const token = generateToken('admin');
    const facilityId = '550e8400-e29b-41d4-a716-446655440000';

    const mockEntries = [
      {
        id: 'audit-1',
        facilityId,
        userId: 'user-1',
        operationType: 'create',
        changes: { names: { oldValue: null, newValue: { en: 'Test Hospital' } } },
        createdAt: new Date('2024-01-01T10:00:00Z'),
      },
      {
        id: 'audit-2',
        facilityId,
        userId: 'user-2',
        operationType: 'update',
        changes: { beds: { oldValue: 100, newValue: 200 } },
        createdAt: new Date('2024-02-01T12:00:00Z'),
      },
    ];

    mockPrisma.auditEntry.findMany.mockResolvedValue(mockEntries);

    const response = await request(app)
      .get(`/api/v1/facilities/${facilityId}/audit`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0].operationType).toBe('create');
    expect(response.body.data[1].operationType).toBe('update');
  });

  it('should return 400 INVALID_FORMAT for invalid UUID', async () => {
    const token = generateToken('admin');

    const response = await request(app)
      .get('/api/v1/facilities/not-a-valid-uuid/audit')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_FORMAT');
    expect(response.body.error.details[0].field).toBe('id');
  });

  it('should return 200 with empty array when no audit entries exist', async () => {
    const token = generateToken('admin');
    const facilityId = '11111111-2222-3333-4444-555555555555';

    mockPrisma.auditEntry.findMany.mockResolvedValue([]);

    const response = await request(app)
      .get(`/api/v1/facilities/${facilityId}/audit`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it('should return audit history for deleted facilities', async () => {
    const token = generateToken('admin');
    const deletedFacilityId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

    const mockEntries = [
      {
        id: 'audit-1',
        facilityId: deletedFacilityId,
        userId: 'admin-1',
        operationType: 'create',
        changes: { names: { oldValue: null, newValue: { en: 'Gone Clinic' } } },
        createdAt: new Date('2023-01-01T00:00:00Z'),
      },
      {
        id: 'audit-2',
        facilityId: deletedFacilityId,
        userId: 'admin-1',
        operationType: 'delete',
        changes: { names: { oldValue: { en: 'Gone Clinic' }, newValue: null } },
        createdAt: new Date('2024-06-01T00:00:00Z'),
      },
    ];

    mockPrisma.auditEntry.findMany.mockResolvedValue(mockEntries);

    const response = await request(app)
      .get(`/api/v1/facilities/${deletedFacilityId}/audit`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0].operationType).toBe('create');
    expect(response.body.data[1].operationType).toBe('delete');
  });
});
