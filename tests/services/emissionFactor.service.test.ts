/**
 * Unit tests for EmissionFactorService
 *
 * Uses mocked Prisma client to verify:
 * - Create: validates input, handles duplicates (P2002), returns created record
 * - Update: validates UUID, validates input, checks existence, checks uniqueness, returns updated record
 * - Delete: validates UUID, checks existence, returns deleted record
 * - Validation: country must be African nation, factor positive and <= 100, referenceYear 1990-current
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmissionFactorService } from '../../src/services/emissionFactor.service';
import { PrismaClient, Prisma } from '@prisma/client';

function createMockPrisma() {
  return {
    emissionFactor: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  } as unknown as PrismaClient & {
    emissionFactor: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
  };
}

const VALID_INPUT = {
  country: 'Kenya',
  energySourceType: 'grid_electricity',
  factorKgCo2ePerKwh: 0.5,
  referenceYear: 2023,
};

const MOCK_RECORD = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  country: 'Kenya',
  energySourceType: 'grid_electricity',
  factorKgCo2ePerKwh: new Prisma.Decimal(0.5),
  referenceYear: 2023,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
};

describe('EmissionFactorService', () => {
  let service: EmissionFactorService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new EmissionFactorService(mockPrisma as unknown as PrismaClient);
  });

  describe('create', () => {
    it('should create an emission factor with valid input', async () => {
      mockPrisma.emissionFactor.create.mockResolvedValue(MOCK_RECORD);

      const result = await service.create(VALID_INPUT, 'admin-user-1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe('550e8400-e29b-41d4-a716-446655440000');
        expect(result.data.country).toBe('Kenya');
        expect(result.data.energySourceType).toBe('grid_electricity');
        expect(result.data.factorKgCo2ePerKwh).toBe(0.5);
        expect(result.data.referenceYear).toBe(2023);
      }

      expect(mockPrisma.emissionFactor.create).toHaveBeenCalledWith({
        data: {
          country: 'Kenya',
          energySourceType: 'grid_electricity',
          factorKgCo2ePerKwh: 0.5,
          referenceYear: 2023,
        },
      });
    });

    it('should return validation error for non-African country', async () => {
      const input = { ...VALID_INPUT, country: 'Germany' };

      const result = await service.create(input, 'admin-user-1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details).toBeDefined();
        expect(result.error.details!.some((d) => d.field === 'country')).toBe(true);
      }
    });

    it('should return validation error for invalid energy source type', async () => {
      const input = { ...VALID_INPUT, energySourceType: 'nuclear' };

      const result = await service.create(input, 'admin-user-1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details!.some((d) => d.field === 'energySourceType')).toBe(true);
      }
    });

    it('should return validation error for factor <= 0', async () => {
      const input = { ...VALID_INPUT, factorKgCo2ePerKwh: 0 };

      const result = await service.create(input, 'admin-user-1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details!.some((d) => d.field === 'factorKgCo2ePerKwh')).toBe(true);
      }
    });

    it('should return validation error for factor > 100', async () => {
      const input = { ...VALID_INPUT, factorKgCo2ePerKwh: 100.1 };

      const result = await service.create(input, 'admin-user-1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details!.some((d) => d.field === 'factorKgCo2ePerKwh')).toBe(true);
      }
    });

    it('should return validation error for reference year before 1990', async () => {
      const input = { ...VALID_INPUT, referenceYear: 1989 };

      const result = await service.create(input, 'admin-user-1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details!.some((d) => d.field === 'referenceYear')).toBe(true);
      }
    });

    it('should return validation error for reference year in the future', async () => {
      const input = { ...VALID_INPUT, referenceYear: new Date().getFullYear() + 1 };

      const result = await service.create(input, 'admin-user-1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details!.some((d) => d.field === 'referenceYear')).toBe(true);
      }
    });

    it('should return validation error for non-integer reference year', async () => {
      const input = { ...VALID_INPUT, referenceYear: 2023.5 };

      const result = await service.create(input, 'admin-user-1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details!.some((d) => d.field === 'referenceYear')).toBe(true);
      }
    });

    it('should return DUPLICATE_RECORD when P2002 is thrown', async () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '5.0.0', meta: { target: ['country', 'energy_source_type', 'reference_year'] } },
      );
      mockPrisma.emissionFactor.create.mockRejectedValue(prismaError);

      const result = await service.create(VALID_INPUT, 'admin-user-1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('DUPLICATE_RECORD');
        expect(result.error.message).toContain('same country, energy source type, and reference year');
      }
    });

    it('should collect all validation errors at once', async () => {
      const input = {
        country: 'France',
        energySourceType: 'nuclear',
        factorKgCo2ePerKwh: -5,
        referenceYear: 1985,
      };

      const result = await service.create(input, 'admin-user-1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        // Should have errors for country, energySourceType, factorKgCo2ePerKwh, and referenceYear
        expect(result.error.details!.length).toBeGreaterThanOrEqual(4);
      }
    });

    it('should rethrow non-P2002 Prisma errors', async () => {
      const otherError = new Error('Database connection lost');
      mockPrisma.emissionFactor.create.mockRejectedValue(otherError);

      await expect(service.create(VALID_INPUT, 'admin-user-1')).rejects.toThrow(
        'Database connection lost',
      );
    });
  });

  describe('update', () => {
    it('should update an existing emission factor', async () => {
      mockPrisma.emissionFactor.findUnique.mockResolvedValue(MOCK_RECORD);
      mockPrisma.emissionFactor.findFirst.mockResolvedValue(null);
      const updatedRecord = { ...MOCK_RECORD, factorKgCo2ePerKwh: new Prisma.Decimal(0.75) };
      mockPrisma.emissionFactor.update.mockResolvedValue(updatedRecord);

      const updatedInput = { ...VALID_INPUT, factorKgCo2ePerKwh: 0.75 };
      const result = await service.update(MOCK_RECORD.id, updatedInput, 'admin-user-1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.factorKgCo2ePerKwh).toBe(0.75);
      }
    });

    it('should return INVALID_FORMAT for non-UUID id', async () => {
      const result = await service.update('not-a-uuid', VALID_INPUT, 'admin-user-1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_FORMAT');
        expect(result.error.message).toContain('UUID');
      }
    });

    it('should return validation error for invalid input', async () => {
      const input = { ...VALID_INPUT, factorKgCo2ePerKwh: -1 };

      const result = await service.update(MOCK_RECORD.id, input, 'admin-user-1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should return NOT_FOUND if emission factor does not exist', async () => {
      mockPrisma.emissionFactor.findUnique.mockResolvedValue(null);

      const result = await service.update(MOCK_RECORD.id, VALID_INPUT, 'admin-user-1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toContain(MOCK_RECORD.id);
      }
    });

    it('should return DUPLICATE_RECORD if uniqueness conflict exists', async () => {
      mockPrisma.emissionFactor.findUnique.mockResolvedValue(MOCK_RECORD);
      // Another record with the same unique key exists
      mockPrisma.emissionFactor.findFirst.mockResolvedValue({
        ...MOCK_RECORD,
        id: 'other-id-00000000-0000-0000-0000-000000000001',
      });

      const result = await service.update(MOCK_RECORD.id, VALID_INPUT, 'admin-user-1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('DUPLICATE_RECORD');
      }
    });

    it('should check uniqueness excluding the current record', async () => {
      mockPrisma.emissionFactor.findUnique.mockResolvedValue(MOCK_RECORD);
      mockPrisma.emissionFactor.findFirst.mockResolvedValue(null);
      mockPrisma.emissionFactor.update.mockResolvedValue(MOCK_RECORD);

      await service.update(MOCK_RECORD.id, VALID_INPUT, 'admin-user-1');

      expect(mockPrisma.emissionFactor.findFirst).toHaveBeenCalledWith({
        where: {
          country: 'Kenya',
          energySourceType: 'grid_electricity',
          referenceYear: 2023,
          id: { not: MOCK_RECORD.id },
        },
      });
    });

    it('should handle P2002 during update (race condition)', async () => {
      mockPrisma.emissionFactor.findUnique.mockResolvedValue(MOCK_RECORD);
      mockPrisma.emissionFactor.findFirst.mockResolvedValue(null);
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '5.0.0', meta: { target: ['country', 'energy_source_type', 'reference_year'] } },
      );
      mockPrisma.emissionFactor.update.mockRejectedValue(prismaError);

      const result = await service.update(MOCK_RECORD.id, VALID_INPUT, 'admin-user-1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('DUPLICATE_RECORD');
      }
    });
  });

  describe('delete', () => {
    it('should delete an existing emission factor', async () => {
      mockPrisma.emissionFactor.findUnique.mockResolvedValue(MOCK_RECORD);
      mockPrisma.emissionFactor.delete.mockResolvedValue(MOCK_RECORD);

      const result = await service.delete(MOCK_RECORD.id, 'admin-user-1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(MOCK_RECORD.id);
        expect(result.data.country).toBe('Kenya');
      }

      expect(mockPrisma.emissionFactor.delete).toHaveBeenCalledWith({
        where: { id: MOCK_RECORD.id },
      });
    });

    it('should return INVALID_FORMAT for non-UUID id', async () => {
      const result = await service.delete('invalid-id', 'admin-user-1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_FORMAT');
        expect(result.error.message).toContain('UUID');
      }
    });

    it('should return NOT_FOUND if emission factor does not exist', async () => {
      mockPrisma.emissionFactor.findUnique.mockResolvedValue(null);

      const result = await service.delete(MOCK_RECORD.id, 'admin-user-1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toContain(MOCK_RECORD.id);
      }
    });
  });

  describe('supports multiple entries per country (versioned by referenceYear)', () => {
    it('should allow creating different reference years for same country and energy type', async () => {
      const record2022 = { ...MOCK_RECORD, referenceYear: 2022 };
      mockPrisma.emissionFactor.create.mockResolvedValue(record2022);

      const input2022 = { ...VALID_INPUT, referenceYear: 2022 };
      const result = await service.create(input2022, 'admin-user-1');

      expect(result.success).toBe(true);
      expect(mockPrisma.emissionFactor.create).toHaveBeenCalledWith({
        data: {
          country: 'Kenya',
          energySourceType: 'grid_electricity',
          factorKgCo2ePerKwh: 0.5,
          referenceYear: 2022,
        },
      });
    });

    it('should allow creating different energy sources for same country and year', async () => {
      const solarRecord = { ...MOCK_RECORD, energySourceType: 'solar', factorKgCo2ePerKwh: new Prisma.Decimal(0.05) };
      mockPrisma.emissionFactor.create.mockResolvedValue(solarRecord);

      const solarInput = { ...VALID_INPUT, energySourceType: 'solar', factorKgCo2ePerKwh: 0.05 };
      const result = await service.create(solarInput, 'admin-user-1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.energySourceType).toBe('solar');
      }
    });
  });

  describe('list', () => {
    const MOCK_RECORDS = [
      {
        ...MOCK_RECORD,
        id: '550e8400-e29b-41d4-a716-446655440001',
        country: 'Kenya',
        energySourceType: 'grid_electricity',
        referenceYear: 2023,
      },
      {
        ...MOCK_RECORD,
        id: '550e8400-e29b-41d4-a716-446655440002',
        country: 'Kenya',
        energySourceType: 'solar',
        factorKgCo2ePerKwh: new Prisma.Decimal(0.05),
        referenceYear: 2023,
      },
      {
        ...MOCK_RECORD,
        id: '550e8400-e29b-41d4-a716-446655440003',
        country: 'Nigeria',
        energySourceType: 'grid_electricity',
        factorKgCo2ePerKwh: new Prisma.Decimal(0.45),
        referenceYear: 2022,
      },
    ];

    it('should return all emission factors when no filters provided', async () => {
      mockPrisma.emissionFactor.findMany.mockResolvedValue(MOCK_RECORDS);

      const result = await service.list();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(3);
      }

      expect(mockPrisma.emissionFactor.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: [
          { country: 'asc' },
          { energySourceType: 'asc' },
          { referenceYear: 'desc' },
        ],
      });
    });

    it('should filter by country', async () => {
      const kenyaRecords = MOCK_RECORDS.filter((r) => r.country === 'Kenya');
      mockPrisma.emissionFactor.findMany.mockResolvedValue(kenyaRecords);

      const result = await service.list({ country: 'Kenya' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
        expect(result.data.every((d) => d.country === 'Kenya')).toBe(true);
      }

      expect(mockPrisma.emissionFactor.findMany).toHaveBeenCalledWith({
        where: { country: 'Kenya' },
        orderBy: [
          { country: 'asc' },
          { energySourceType: 'asc' },
          { referenceYear: 'desc' },
        ],
      });
    });

    it('should filter by energy source type', async () => {
      const gridRecords = MOCK_RECORDS.filter((r) => r.energySourceType === 'grid_electricity');
      mockPrisma.emissionFactor.findMany.mockResolvedValue(gridRecords);

      const result = await service.list({ energySourceType: 'grid_electricity' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
        expect(result.data.every((d) => d.energySourceType === 'grid_electricity')).toBe(true);
      }

      expect(mockPrisma.emissionFactor.findMany).toHaveBeenCalledWith({
        where: { energySourceType: 'grid_electricity' },
        orderBy: [
          { country: 'asc' },
          { energySourceType: 'asc' },
          { referenceYear: 'desc' },
        ],
      });
    });

    it('should filter by both country and energy source type', async () => {
      const filtered = MOCK_RECORDS.filter(
        (r) => r.country === 'Kenya' && r.energySourceType === 'grid_electricity',
      );
      mockPrisma.emissionFactor.findMany.mockResolvedValue(filtered);

      const result = await service.list({ country: 'Kenya', energySourceType: 'grid_electricity' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].country).toBe('Kenya');
        expect(result.data[0].energySourceType).toBe('grid_electricity');
      }

      expect(mockPrisma.emissionFactor.findMany).toHaveBeenCalledWith({
        where: { country: 'Kenya', energySourceType: 'grid_electricity' },
        orderBy: [
          { country: 'asc' },
          { energySourceType: 'asc' },
          { referenceYear: 'desc' },
        ],
      });
    });

    it('should return empty array when no emission factors match', async () => {
      mockPrisma.emissionFactor.findMany.mockResolvedValue([]);

      const result = await service.list({ country: 'Zambia' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(0);
      }
    });

    it('should convert Decimal factor values to numbers', async () => {
      mockPrisma.emissionFactor.findMany.mockResolvedValue([MOCK_RECORDS[0]]);

      const result = await service.list({ country: 'Kenya' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data[0].factorKgCo2ePerKwh).toBe('number');
      }
    });
  });

  describe('findByCountryAndSource', () => {
    it('should return the most recent factor not exceeding maxYear', async () => {
      const record2022 = {
        ...MOCK_RECORD,
        referenceYear: 2022,
        factorKgCo2ePerKwh: new Prisma.Decimal(0.48),
      };
      mockPrisma.emissionFactor.findFirst.mockResolvedValue(record2022);

      const result = await service.findByCountryAndSource('Kenya', 'grid_electricity', 2023);

      expect(result).not.toBeNull();
      expect(result!.country).toBe('Kenya');
      expect(result!.energySourceType).toBe('grid_electricity');
      expect(result!.referenceYear).toBe(2022);
      expect(result!.factorKgCo2ePerKwh).toBe(0.48);

      expect(mockPrisma.emissionFactor.findFirst).toHaveBeenCalledWith({
        where: {
          country: 'Kenya',
          energySourceType: 'grid_electricity',
          referenceYear: { lte: 2023 },
        },
        orderBy: { referenceYear: 'desc' },
      });
    });

    it('should return null when no matching factor exists', async () => {
      mockPrisma.emissionFactor.findFirst.mockResolvedValue(null);

      const result = await service.findByCountryAndSource('Zambia', 'wind', 2020);

      expect(result).toBeNull();
    });

    it('should return exact year match if available', async () => {
      const exactMatch = {
        ...MOCK_RECORD,
        referenceYear: 2023,
      };
      mockPrisma.emissionFactor.findFirst.mockResolvedValue(exactMatch);

      const result = await service.findByCountryAndSource('Kenya', 'grid_electricity', 2023);

      expect(result).not.toBeNull();
      expect(result!.referenceYear).toBe(2023);
    });

    it('should not return factors with reference year greater than maxYear', async () => {
      // Prisma should filter these out, so findFirst returns null
      mockPrisma.emissionFactor.findFirst.mockResolvedValue(null);

      const result = await service.findByCountryAndSource('Kenya', 'grid_electricity', 2019);

      expect(result).toBeNull();

      // Verify the query constrains by lte
      expect(mockPrisma.emissionFactor.findFirst).toHaveBeenCalledWith({
        where: {
          country: 'Kenya',
          energySourceType: 'grid_electricity',
          referenceYear: { lte: 2019 },
        },
        orderBy: { referenceYear: 'desc' },
      });
    });

    it('should convert Decimal factor value to number', async () => {
      mockPrisma.emissionFactor.findFirst.mockResolvedValue(MOCK_RECORD);

      const result = await service.findByCountryAndSource('Kenya', 'grid_electricity', 2023);

      expect(result).not.toBeNull();
      expect(typeof result!.factorKgCo2ePerKwh).toBe('number');
      expect(result!.factorKgCo2ePerKwh).toBe(0.5);
    });
  });
});
