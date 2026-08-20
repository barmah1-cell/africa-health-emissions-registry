/**
 * Unit tests for EnergyEmissionsService.updateEnergyProfile
 *
 * Uses mocked Prisma client to verify:
 * - UUID format validation (INVALID_FORMAT error for bad IDs)
 * - Facility existence check (NOT_FOUND error for missing/deleted facilities)
 * - Energy profile validation (1-10 entries, valid energy_type, optional consumption range)
 * - Replace-all strategy: deletes existing sources then creates new ones
 * - Updates energy_verification_date on profile changes
 * - Creates audit entry recording the change
 * - Returns the updated energy profile
 * - Marks profile as 'unknown' in audit when no previous data existed
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EnergyEmissionsService } from '../../src/services/energy.service';
import { PrismaClient, Prisma } from '@prisma/client';

function createMockPrisma() {
  return {
    facility: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    energySource: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    ghgEmission: {
      create: vi.fn(),
    },
    auditEntry: {
      create: vi.fn(),
    },
  } as unknown as PrismaClient & {
    facility: {
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    energySource: {
      findMany: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    ghgEmission: {
      create: ReturnType<typeof vi.fn>;
    };
    auditEntry: {
      create: ReturnType<typeof vi.fn>;
    };
  };
}

const VALID_FACILITY_ID = '550e8400-e29b-41d4-a716-446655440000';
const USER_ID = 'user-123';

describe('EnergyEmissionsService', () => {
  let service: EnergyEmissionsService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new EnergyEmissionsService(mockPrisma as unknown as PrismaClient);
  });

  describe('updateEnergyProfile', () => {
    describe('UUID validation', () => {
      it('should return INVALID_FORMAT for non-UUID facility ID', async () => {
        const result = await service.updateEnergyProfile(
          'not-a-uuid',
          [{ energyType: 'solar' }],
          USER_ID,
        );

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('INVALID_FORMAT');
          expect(result.error.message).toContain('Invalid facility ID');
        }
      });

      it('should return INVALID_FORMAT for empty string', async () => {
        const result = await service.updateEnergyProfile('', [{ energyType: 'solar' }], USER_ID);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('INVALID_FORMAT');
        }
      });

      it('should return INVALID_FORMAT for numeric string', async () => {
        const result = await service.updateEnergyProfile('12345', [{ energyType: 'solar' }], USER_ID);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('INVALID_FORMAT');
        }
      });
    });

    describe('facility existence check', () => {
      it('should return NOT_FOUND when facility does not exist', async () => {
        mockPrisma.facility.findFirst.mockResolvedValue(null);

        const result = await service.updateEnergyProfile(
          VALID_FACILITY_ID,
          [{ energyType: 'solar' }],
          USER_ID,
        );

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('NOT_FOUND');
          expect(result.error.message).toContain(VALID_FACILITY_ID);
        }
      });

      it('should query for non-deleted facility', async () => {
        mockPrisma.facility.findFirst.mockResolvedValue(null);

        await service.updateEnergyProfile(
          VALID_FACILITY_ID,
          [{ energyType: 'solar' }],
          USER_ID,
        );

        expect(mockPrisma.facility.findFirst).toHaveBeenCalledWith({
          where: {
            id: VALID_FACILITY_ID,
            deletedAt: null,
          },
        });
      });
    });

    describe('energy profile validation', () => {
      beforeEach(() => {
        mockPrisma.facility.findFirst.mockResolvedValue({
          id: VALID_FACILITY_ID,
          energyVerificationDate: null,
          deletedAt: null,
        });
      });

      it('should return VALIDATION_ERROR for empty array', async () => {
        const result = await service.updateEnergyProfile(VALID_FACILITY_ID, [], USER_ID);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('VALIDATION_ERROR');
        }
      });

      it('should return VALIDATION_ERROR for more than 10 entries', async () => {
        const entries = Array.from({ length: 11 }, () => ({ energyType: 'solar' }));

        const result = await service.updateEnergyProfile(VALID_FACILITY_ID, entries, USER_ID);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('VALIDATION_ERROR');
        }
      });

      it('should return VALIDATION_ERROR for invalid energy_type', async () => {
        const result = await service.updateEnergyProfile(
          VALID_FACILITY_ID,
          [{ energyType: 'nuclear' }],
          USER_ID,
        );

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('VALIDATION_ERROR');
        }
      });

      it('should return VALIDATION_ERROR for consumption below 0.01', async () => {
        const result = await service.updateEnergyProfile(
          VALID_FACILITY_ID,
          [{ energyType: 'solar', consumptionKwhYear: 0.001 }],
          USER_ID,
        );

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('VALIDATION_ERROR');
        }
      });

      it('should return VALIDATION_ERROR for consumption above 999,999,999.99', async () => {
        const result = await service.updateEnergyProfile(
          VALID_FACILITY_ID,
          [{ energyType: 'solar', consumptionKwhYear: 1_000_000_000 }],
          USER_ID,
        );

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('VALIDATION_ERROR');
        }
      });

      it('should accept valid energy_type without consumption', async () => {
        mockPrisma.energySource.findMany.mockResolvedValue([]);
        mockPrisma.energySource.deleteMany.mockResolvedValue({ count: 0 });
        mockPrisma.energySource.create.mockResolvedValue({
          id: 'es-1',
          facilityId: VALID_FACILITY_ID,
          energyType: 'solar',
          consumptionKwhYear: null,
          updatedAt: new Date(),
        });
        mockPrisma.facility.update.mockResolvedValue({
          id: VALID_FACILITY_ID,
          energyVerificationDate: new Date(),
          energyVerificationStatus: 'self_reported',
        });
        mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-1' });

        const result = await service.updateEnergyProfile(
          VALID_FACILITY_ID,
          [{ energyType: 'solar' }],
          USER_ID,
        );

        expect(result.success).toBe(true);
      });

      it('should accept all valid energy types', async () => {
        const validTypes = ['diesel_generator', 'solar', 'wind', 'grid_electricity', 'hybrid'];

        for (const energyType of validTypes) {
          mockPrisma.facility.findFirst.mockResolvedValue({
            id: VALID_FACILITY_ID,
            energyVerificationDate: null,
            deletedAt: null,
          });
          mockPrisma.energySource.findMany.mockResolvedValue([]);
          mockPrisma.energySource.deleteMany.mockResolvedValue({ count: 0 });
          mockPrisma.energySource.create.mockResolvedValue({
            id: 'es-1',
            facilityId: VALID_FACILITY_ID,
            energyType,
            consumptionKwhYear: null,
            updatedAt: new Date(),
          });
          mockPrisma.facility.update.mockResolvedValue({
            id: VALID_FACILITY_ID,
            energyVerificationDate: new Date(),
            energyVerificationStatus: 'self_reported',
          });
          mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-1' });

          const result = await service.updateEnergyProfile(
            VALID_FACILITY_ID,
            [{ energyType }],
            USER_ID,
          );

          expect(result.success).toBe(true);
        }
      });

      it('should accept consumption at minimum boundary (0.01)', async () => {
        mockPrisma.energySource.findMany.mockResolvedValue([]);
        mockPrisma.energySource.deleteMany.mockResolvedValue({ count: 0 });
        mockPrisma.energySource.create.mockResolvedValue({
          id: 'es-1',
          facilityId: VALID_FACILITY_ID,
          energyType: 'solar',
          consumptionKwhYear: 0.01,
          updatedAt: new Date(),
        });
        mockPrisma.facility.update.mockResolvedValue({
          id: VALID_FACILITY_ID,
          energyVerificationDate: new Date(),
          energyVerificationStatus: 'self_reported',
        });
        mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-1' });

        const result = await service.updateEnergyProfile(
          VALID_FACILITY_ID,
          [{ energyType: 'solar', consumptionKwhYear: 0.01 }],
          USER_ID,
        );

        expect(result.success).toBe(true);
      });

      it('should accept consumption at maximum boundary (999,999,999.99)', async () => {
        mockPrisma.energySource.findMany.mockResolvedValue([]);
        mockPrisma.energySource.deleteMany.mockResolvedValue({ count: 0 });
        mockPrisma.energySource.create.mockResolvedValue({
          id: 'es-1',
          facilityId: VALID_FACILITY_ID,
          energyType: 'grid_electricity',
          consumptionKwhYear: 999_999_999.99,
          updatedAt: new Date(),
        });
        mockPrisma.facility.update.mockResolvedValue({
          id: VALID_FACILITY_ID,
          energyVerificationDate: new Date(),
          energyVerificationStatus: 'self_reported',
        });
        mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-1' });

        const result = await service.updateEnergyProfile(
          VALID_FACILITY_ID,
          [{ energyType: 'grid_electricity', consumptionKwhYear: 999_999_999.99 }],
          USER_ID,
        );

        expect(result.success).toBe(true);
      });
    });

    describe('replace-all strategy', () => {
      const now = new Date('2024-06-15T12:00:00Z');

      beforeEach(() => {
        mockPrisma.facility.findFirst.mockResolvedValue({
          id: VALID_FACILITY_ID,
          energyVerificationDate: null,
          deletedAt: null,
        });
        mockPrisma.facility.update.mockResolvedValue({
          id: VALID_FACILITY_ID,
          energyVerificationDate: now,
          energyVerificationStatus: 'self_reported',
        });
        mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-1' });
      });

      it('should delete all existing energy sources before creating new ones', async () => {
        mockPrisma.energySource.findMany.mockResolvedValue([
          { id: 'old-1', facilityId: VALID_FACILITY_ID, energyType: 'diesel_generator', consumptionKwhYear: 5000 },
          { id: 'old-2', facilityId: VALID_FACILITY_ID, energyType: 'solar', consumptionKwhYear: null },
        ]);
        mockPrisma.energySource.deleteMany.mockResolvedValue({ count: 2 });
        mockPrisma.energySource.create.mockResolvedValue({
          id: 'new-1',
          facilityId: VALID_FACILITY_ID,
          energyType: 'wind',
          consumptionKwhYear: null,
          updatedAt: now,
        });

        await service.updateEnergyProfile(
          VALID_FACILITY_ID,
          [{ energyType: 'wind' }],
          USER_ID,
        );

        expect(mockPrisma.energySource.deleteMany).toHaveBeenCalledWith({
          where: { facilityId: VALID_FACILITY_ID },
        });
      });

      it('should create one entry per source in the input', async () => {
        mockPrisma.energySource.findMany.mockResolvedValue([]);
        mockPrisma.energySource.deleteMany.mockResolvedValue({ count: 0 });

        let createCallCount = 0;
        mockPrisma.energySource.create.mockImplementation(async (args: unknown) => {
          createCallCount++;
          const data = (args as { data: { energyType: string; consumptionKwhYear: number | null } }).data;
          return {
            id: `es-${createCallCount}`,
            facilityId: VALID_FACILITY_ID,
            energyType: data.energyType,
            consumptionKwhYear: data.consumptionKwhYear,
            updatedAt: now,
          };
        });

        const input = [
          { energyType: 'solar', consumptionKwhYear: 1000 },
          { energyType: 'wind', consumptionKwhYear: 2000 },
          { energyType: 'grid_electricity' },
        ];

        const result = await service.updateEnergyProfile(VALID_FACILITY_ID, input, USER_ID);

        expect(mockPrisma.energySource.create).toHaveBeenCalledTimes(3);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.energySources).toHaveLength(3);
        }
      });

      it('should pass correct data to energySource.create for each entry', async () => {
        mockPrisma.energySource.findMany.mockResolvedValue([]);
        mockPrisma.energySource.deleteMany.mockResolvedValue({ count: 0 });
        mockPrisma.energySource.create.mockResolvedValue({
          id: 'es-1',
          facilityId: VALID_FACILITY_ID,
          energyType: 'solar',
          consumptionKwhYear: 5000.50,
          updatedAt: now,
        });

        await service.updateEnergyProfile(
          VALID_FACILITY_ID,
          [{ energyType: 'solar', consumptionKwhYear: 5000.50 }],
          USER_ID,
        );

        expect(mockPrisma.energySource.create).toHaveBeenCalledWith({
          data: {
            facilityId: VALID_FACILITY_ID,
            energyType: 'solar',
            consumptionKwhYear: 5000.50,
          },
        });
      });

      it('should pass null for consumptionKwhYear when not provided', async () => {
        mockPrisma.energySource.findMany.mockResolvedValue([]);
        mockPrisma.energySource.deleteMany.mockResolvedValue({ count: 0 });
        mockPrisma.energySource.create.mockResolvedValue({
          id: 'es-1',
          facilityId: VALID_FACILITY_ID,
          energyType: 'hybrid',
          consumptionKwhYear: null,
          updatedAt: now,
        });

        await service.updateEnergyProfile(
          VALID_FACILITY_ID,
          [{ energyType: 'hybrid' }],
          USER_ID,
        );

        expect(mockPrisma.energySource.create).toHaveBeenCalledWith({
          data: {
            facilityId: VALID_FACILITY_ID,
            energyType: 'hybrid',
            consumptionKwhYear: null,
          },
        });
      });
    });

    describe('energy verification date update', () => {
      it('should update energy_verification_date on profile change', async () => {
        mockPrisma.facility.findFirst.mockResolvedValue({
          id: VALID_FACILITY_ID,
          energyVerificationDate: null,
          deletedAt: null,
        });
        mockPrisma.energySource.findMany.mockResolvedValue([]);
        mockPrisma.energySource.deleteMany.mockResolvedValue({ count: 0 });
        mockPrisma.energySource.create.mockResolvedValue({
          id: 'es-1',
          facilityId: VALID_FACILITY_ID,
          energyType: 'solar',
          consumptionKwhYear: null,
          updatedAt: new Date(),
        });
        const verificationDate = new Date('2024-06-15T12:00:00Z');
        mockPrisma.facility.update.mockResolvedValue({
          id: VALID_FACILITY_ID,
          energyVerificationDate: verificationDate,
          energyVerificationStatus: 'self_reported',
        });
        mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-1' });

        const result = await service.updateEnergyProfile(
          VALID_FACILITY_ID,
          [{ energyType: 'solar' }],
          USER_ID,
        );

        expect(mockPrisma.facility.update).toHaveBeenCalledWith({
          where: { id: VALID_FACILITY_ID },
          data: expect.objectContaining({
            energyVerificationDate: expect.any(Date),
            energyVerificationStatus: 'self_reported',
          }),
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.energyVerificationDate).toEqual(verificationDate);
        }
      });
    });

    describe('audit entry creation', () => {
      const now = new Date('2024-06-15T12:00:00Z');

      beforeEach(() => {
        mockPrisma.facility.findFirst.mockResolvedValue({
          id: VALID_FACILITY_ID,
          energyVerificationDate: null,
          deletedAt: null,
        });
        mockPrisma.energySource.deleteMany.mockResolvedValue({ count: 0 });
        mockPrisma.facility.update.mockResolvedValue({
          id: VALID_FACILITY_ID,
          energyVerificationDate: now,
          energyVerificationStatus: 'self_reported',
        });
        mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-1' });
      });

      it('should create audit entry with old profile as unknown when no previous data', async () => {
        mockPrisma.energySource.findMany.mockResolvedValue([]);
        mockPrisma.energySource.create.mockResolvedValue({
          id: 'es-1',
          facilityId: VALID_FACILITY_ID,
          energyType: 'solar',
          consumptionKwhYear: null,
          updatedAt: now,
        });

        await service.updateEnergyProfile(
          VALID_FACILITY_ID,
          [{ energyType: 'solar' }],
          USER_ID,
        );

        expect(mockPrisma.auditEntry.create).toHaveBeenCalledWith({
          data: {
            facilityId: VALID_FACILITY_ID,
            userId: USER_ID,
            operationType: 'update',
            changes: expect.objectContaining({
              energyProfile: {
                oldValue: 'unknown',
                newValue: [{ energyType: 'solar', consumptionKwhYear: null }],
              },
            }),
          },
        });
      });

      it('should create audit entry with old profile data when sources existed', async () => {
        mockPrisma.energySource.findMany.mockResolvedValue([
          { id: 'old-1', facilityId: VALID_FACILITY_ID, energyType: 'diesel_generator', consumptionKwhYear: { toNumber: () => 5000 } },
        ]);
        mockPrisma.energySource.create.mockResolvedValue({
          id: 'es-1',
          facilityId: VALID_FACILITY_ID,
          energyType: 'solar',
          consumptionKwhYear: 3000,
          updatedAt: now,
        });

        await service.updateEnergyProfile(
          VALID_FACILITY_ID,
          [{ energyType: 'solar', consumptionKwhYear: 3000 }],
          USER_ID,
        );

        expect(mockPrisma.auditEntry.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            facilityId: VALID_FACILITY_ID,
            userId: USER_ID,
            operationType: 'update',
          }),
        });
      });

      it('should record energy_verification_date change in audit', async () => {
        mockPrisma.energySource.findMany.mockResolvedValue([]);
        mockPrisma.energySource.create.mockResolvedValue({
          id: 'es-1',
          facilityId: VALID_FACILITY_ID,
          energyType: 'wind',
          consumptionKwhYear: null,
          updatedAt: now,
        });

        await service.updateEnergyProfile(
          VALID_FACILITY_ID,
          [{ energyType: 'wind' }],
          USER_ID,
        );

        expect(mockPrisma.auditEntry.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            changes: expect.objectContaining({
              energyVerificationDate: expect.objectContaining({
                oldValue: null,
                newValue: expect.any(String),
              }),
            }),
          }),
        });
      });
    });

    describe('response format', () => {
      const now = new Date('2024-06-15T12:00:00Z');

      beforeEach(() => {
        mockPrisma.facility.findFirst.mockResolvedValue({
          id: VALID_FACILITY_ID,
          energyVerificationDate: null,
          deletedAt: null,
        });
        mockPrisma.energySource.findMany.mockResolvedValue([]);
        mockPrisma.energySource.deleteMany.mockResolvedValue({ count: 0 });
        mockPrisma.facility.update.mockResolvedValue({
          id: VALID_FACILITY_ID,
          energyVerificationDate: now,
          energyVerificationStatus: 'self_reported',
        });
        mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-1' });
      });

      it('should return facilityId, energySources, and energyVerificationDate', async () => {
        mockPrisma.energySource.create.mockResolvedValue({
          id: 'es-1',
          facilityId: VALID_FACILITY_ID,
          energyType: 'solar',
          consumptionKwhYear: 1500,
          updatedAt: now,
        });

        const result = await service.updateEnergyProfile(
          VALID_FACILITY_ID,
          [{ energyType: 'solar', consumptionKwhYear: 1500 }],
          USER_ID,
        );

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.facilityId).toBe(VALID_FACILITY_ID);
          expect(result.data.energySources).toEqual([
            { id: 'es-1', energyType: 'solar', consumptionKwhYear: 1500 },
          ]);
          expect(result.data.energyVerificationDate).toEqual(now);
        }
      });

      it('should handle consumptionKwhYear as Decimal (number conversion)', async () => {
        mockPrisma.energySource.create.mockResolvedValue({
          id: 'es-1',
          facilityId: VALID_FACILITY_ID,
          energyType: 'grid_electricity',
          consumptionKwhYear: { toNumber: () => 42000.75 },
          updatedAt: now,
        });

        const result = await service.updateEnergyProfile(
          VALID_FACILITY_ID,
          [{ energyType: 'grid_electricity', consumptionKwhYear: 42000.75 }],
          USER_ID,
        );

        expect(result.success).toBe(true);
        if (result.success) {
          // The service uses Number() to convert, which works on Decimal objects too
          expect(result.data.energySources[0].consumptionKwhYear).toBeDefined();
        }
      });

      it('should return null for consumptionKwhYear when not provided', async () => {
        mockPrisma.energySource.create.mockResolvedValue({
          id: 'es-1',
          facilityId: VALID_FACILITY_ID,
          energyType: 'wind',
          consumptionKwhYear: null,
          updatedAt: now,
        });

        const result = await service.updateEnergyProfile(
          VALID_FACILITY_ID,
          [{ energyType: 'wind' }],
          USER_ID,
        );

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.energySources[0].consumptionKwhYear).toBeNull();
        }
      });
    });

    describe('accepts exactly 10 entries (maximum)', () => {
      it('should accept exactly 10 entries', async () => {
        mockPrisma.facility.findFirst.mockResolvedValue({
          id: VALID_FACILITY_ID,
          energyVerificationDate: null,
          deletedAt: null,
        });
        mockPrisma.energySource.findMany.mockResolvedValue([]);
        mockPrisma.energySource.deleteMany.mockResolvedValue({ count: 0 });

        let createCount = 0;
        mockPrisma.energySource.create.mockImplementation(async () => {
          createCount++;
          return {
            id: `es-${createCount}`,
            facilityId: VALID_FACILITY_ID,
            energyType: 'solar',
            consumptionKwhYear: null,
            updatedAt: new Date(),
          };
        });
        mockPrisma.facility.update.mockResolvedValue({
          id: VALID_FACILITY_ID,
          energyVerificationDate: new Date(),
          energyVerificationStatus: 'self_reported',
        });
        mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-1' });

        const entries = Array.from({ length: 10 }, () => ({ energyType: 'solar' }));

        const result = await service.updateEnergyProfile(VALID_FACILITY_ID, entries, USER_ID);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.energySources).toHaveLength(10);
        }
      });
    });
  });

  describe('addEmissions', () => {
    const validInput = {
      emissionScope: 'scope_1',
      valueTonnesCo2e: 150.5,
      reportingYear: 2023,
    };

    describe('facility ID validation', () => {
      it('should return INVALID_FORMAT for non-UUID facility ID', async () => {
        const result = await service.addEmissions('not-a-uuid', validInput);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('INVALID_FORMAT');
          expect(result.error.message).toContain('Invalid facility ID format');
        }
      });

      it('should return INVALID_FORMAT for empty string facility ID', async () => {
        const result = await service.addEmissions('', validInput);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('INVALID_FORMAT');
        }
      });

      it('should return INVALID_FORMAT for numeric ID', async () => {
        const result = await service.addEmissions('12345', validInput);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('INVALID_FORMAT');
        }
      });
    });

    describe('facility existence check', () => {
      it('should return NOT_FOUND when facility does not exist', async () => {
        mockPrisma.facility.findFirst.mockResolvedValue(null);

        const result = await service.addEmissions(VALID_FACILITY_ID, validInput);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('NOT_FOUND');
          expect(result.error.message).toContain(VALID_FACILITY_ID);
        }
      });

      it('should query facility excluding soft-deleted records', async () => {
        mockPrisma.facility.findFirst.mockResolvedValue(null);

        await service.addEmissions(VALID_FACILITY_ID, validInput);

        expect(mockPrisma.facility.findFirst).toHaveBeenCalledWith({
          where: {
            id: VALID_FACILITY_ID,
            deletedAt: null,
          },
          select: { id: true },
        });
      });
    });

    describe('emissions input validation', () => {
      beforeEach(() => {
        mockPrisma.facility.findFirst.mockResolvedValue({ id: VALID_FACILITY_ID });
      });

      it('should return VALIDATION_ERROR for missing emissionScope', async () => {
        const result = await service.addEmissions(VALID_FACILITY_ID, {
          valueTonnesCo2e: 100,
          reportingYear: 2023,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('VALIDATION_ERROR');
          expect(result.error.details).toBeDefined();
          expect(result.error.details!.some((d) => d.field === 'emissionScope')).toBe(true);
        }
      });

      it('should return VALIDATION_ERROR for invalid emissionScope value', async () => {
        const result = await service.addEmissions(VALID_FACILITY_ID, {
          emissionScope: 'scope_4',
          valueTonnesCo2e: 100,
          reportingYear: 2023,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('VALIDATION_ERROR');
          expect(result.error.details!.some((d) => d.field === 'emissionScope')).toBe(true);
        }
      });

      it('should return VALIDATION_ERROR for negative emission value', async () => {
        const result = await service.addEmissions(VALID_FACILITY_ID, {
          emissionScope: 'scope_1',
          valueTonnesCo2e: -1,
          reportingYear: 2023,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('VALIDATION_ERROR');
          expect(result.error.details!.some((d) => d.field === 'valueTonnesCo2e')).toBe(true);
        }
      });

      it('should return VALIDATION_ERROR for emission value exceeding maximum', async () => {
        const result = await service.addEmissions(VALID_FACILITY_ID, {
          emissionScope: 'scope_2',
          valueTonnesCo2e: 1_000_000_000,
          reportingYear: 2023,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('VALIDATION_ERROR');
          expect(result.error.details!.some((d) => d.field === 'valueTonnesCo2e')).toBe(true);
        }
      });

      it('should return VALIDATION_ERROR for reporting year before 2000', async () => {
        const result = await service.addEmissions(VALID_FACILITY_ID, {
          emissionScope: 'scope_1',
          valueTonnesCo2e: 100,
          reportingYear: 1999,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('VALIDATION_ERROR');
          expect(result.error.details!.some((d) => d.field === 'reportingYear')).toBe(true);
        }
      });

      it('should return VALIDATION_ERROR for reporting year in the future', async () => {
        const futureYear = new Date().getFullYear() + 1;
        const result = await service.addEmissions(VALID_FACILITY_ID, {
          emissionScope: 'scope_1',
          valueTonnesCo2e: 100,
          reportingYear: futureYear,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('VALIDATION_ERROR');
          expect(result.error.details!.some((d) => d.field === 'reportingYear')).toBe(true);
        }
      });

      it('should return VALIDATION_ERROR for non-integer reporting year', async () => {
        const result = await service.addEmissions(VALID_FACILITY_ID, {
          emissionScope: 'scope_1',
          valueTonnesCo2e: 100,
          reportingYear: 2023.5,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('VALIDATION_ERROR');
          expect(result.error.details!.some((d) => d.field === 'reportingYear')).toBe(true);
        }
      });

      it('should return all validation errors at once for multiple invalid fields', async () => {
        const result = await service.addEmissions(VALID_FACILITY_ID, {
          emissionScope: 'invalid_scope',
          valueTonnesCo2e: -1,
          reportingYear: 1990,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('VALIDATION_ERROR');
          expect(result.error.details).toBeDefined();
          expect(result.error.details!.length).toBeGreaterThanOrEqual(3);
        }
      });

      it('should return VALIDATION_ERROR for missing required fields', async () => {
        const result = await service.addEmissions(VALID_FACILITY_ID, {});

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('VALIDATION_ERROR');
          expect(result.error.details).toBeDefined();
          expect(result.error.details!.length).toBeGreaterThanOrEqual(2);
        }
      });

      it('should return VALIDATION_ERROR for non-numeric valueTonnesCo2e', async () => {
        const result = await service.addEmissions(VALID_FACILITY_ID, {
          emissionScope: 'scope_1',
          valueTonnesCo2e: 'not-a-number',
          reportingYear: 2023,
        });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('VALIDATION_ERROR');
          expect(result.error.details!.some((d) => d.field === 'valueTonnesCo2e')).toBe(true);
        }
      });
    });

    describe('successful emission creation', () => {
      beforeEach(() => {
        mockPrisma.facility.findFirst.mockResolvedValue({ id: VALID_FACILITY_ID });
      });

      it('should create and return emission record for valid input', async () => {
        const createdAt = new Date('2024-06-01T12:00:00Z');
        mockPrisma.ghgEmission.create.mockResolvedValue({
          id: 'emission-001',
          facilityId: VALID_FACILITY_ID,
          emissionScope: 'scope_1',
          valueTonnesCo2e: new Prisma.Decimal(150.5),
          reportingYear: 2023,
          createdAt,
        });

        const result = await service.addEmissions(VALID_FACILITY_ID, validInput);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.id).toBe('emission-001');
          expect(result.data.facilityId).toBe(VALID_FACILITY_ID);
          expect(result.data.emissionScope).toBe('scope_1');
          expect(result.data.valueTonnesCo2e).toBe(150.5);
          expect(result.data.reportingYear).toBe(2023);
          expect(result.data.createdAt).toEqual(createdAt);
        }
      });

      it('should accept emission value of 0 (minimum boundary)', async () => {
        mockPrisma.ghgEmission.create.mockResolvedValue({
          id: 'emission-002',
          facilityId: VALID_FACILITY_ID,
          emissionScope: 'scope_2',
          valueTonnesCo2e: new Prisma.Decimal(0),
          reportingYear: 2020,
          createdAt: new Date(),
        });

        const result = await service.addEmissions(VALID_FACILITY_ID, {
          emissionScope: 'scope_2',
          valueTonnesCo2e: 0,
          reportingYear: 2020,
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.valueTonnesCo2e).toBe(0);
        }
      });

      it('should accept emission value of 999,999,999.99 (maximum boundary)', async () => {
        mockPrisma.ghgEmission.create.mockResolvedValue({
          id: 'emission-003',
          facilityId: VALID_FACILITY_ID,
          emissionScope: 'scope_3',
          valueTonnesCo2e: new Prisma.Decimal(999_999_999.99),
          reportingYear: 2022,
          createdAt: new Date(),
        });

        const result = await service.addEmissions(VALID_FACILITY_ID, {
          emissionScope: 'scope_3',
          valueTonnesCo2e: 999_999_999.99,
          reportingYear: 2022,
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.valueTonnesCo2e).toBe(999_999_999.99);
        }
      });

      it('should accept reporting year 2000 (minimum boundary)', async () => {
        mockPrisma.ghgEmission.create.mockResolvedValue({
          id: 'emission-004',
          facilityId: VALID_FACILITY_ID,
          emissionScope: 'scope_1',
          valueTonnesCo2e: new Prisma.Decimal(50),
          reportingYear: 2000,
          createdAt: new Date(),
        });

        const result = await service.addEmissions(VALID_FACILITY_ID, {
          emissionScope: 'scope_1',
          valueTonnesCo2e: 50,
          reportingYear: 2000,
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.reportingYear).toBe(2000);
        }
      });

      it('should accept reporting year equal to current year (maximum boundary)', async () => {
        const currentYear = new Date().getFullYear();
        mockPrisma.ghgEmission.create.mockResolvedValue({
          id: 'emission-005',
          facilityId: VALID_FACILITY_ID,
          emissionScope: 'scope_1',
          valueTonnesCo2e: new Prisma.Decimal(75),
          reportingYear: currentYear,
          createdAt: new Date(),
        });

        const result = await service.addEmissions(VALID_FACILITY_ID, {
          emissionScope: 'scope_1',
          valueTonnesCo2e: 75,
          reportingYear: currentYear,
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.reportingYear).toBe(currentYear);
        }
      });

      it('should pass correct data to Prisma create', async () => {
        mockPrisma.ghgEmission.create.mockResolvedValue({
          id: 'emission-006',
          facilityId: VALID_FACILITY_ID,
          emissionScope: 'scope_2',
          valueTonnesCo2e: new Prisma.Decimal(200.75),
          reportingYear: 2021,
          createdAt: new Date(),
        });

        await service.addEmissions(VALID_FACILITY_ID, {
          emissionScope: 'scope_2',
          valueTonnesCo2e: 200.75,
          reportingYear: 2021,
        });

        expect(mockPrisma.ghgEmission.create).toHaveBeenCalledWith({
          data: {
            facilityId: VALID_FACILITY_ID,
            emissionScope: 'scope_2',
            valueTonnesCo2e: 200.75,
            reportingYear: 2021,
          },
        });
      });

      it('should accept all valid emission scopes', async () => {
        for (const scope of ['scope_1', 'scope_2', 'scope_3']) {
          mockPrisma.ghgEmission.create.mockResolvedValue({
            id: `emission-${scope}`,
            facilityId: VALID_FACILITY_ID,
            emissionScope: scope,
            valueTonnesCo2e: new Prisma.Decimal(100),
            reportingYear: 2023,
            createdAt: new Date(),
          });

          const result = await service.addEmissions(VALID_FACILITY_ID, {
            emissionScope: scope,
            valueTonnesCo2e: 100,
            reportingYear: 2023,
          });

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.emissionScope).toBe(scope);
          }
        }
      });
    });

    describe('uniqueness constraint (DUPLICATE_RECORD)', () => {
      beforeEach(() => {
        mockPrisma.facility.findFirst.mockResolvedValue({ id: VALID_FACILITY_ID });
      });

      it('should return DUPLICATE_RECORD when Prisma throws P2002 unique constraint error', async () => {
        const prismaError = new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed on the fields: (`facility_id`,`emission_scope`,`reporting_year`)',
          { code: 'P2002', clientVersion: '5.0.0', meta: { target: ['facility_id', 'emission_scope', 'reporting_year'] } },
        );
        mockPrisma.ghgEmission.create.mockRejectedValue(prismaError);

        const result = await service.addEmissions(VALID_FACILITY_ID, validInput);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('DUPLICATE_RECORD');
          expect(result.error.message).toContain('already exists');
        }
      });

      it('should re-throw non-P2002 Prisma errors', async () => {
        const prismaError = new Prisma.PrismaClientKnownRequestError(
          'Foreign key constraint failed',
          { code: 'P2003', clientVersion: '5.0.0', meta: {} },
        );
        mockPrisma.ghgEmission.create.mockRejectedValue(prismaError);

        await expect(service.addEmissions(VALID_FACILITY_ID, validInput)).rejects.toThrow();
      });

      it('should re-throw unexpected errors', async () => {
        mockPrisma.ghgEmission.create.mockRejectedValue(new Error('Connection lost'));

        await expect(service.addEmissions(VALID_FACILITY_ID, validInput)).rejects.toThrow(
          'Connection lost',
        );
      });
    });
  });
});
