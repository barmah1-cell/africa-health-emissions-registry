/**
 * Unit tests for AuditService
 *
 * Uses mocked Prisma client to verify:
 * - Recording a create audit entry (old values null)
 * - Recording an update audit entry (specific field changes)
 * - Recording a delete audit entry (new values null)
 * - Getting history returns entries sorted by created_at ascending
 * - Audit entries are never modified (no update/delete methods exist)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditService, AuditInput } from '../../src/services/audit.service';
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

describe('AuditService', () => {
  let service: AuditService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new AuditService(mockPrisma as unknown as PrismaClient);
  });

  describe('record', () => {
    it('should record a create audit entry with old values as null', async () => {
      mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-1' });

      const input: AuditInput = {
        facilityId: 'facility-123',
        userId: 'user-456',
        operationType: 'create',
        changes: {
          names: { oldValue: null, newValue: { en: 'Test Hospital' } },
          country: { oldValue: null, newValue: 'Kenya' },
          facilityType: { oldValue: null, newValue: 'hospital' },
          beds: { oldValue: null, newValue: 200 },
        },
      };

      await service.record(input);

      expect(mockPrisma.auditEntry.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.auditEntry.create).toHaveBeenCalledWith({
        data: {
          facilityId: 'facility-123',
          userId: 'user-456',
          operationType: 'create',
          changes: input.changes,
        },
      });
    });

    it('should record an update audit entry with old and new values', async () => {
      mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-2' });

      const input: AuditInput = {
        facilityId: 'facility-123',
        userId: 'user-456',
        operationType: 'update',
        changes: {
          beds: { oldValue: 200, newValue: 350 },
          operationalStatus: { oldValue: 'operational', newValue: 'temporarily_closed' },
        },
      };

      await service.record(input);

      expect(mockPrisma.auditEntry.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.auditEntry.create).toHaveBeenCalledWith({
        data: {
          facilityId: 'facility-123',
          userId: 'user-456',
          operationType: 'update',
          changes: {
            beds: { oldValue: 200, newValue: 350 },
            operationalStatus: { oldValue: 'operational', newValue: 'temporarily_closed' },
          },
        },
      });
    });

    it('should record a delete audit entry with new values as null', async () => {
      mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-3' });

      const input: AuditInput = {
        facilityId: 'facility-123',
        userId: 'user-789',
        operationType: 'delete',
        changes: {
          names: { oldValue: { en: 'Test Hospital' }, newValue: null },
          country: { oldValue: 'Kenya', newValue: null },
          facilityType: { oldValue: 'hospital', newValue: null },
          beds: { oldValue: 200, newValue: null },
        },
      };

      await service.record(input);

      expect(mockPrisma.auditEntry.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.auditEntry.create).toHaveBeenCalledWith({
        data: {
          facilityId: 'facility-123',
          userId: 'user-789',
          operationType: 'delete',
          changes: input.changes,
        },
      });
    });
  });

  describe('getHistory', () => {
    it('should return audit entries sorted by created_at ascending', async () => {
      const mockEntries = [
        {
          id: 'audit-1',
          facilityId: 'facility-123',
          userId: 'user-1',
          operationType: 'create',
          changes: { names: { oldValue: null, newValue: { en: 'Hospital A' } } },
          createdAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'audit-2',
          facilityId: 'facility-123',
          userId: 'user-2',
          operationType: 'update',
          changes: { beds: { oldValue: 100, newValue: 150 } },
          createdAt: new Date('2024-02-15T14:30:00Z'),
        },
        {
          id: 'audit-3',
          facilityId: 'facility-123',
          userId: 'user-1',
          operationType: 'update',
          changes: { operationalStatus: { oldValue: 'operational', newValue: 'temporarily_closed' } },
          createdAt: new Date('2024-03-20T09:00:00Z'),
        },
      ];

      mockPrisma.auditEntry.findMany.mockResolvedValue(mockEntries);

      const history = await service.getHistory('facility-123');

      expect(mockPrisma.auditEntry.findMany).toHaveBeenCalledWith({
        where: { facilityId: 'facility-123' },
        orderBy: { createdAt: 'asc' },
      });

      expect(history).toHaveLength(3);
      expect(history[0].id).toBe('audit-1');
      expect(history[0].operationType).toBe('create');
      expect(history[1].id).toBe('audit-2');
      expect(history[1].operationType).toBe('update');
      expect(history[2].id).toBe('audit-3');
      expect(history[2].createdAt).toEqual(new Date('2024-03-20T09:00:00Z'));
    });

    it('should return an empty array when no audit entries exist', async () => {
      mockPrisma.auditEntry.findMany.mockResolvedValue([]);

      const history = await service.getHistory('nonexistent-facility');

      expect(history).toEqual([]);
      expect(mockPrisma.auditEntry.findMany).toHaveBeenCalledWith({
        where: { facilityId: 'nonexistent-facility' },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('append-only invariant', () => {
    it('should not expose any update or delete methods', () => {
      // Verify the service only has record, getHistory, and getAuditHistory as public methods
      // getAuditHistory is a read-only wrapper around getHistory with UUID validation
      const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(service))
        .filter((name) => name !== 'constructor');

      expect(methods).toContain('record');
      expect(methods).toContain('getHistory');
      expect(methods).toContain('getAuditHistory');
      expect(methods).not.toContain('update');
      expect(methods).not.toContain('delete');
      expect(methods).not.toContain('remove');
      expect(methods).not.toContain('modify');
      expect(methods).toHaveLength(3);
    });
  });
});
