/**
 * Unit tests for AuditService.getAuditHistory method
 *
 * Verifies:
 * - Valid UUID returns audit history sorted chronologically (oldest to newest)
 * - Invalid UUID returns INVALID_FORMAT error
 * - History is returned even for soft-deleted facilities (no existence check)
 * - Empty history returns empty array with success: true
 *
 * Requirements: 11.2, 11.5, 11.6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditService } from '../../src/services/audit.service';
import { PrismaClient } from '@prisma/client';

function createMockPrisma() {
  return {
    auditEntry: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  } as unknown as PrismaClient & {
    auditEntry: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
  };
}

describe('AuditService.getAuditHistory', () => {
  let service: AuditService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new AuditService(mockPrisma as unknown as PrismaClient);
  });

  it('should return audit history sorted chronologically for a valid UUID', async () => {
    const facilityId = '550e8400-e29b-41d4-a716-446655440000';
    const mockEntries = [
      {
        id: 'audit-1',
        facilityId,
        userId: 'user-1',
        operationType: 'create',
        changes: { names: { oldValue: null, newValue: { en: 'Hospital A' } } },
        createdAt: new Date('2024-01-01T10:00:00Z'),
      },
      {
        id: 'audit-2',
        facilityId,
        userId: 'user-2',
        operationType: 'update',
        changes: { beds: { oldValue: 100, newValue: 150 } },
        createdAt: new Date('2024-02-15T14:30:00Z'),
      },
      {
        id: 'audit-3',
        facilityId,
        userId: 'user-1',
        operationType: 'delete',
        changes: { names: { oldValue: { en: 'Hospital A' }, newValue: null } },
        createdAt: new Date('2024-03-20T09:00:00Z'),
      },
    ];

    mockPrisma.auditEntry.findMany.mockResolvedValue(mockEntries);

    const result = await service.getAuditHistory(facilityId);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(3);
      // Verify chronological order (oldest to newest)
      expect(result.data[0].createdAt).toEqual(new Date('2024-01-01T10:00:00Z'));
      expect(result.data[1].createdAt).toEqual(new Date('2024-02-15T14:30:00Z'));
      expect(result.data[2].createdAt).toEqual(new Date('2024-03-20T09:00:00Z'));
      // Verify data structure
      expect(result.data[0].operationType).toBe('create');
      expect(result.data[1].operationType).toBe('update');
      expect(result.data[2].operationType).toBe('delete');
    }

    expect(mockPrisma.auditEntry.findMany).toHaveBeenCalledWith({
      where: { facilityId },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('should return INVALID_FORMAT error for invalid UUID', async () => {
    const invalidIds = [
      'not-a-uuid',
      '12345',
      '',
      'xyz',
      '550e8400-e29b-41d4-a716',
      '550e8400e29b41d4a716446655440000',  // no dashes
      'ZZZZZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZZZZZZZZZ',
    ];

    for (const invalidId of invalidIds) {
      const result = await service.getAuditHistory(invalidId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_FORMAT');
        expect(result.error.message).toContain('invalid');
        expect(result.error.details).toBeDefined();
        expect(result.error.details![0].field).toBe('id');
      }
    }

    // Should not call the database for invalid UUIDs
    expect(mockPrisma.auditEntry.findMany).not.toHaveBeenCalled();
  });

  it('should return audit history for deleted facilities (no existence check)', async () => {
    // A deleted facility's UUID is still valid — the service should query audit entries
    // without checking if the facility itself still exists
    const deletedFacilityId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const mockEntries = [
      {
        id: 'audit-1',
        facilityId: deletedFacilityId,
        userId: 'admin-user',
        operationType: 'create',
        changes: { names: { oldValue: null, newValue: { en: 'Deleted Clinic' } } },
        createdAt: new Date('2023-06-01T08:00:00Z'),
      },
      {
        id: 'audit-2',
        facilityId: deletedFacilityId,
        userId: 'admin-user',
        operationType: 'delete',
        changes: { names: { oldValue: { en: 'Deleted Clinic' }, newValue: null } },
        createdAt: new Date('2024-01-15T16:00:00Z'),
      },
    ];

    mockPrisma.auditEntry.findMany.mockResolvedValue(mockEntries);

    const result = await service.getAuditHistory(deletedFacilityId);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].operationType).toBe('create');
      expect(result.data[1].operationType).toBe('delete');
    }

    // Verify it queries by facilityId without any existence check
    expect(mockPrisma.auditEntry.findMany).toHaveBeenCalledWith({
      where: { facilityId: deletedFacilityId },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('should return empty array when no audit entries exist', async () => {
    const facilityId = '11111111-2222-3333-4444-555555555555';
    mockPrisma.auditEntry.findMany.mockResolvedValue([]);

    const result = await service.getAuditHistory(facilityId);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
      expect(result.data).toHaveLength(0);
    }
  });
});
