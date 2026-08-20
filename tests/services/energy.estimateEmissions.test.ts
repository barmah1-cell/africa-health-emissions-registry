/**
 * Unit tests for EnergyEmissionsService.estimateEmissions
 *
 * Uses mocked Prisma client to verify:
 * - UUID format validation (INVALID_FORMAT error for bad IDs)
 * - Facility existence check (NOT_FOUND error for missing/deleted facilities)
 * - Consumption data lookup (ESTIMATION_UNAVAILABLE when no data)
 * - Emission factor lookup (ESTIMATION_UNAVAILABLE when no matching factor)
 * - Correct emission calculation: (consumption_kwh × factor_kg_co2e_per_kwh) / 1000
 * - Temporal lookup: most recent reference_year that does not exceed reporting year
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EnergyEmissionsService } from '../../src/services/energy.service';
import { PrismaClient } from '@prisma/client';

function createMockPrisma() {
  return {
    facility: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    energySource: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    emissionFactor: {
      findFirst: vi.fn(),
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
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    emissionFactor: {
      findFirst: ReturnType<typeof vi.fn>;
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

describe('EnergyEmissionsService.estimateEmissions', () => {
  let service: EnergyEmissionsService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new EnergyEmissionsService(mockPrisma as unknown as PrismaClient);
  });

  describe('UUID validation', () => {
    it('should return INVALID_FORMAT for non-UUID facility ID', async () => {
      const result = await service.estimateEmissions('not-a-uuid', 'solar', 2023);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_FORMAT');
        expect(result.error.message).toContain('Invalid facility ID');
      }
    });

    it('should return INVALID_FORMAT for empty string', async () => {
      const result = await service.estimateEmissions('', 'solar', 2023);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_FORMAT');
      }
    });

    it('should return INVALID_FORMAT for numeric string', async () => {
      const result = await service.estimateEmissions('12345', 'grid_electricity', 2023);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_FORMAT');
      }
    });
  });

  describe('facility existence check', () => {
    it('should return NOT_FOUND when facility does not exist', async () => {
      mockPrisma.facility.findFirst.mockResolvedValue(null);

      const result = await service.estimateEmissions(VALID_FACILITY_ID, 'solar', 2023);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toContain(VALID_FACILITY_ID);
      }
    });

    it('should query for non-deleted facility with country field', async () => {
      mockPrisma.facility.findFirst.mockResolvedValue(null);

      await service.estimateEmissions(VALID_FACILITY_ID, 'solar', 2023);

      expect(mockPrisma.facility.findFirst).toHaveBeenCalledWith({
        where: {
          id: VALID_FACILITY_ID,
          deletedAt: null,
        },
        select: { id: true, country: true },
      });
    });
  });

  describe('consumption data lookup', () => {
    beforeEach(() => {
      mockPrisma.facility.findFirst.mockResolvedValue({
        id: VALID_FACILITY_ID,
        country: 'Kenya',
      });
    });

    it('should return ESTIMATION_UNAVAILABLE when no energy source with consumption data exists', async () => {
      mockPrisma.energySource.findFirst.mockResolvedValue(null);

      const result = await service.estimateEmissions(VALID_FACILITY_ID, 'solar', 2023);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('ESTIMATION_UNAVAILABLE');
        expect(result.error.message).toContain('solar');
        expect(result.error.message).toContain(VALID_FACILITY_ID);
      }
    });

    it('should query energy source by facilityId, energyType, and non-null consumption', async () => {
      mockPrisma.energySource.findFirst.mockResolvedValue(null);

      await service.estimateEmissions(VALID_FACILITY_ID, 'grid_electricity', 2023);

      expect(mockPrisma.energySource.findFirst).toHaveBeenCalledWith({
        where: {
          facilityId: VALID_FACILITY_ID,
          energyType: 'grid_electricity',
          consumptionKwhYear: { not: null },
        },
      });
    });
  });

  describe('emission factor lookup', () => {
    beforeEach(() => {
      mockPrisma.facility.findFirst.mockResolvedValue({
        id: VALID_FACILITY_ID,
        country: 'Kenya',
      });
      mockPrisma.energySource.findFirst.mockResolvedValue({
        id: 'es-1',
        facilityId: VALID_FACILITY_ID,
        energyType: 'grid_electricity',
        consumptionKwhYear: { toNumber: () => 50000 },
      });
    });

    it('should return ESTIMATION_UNAVAILABLE when no emission factor exists for country and source type', async () => {
      mockPrisma.emissionFactor.findFirst.mockResolvedValue(null);

      const result = await service.estimateEmissions(VALID_FACILITY_ID, 'grid_electricity', 2023);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('ESTIMATION_UNAVAILABLE');
        expect(result.error.message).toContain('Kenya');
        expect(result.error.message).toContain('grid_electricity');
      }
    });

    it('should query emission factor by country, energySourceType, and referenceYear <= reporting year', async () => {
      mockPrisma.emissionFactor.findFirst.mockResolvedValue(null);

      await service.estimateEmissions(VALID_FACILITY_ID, 'grid_electricity', 2023);

      expect(mockPrisma.emissionFactor.findFirst).toHaveBeenCalledWith({
        where: {
          country: 'Kenya',
          energySourceType: 'grid_electricity',
          referenceYear: { lte: 2023 },
        },
        orderBy: { referenceYear: 'desc' },
      });
    });

    it('should use the most recent reference year not exceeding reporting year', async () => {
      mockPrisma.emissionFactor.findFirst.mockResolvedValue({
        id: 'ef-1',
        country: 'Kenya',
        energySourceType: 'grid_electricity',
        factorKgCo2ePerKwh: { toNumber: () => 0.5 },
        referenceYear: 2022,
      });

      const result = await service.estimateEmissions(VALID_FACILITY_ID, 'grid_electricity', 2023);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.referenceYear).toBe(2022);
      }
    });
  });

  describe('emission calculation', () => {
    beforeEach(() => {
      mockPrisma.facility.findFirst.mockResolvedValue({
        id: VALID_FACILITY_ID,
        country: 'Nigeria',
      });
    });

    it('should correctly calculate: (consumptionKwh * factorKgCo2ePerKwh) / 1000', async () => {
      // 50000 kWh * 0.5 kg CO2e/kWh = 25000 kg CO2e = 25 tonnes CO2e
      mockPrisma.energySource.findFirst.mockResolvedValue({
        id: 'es-1',
        facilityId: VALID_FACILITY_ID,
        energyType: 'grid_electricity',
        consumptionKwhYear: 50000,
      });
      mockPrisma.emissionFactor.findFirst.mockResolvedValue({
        id: 'ef-1',
        country: 'Nigeria',
        energySourceType: 'grid_electricity',
        factorKgCo2ePerKwh: 0.5,
        referenceYear: 2022,
      });

      const result = await service.estimateEmissions(VALID_FACILITY_ID, 'grid_electricity', 2023);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.estimatedTonnesCo2e).toBe(25);
        expect(result.data.consumptionKwh).toBe(50000);
        expect(result.data.emissionFactorKgCo2ePerKwh).toBe(0.5);
      }
    });

    it('should handle Decimal objects from Prisma (consumptionKwhYear)', async () => {
      // Prisma Decimal objects support Number() conversion via valueOf/toString
      const decimalConsumption = Object.assign(Object.create(null), {
        toNumber: () => 12000.5,
        valueOf: () => 12000.5,
        toString: () => '12000.5',
        [Symbol.toPrimitive]: () => 12000.5,
      });
      const decimalFactor = Object.assign(Object.create(null), {
        toNumber: () => 0.05,
        valueOf: () => 0.05,
        toString: () => '0.05',
        [Symbol.toPrimitive]: () => 0.05,
      });

      mockPrisma.energySource.findFirst.mockResolvedValue({
        id: 'es-1',
        facilityId: VALID_FACILITY_ID,
        energyType: 'solar',
        consumptionKwhYear: decimalConsumption,
      });
      mockPrisma.emissionFactor.findFirst.mockResolvedValue({
        id: 'ef-1',
        country: 'Nigeria',
        energySourceType: 'solar',
        factorKgCo2ePerKwh: decimalFactor,
        referenceYear: 2021,
      });

      const result = await service.estimateEmissions(VALID_FACILITY_ID, 'solar', 2023);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.consumptionKwh).toBe(12000.5);
        expect(result.data.emissionFactorKgCo2ePerKwh).toBe(0.05);
        // (12000.5 * 0.05) / 1000 = 0.600025
        expect(result.data.estimatedTonnesCo2e).toBeCloseTo(0.600025, 6);
      }
    });

    it('should return correct calculation for diesel_generator', async () => {
      // 100000 kWh * 0.8 kg CO2e/kWh = 80000 kg CO2e = 80 tonnes CO2e
      mockPrisma.energySource.findFirst.mockResolvedValue({
        id: 'es-1',
        facilityId: VALID_FACILITY_ID,
        energyType: 'diesel_generator',
        consumptionKwhYear: 100000,
      });
      mockPrisma.emissionFactor.findFirst.mockResolvedValue({
        id: 'ef-1',
        country: 'Nigeria',
        energySourceType: 'diesel_generator',
        factorKgCo2ePerKwh: 0.8,
        referenceYear: 2023,
      });

      const result = await service.estimateEmissions(VALID_FACILITY_ID, 'diesel_generator', 2023);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.estimatedTonnesCo2e).toBe(80);
      }
    });

    it('should return very small estimates for low consumption and low factor', async () => {
      // 100 kWh * 0.01 kg CO2e/kWh = 1 kg CO2e = 0.001 tonnes CO2e
      mockPrisma.energySource.findFirst.mockResolvedValue({
        id: 'es-1',
        facilityId: VALID_FACILITY_ID,
        energyType: 'wind',
        consumptionKwhYear: 100,
      });
      mockPrisma.emissionFactor.findFirst.mockResolvedValue({
        id: 'ef-1',
        country: 'Nigeria',
        energySourceType: 'wind',
        factorKgCo2ePerKwh: 0.01,
        referenceYear: 2020,
      });

      const result = await service.estimateEmissions(VALID_FACILITY_ID, 'wind', 2023);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.estimatedTonnesCo2e).toBe(0.001);
      }
    });
  });

  describe('response format', () => {
    it('should return complete EmissionEstimate object with all fields', async () => {
      mockPrisma.facility.findFirst.mockResolvedValue({
        id: VALID_FACILITY_ID,
        country: 'South Africa',
      });
      mockPrisma.energySource.findFirst.mockResolvedValue({
        id: 'es-1',
        facilityId: VALID_FACILITY_ID,
        energyType: 'grid_electricity',
        consumptionKwhYear: 75000,
      });
      mockPrisma.emissionFactor.findFirst.mockResolvedValue({
        id: 'ef-1',
        country: 'South Africa',
        energySourceType: 'grid_electricity',
        factorKgCo2ePerKwh: 0.95,
        referenceYear: 2022,
      });

      const result = await service.estimateEmissions(VALID_FACILITY_ID, 'grid_electricity', 2023);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          facilityId: VALID_FACILITY_ID,
          energySourceType: 'grid_electricity',
          consumptionKwh: 75000,
          emissionFactorKgCo2ePerKwh: 0.95,
          referenceYear: 2022,
          estimatedTonnesCo2e: (75000 * 0.95) / 1000,
        });
      }
    });

    it('should use the facility country from the database for the emission factor lookup', async () => {
      mockPrisma.facility.findFirst.mockResolvedValue({
        id: VALID_FACILITY_ID,
        country: 'Ghana',
      });
      mockPrisma.energySource.findFirst.mockResolvedValue({
        id: 'es-1',
        facilityId: VALID_FACILITY_ID,
        energyType: 'solar',
        consumptionKwhYear: 20000,
      });
      mockPrisma.emissionFactor.findFirst.mockResolvedValue(null);

      await service.estimateEmissions(VALID_FACILITY_ID, 'solar', 2023);

      expect(mockPrisma.emissionFactor.findFirst).toHaveBeenCalledWith({
        where: {
          country: 'Ghana',
          energySourceType: 'solar',
          referenceYear: { lte: 2023 },
        },
        orderBy: { referenceYear: 'desc' },
      });
    });
  });
});
