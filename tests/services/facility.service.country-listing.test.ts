/**
 * Unit tests for country-based facility listing (GET /api/v1/facilities?country=X)
 *
 * Validates Requirements 2.3 and 2.5:
 * - 2.3: Return all facilities for a given country ordered by name ascending,
 *         or an empty collection with count of zero if no records match
 * - 2.5: Reject requests for a country value that is not a recognized African nation
 *         with a validation error indicating the country is invalid
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FacilityService } from '../../src/services/facility.service';
import { PrismaClient } from '@prisma/client';

// Mock PrismaClient
function createMockPrisma() {
  return {
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    $executeRaw: vi.fn(),
    facility: {
      findUniqueOrThrow: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    energySource: {
      create: vi.fn(),
    },
    auditEntry: {
      create: vi.fn(),
    },
  } as unknown as PrismaClient & {
    $queryRaw: ReturnType<typeof vi.fn>;
    $queryRawUnsafe: ReturnType<typeof vi.fn>;
    $executeRaw: ReturnType<typeof vi.fn>;
    facility: {
      findUniqueOrThrow: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    energySource: {
      create: ReturnType<typeof vi.fn>;
    };
    auditEntry: {
      create: ReturnType<typeof vi.fn>;
    };
  };
}

// Test facility records for Kenya
const KENYA_FACILITY_1 = {
  id: '110e8400-e29b-41d4-a716-446655440001',
  names: { en: 'Aga Khan Hospital' },
  addresses: { en: '3rd Parklands Ave, Nairobi' },
  defaultLocale: 'en',
  nameText: 'Aga Khan Hospital',
  facilityType: 'hospital',
  country: 'Kenya',
  adminRegion: 'Nairobi County',
  city: 'Nairobi',
  ownership: 'private',
  operationalStatus: 'operational',
  contactInfo: { phone: '+254700000001' },
  beds: 300,
  verificationStatus: 'unverified',
  verificationDate: null,
  energyVerificationStatus: 'unverified',
  energyVerificationDate: null,
  createdAt: new Date('2024-01-10T10:00:00Z'),
  updatedAt: new Date('2024-01-10T10:00:00Z'),
  deletedAt: null,
  energySources: [],
};

const KENYA_FACILITY_2 = {
  id: '220e8400-e29b-41d4-a716-446655440002',
  names: { en: 'Kenyatta National Hospital' },
  addresses: { en: 'Hospital Rd, Nairobi' },
  defaultLocale: 'en',
  nameText: 'Kenyatta National Hospital',
  facilityType: 'hospital',
  country: 'Kenya',
  adminRegion: 'Nairobi County',
  city: 'Nairobi',
  ownership: 'public',
  operationalStatus: 'operational',
  contactInfo: { phone: '+254700000002' },
  beds: 1800,
  verificationStatus: 'field_verified',
  verificationDate: new Date('2024-06-01T10:00:00Z'),
  energyVerificationStatus: 'unverified',
  energyVerificationDate: null,
  createdAt: new Date('2024-01-12T10:00:00Z'),
  updatedAt: new Date('2024-01-12T10:00:00Z'),
  deletedAt: null,
  energySources: [],
};

const KENYA_FACILITY_3 = {
  id: '330e8400-e29b-41d4-a716-446655440003',
  names: { en: 'Mombasa Health Center' },
  addresses: { en: 'Nyali Rd, Mombasa' },
  defaultLocale: 'en',
  nameText: 'Mombasa Health Center',
  facilityType: 'clinic',
  country: 'Kenya',
  adminRegion: 'Mombasa County',
  city: 'Mombasa',
  ownership: 'public',
  operationalStatus: 'operational',
  contactInfo: null,
  beds: 50,
  verificationStatus: 'unverified',
  verificationDate: null,
  energyVerificationStatus: 'unverified',
  energyVerificationDate: null,
  createdAt: new Date('2024-02-01T10:00:00Z'),
  updatedAt: new Date('2024-02-01T10:00:00Z'),
  deletedAt: null,
  energySources: [],
};

describe('FacilityService - Country-based listing (Requirement 2.3, 2.5)', () => {
  let service: FacilityService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new FacilityService(mockPrisma as unknown as PrismaClient);
  });

  /**
   * Helper to set up mock results for a search that returns facilities.
   * Facilities are returned in name_text ASC order (as the real SQL would).
   */
  function setupCountryResults(facilities: typeof KENYA_FACILITY_1[]) {
    const ids = facilities.map((f) => f.id);
    // Count query
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(facilities.length) }]);
    // Data query (IDs ordered by name_text ASC)
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce(ids.map((id) => ({ id })));
    // For each facility retrieved via getFacilityById
    for (const facility of facilities) {
      mockPrisma.facility.findUniqueOrThrow.mockResolvedValueOnce(facility);
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { lat: -1.2921, lon: 36.8219 },
      ]);
    }
  }

  function setupEmptyResults() {
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(0) }]);
  }

  describe('Valid African country returns matching facilities ordered by name ASC', () => {
    it('should return all facilities for Kenya ordered by name ascending', async () => {
      // Facilities pre-ordered by name_text: Aga Khan, Kenyatta, Mombasa
      setupCountryResults([KENYA_FACILITY_1, KENYA_FACILITY_2, KENYA_FACILITY_3]);

      const result = await service.search({ country: 'Kenya' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.data).toHaveLength(3);
        // Verify alphabetical ordering by name
        const names = result.data.data.map((f) => f.nameText);
        expect(names).toEqual([
          'Aga Khan Hospital',
          'Kenyatta National Hospital',
          'Mombasa Health Center',
        ]);
      }
    });

    it('should pass the country filter to the SQL query', async () => {
      setupCountryResults([KENYA_FACILITY_1]);

      await service.search({ country: 'Kenya' });

      // Verify SQL includes country filter
      const countCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
      expect(countCall[0]).toContain('f.country = $1');
      expect(countCall[1]).toBe('Kenya');
    });

    it('should include ORDER BY name_text ASC in the data query', async () => {
      setupCountryResults([KENYA_FACILITY_1]);

      await service.search({ country: 'Kenya' });

      // The data query (second call) should include ORDER BY
      const dataCall = mockPrisma.$queryRawUnsafe.mock.calls[1];
      expect(dataCall[0]).toContain('ORDER BY f.name_text ASC');
    });

    it('should exclude soft-deleted records', async () => {
      setupCountryResults([KENYA_FACILITY_1]);

      await service.search({ country: 'Kenya' });

      // Verify SQL includes soft-delete exclusion
      const countCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
      expect(countCall[0]).toContain('f.deleted_at IS NULL');
    });

    it('should accept various valid African countries', async () => {
      const validCountries = ['Rwanda', 'Nigeria', 'South Africa', 'Egypt', 'Ghana', 'Tanzania'];

      for (const country of validCountries) {
        const localMockPrisma = createMockPrisma();
        const localService = new FacilityService(localMockPrisma as unknown as PrismaClient);
        localMockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(0) }]);

        const result = await localService.search({ country });
        expect(result.success).toBe(true);
      }
    });

    it('should return pagination metadata with results', async () => {
      setupCountryResults([KENYA_FACILITY_1, KENYA_FACILITY_2]);

      const result = await service.search({ country: 'Kenya' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pagination).toEqual({
          totalCount: 2,
          currentPage: 1,
          totalPages: 1,
          pageSize: 100,
        });
      }
    });
  });

  describe('Invalid country (non-African) returns validation error', () => {
    it('should reject a non-African country with VALIDATION_ERROR', async () => {
      const result = await service.search({ country: 'France' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toBe('Validation failed');
        expect(result.error.details).toBeDefined();
        expect(result.error.details!.length).toBeGreaterThan(0);
      }
    });

    it('should include field name in validation error details', async () => {
      const result = await service.search({ country: 'Germany' });

      expect(result.success).toBe(false);
      if (!result.success) {
        const countryError = result.error.details!.find((d) => d.field === 'country');
        expect(countryError).toBeDefined();
        expect(countryError!.message).toContain('recognized African nation');
      }
    });

    it('should reject fictional/nonsense country names', async () => {
      const invalidCountries = ['Atlantis', 'Wakanda', 'Narnia', 'xyz123'];

      for (const country of invalidCountries) {
        const result = await service.search({ country });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('VALIDATION_ERROR');
        }
      }
    });

    it('should reject non-African real countries', async () => {
      const nonAfricanCountries = ['United States', 'China', 'Brazil', 'Australia', 'India'];

      for (const country of nonAfricanCountries) {
        const result = await service.search({ country });

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('VALIDATION_ERROR');
        }
      }
    });

    it('should not execute any database queries when country is invalid', async () => {
      await service.search({ country: 'InvalidCountry' });

      // No DB calls should have been made
      expect(mockPrisma.$queryRawUnsafe).not.toHaveBeenCalled();
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('Valid country with no facilities returns empty collection with count 0', () => {
    it('should return empty data array when no facilities exist for the country', async () => {
      setupEmptyResults();

      const result = await service.search({ country: 'Comoros' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.data).toEqual([]);
      }
    });

    it('should return totalCount of 0 when no facilities match', async () => {
      setupEmptyResults();

      const result = await service.search({ country: 'Seychelles' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pagination.totalCount).toBe(0);
      }
    });

    it('should return complete pagination metadata for empty results', async () => {
      setupEmptyResults();

      const result = await service.search({ country: 'Djibouti' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pagination).toEqual({
          totalCount: 0,
          currentPage: 1,
          totalPages: 0,
          pageSize: 100,
        });
      }
    });

    it('should still execute the count query for valid country with no results', async () => {
      setupEmptyResults();

      await service.search({ country: 'Lesotho' });

      // Count query should have been called
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
      const countCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
      expect(countCall[0]).toContain('f.country = $1');
      expect(countCall[1]).toBe('Lesotho');
    });
  });
});
