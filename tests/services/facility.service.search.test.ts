/**
 * Unit tests for FacilityService.search()
 *
 * Uses mocked Prisma client to verify:
 * - Valid filters return matching facilities
 * - Multiple filters apply AND logic
 * - Keyword search performs case-insensitive partial match across all locales
 * - Whitespace-only keywords are rejected with validation error
 * - Invalid filter values are rejected
 * - Results are ordered by name_text ascending
 * - Soft-deleted records are excluded
 * - Empty results return count of zero
 * - Energy source filter uses EXISTS subquery
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

const FACILITY_ID = '550e8400-e29b-41d4-a716-446655440000';
const FACILITY_ID_2 = '660e8400-e29b-41d4-a716-446655440001';

const MOCK_FACILITY_DB_RECORD = {
  id: FACILITY_ID,
  names: { en: 'Kigali General Hospital', fr: 'Hôpital Général de Kigali' },
  addresses: { en: '123 Main Street, Kigali', fr: '123 Rue Principale, Kigali' },
  defaultLocale: 'en',
  nameText: 'Kigali General Hospital',
  facilityType: 'hospital',
  country: 'Rwanda',
  adminRegion: 'Kigali Province',
  city: 'Kigali',
  ownership: 'public',
  operationalStatus: 'operational',
  contactInfo: { phone: '+250788000000' },
  beds: 500,
  verificationStatus: 'unverified',
  verificationDate: null,
  energyVerificationStatus: 'unverified',
  energyVerificationDate: null,
  createdAt: new Date('2024-01-15T10:00:00Z'),
  updatedAt: new Date('2024-01-15T10:00:00Z'),
  deletedAt: null,
  energySources: [],
};

const MOCK_FACILITY_DB_RECORD_2 = {
  ...MOCK_FACILITY_DB_RECORD,
  id: FACILITY_ID_2,
  names: { en: 'Nairobi Clinic' },
  addresses: { en: '456 Park Ave, Nairobi' },
  nameText: 'Nairobi Clinic',
  facilityType: 'clinic',
  country: 'Kenya',
  adminRegion: 'Nairobi County',
  city: 'Nairobi',
  operationalStatus: 'temporarily_closed',
};

describe('FacilityService.search', () => {
  let service: FacilityService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new FacilityService(mockPrisma as unknown as PrismaClient);
  });

  function setupSearchResults(ids: string[], totalCount: number = ids.length) {
    // Count query result
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(totalCount) }]);
    // Data query result (just IDs)
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce(ids.map((id) => ({ id })));
    // For each facility retrieved via getFacilityById
    for (const id of ids) {
      const record = id === FACILITY_ID ? MOCK_FACILITY_DB_RECORD : MOCK_FACILITY_DB_RECORD_2;
      mockPrisma.facility.findUniqueOrThrow.mockResolvedValueOnce(record);
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { lat: -1.9403, lon: 29.8739 },
      ]);
    }
  }

  function setupEmptyResults() {
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(0) }]);
  }

  describe('validation', () => {
    it('should reject whitespace-only keyword with validation error', async () => {
      const result = await service.search({ keyword: '   ' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details).toBeDefined();
        const messages = result.error.details!.map((d) => d.message);
        expect(messages.some((m) => m.includes('whitespace'))).toBe(true);
      }
    });

    it('should reject empty string keyword with validation error', async () => {
      const result = await service.search({ keyword: '' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should reject invalid country filter value', async () => {
      const result = await service.search({ country: 'Atlantis' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details).toBeDefined();
      }
    });

    it('should reject invalid facilityType filter value', async () => {
      const result = await service.search({ facilityType: 'spaceship' as any });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should reject invalid operationalStatus filter value', async () => {
      const result = await service.search({ operationalStatus: 'exploded' as any });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should reject invalid energySource filter value', async () => {
      const result = await service.search({ energySource: 'nuclear' as any });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should reject invalid verificationStatus filter value', async () => {
      const result = await service.search({ verificationStatus: 'magic' as any });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should accept valid filters without error', async () => {
      setupEmptyResults();

      const result = await service.search({
        country: 'Rwanda',
        facilityType: 'hospital',
        operationalStatus: 'operational',
      });

      expect(result.success).toBe(true);
    });

    it('should accept empty filters (returns all non-deleted facilities)', async () => {
      setupEmptyResults();

      const result = await service.search({});

      expect(result.success).toBe(true);
    });
  });

  describe('filtering', () => {
    it('should filter by country', async () => {
      setupSearchResults([FACILITY_ID]);

      const result = await service.search({ country: 'Rwanda' });

      expect(result.success).toBe(true);
      // Verify the country param was passed to the query
      const countCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
      expect(countCall[0]).toContain('f.country = $1');
      expect(countCall[1]).toBe('Rwanda');
    });

    it('should filter by facilityType', async () => {
      setupSearchResults([FACILITY_ID]);

      const result = await service.search({ facilityType: 'hospital' });

      expect(result.success).toBe(true);
      const countCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
      expect(countCall[0]).toContain('f.facility_type = $1');
      expect(countCall[1]).toBe('hospital');
    });

    it('should filter by operationalStatus', async () => {
      setupSearchResults([FACILITY_ID]);

      const result = await service.search({ operationalStatus: 'operational' });

      expect(result.success).toBe(true);
      const countCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
      expect(countCall[0]).toContain('f.operational_status = $1');
      expect(countCall[1]).toBe('operational');
    });

    it('should filter by verificationStatus', async () => {
      setupSearchResults([FACILITY_ID]);

      const result = await service.search({ verificationStatus: 'field_verified' });

      expect(result.success).toBe(true);
      const countCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
      expect(countCall[0]).toContain('f.verification_status = $1');
      expect(countCall[1]).toBe('field_verified');
    });

    it('should filter by energySource using EXISTS subquery', async () => {
      setupSearchResults([FACILITY_ID]);

      const result = await service.search({ energySource: 'solar' });

      expect(result.success).toBe(true);
      const countCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
      expect(countCall[0]).toContain('EXISTS');
      expect(countCall[0]).toContain('energy_source');
      expect(countCall[0]).toContain('energy_type');
      expect(countCall[1]).toBe('solar');
    });

    it('should apply AND logic for multiple filters', async () => {
      setupSearchResults([FACILITY_ID]);

      const result = await service.search({
        country: 'Rwanda',
        facilityType: 'hospital',
        operationalStatus: 'operational',
      });

      expect(result.success).toBe(true);
      const countCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
      // All conditions joined with AND
      expect(countCall[0]).toContain('f.country = $1');
      expect(countCall[0]).toContain('f.facility_type = $2');
      expect(countCall[0]).toContain('f.operational_status = $3');
      expect(countCall[1]).toBe('Rwanda');
      expect(countCall[2]).toBe('hospital');
      expect(countCall[3]).toBe('operational');
    });
  });

  describe('keyword search', () => {
    it('should perform case-insensitive partial match on names and addresses JSONB', async () => {
      setupSearchResults([FACILITY_ID]);

      const result = await service.search({ keyword: 'kigali' });

      expect(result.success).toBe(true);
      const countCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
      expect(countCall[0]).toContain('jsonb_each_text(f.names)');
      expect(countCall[0]).toContain('jsonb_each_text(f.addresses)');
      expect(countCall[0]).toContain('LOWER(kv.value) LIKE');
      expect(countCall[1]).toBe('%kigali%');
    });

    it('should accept keyword with valid length', async () => {
      setupSearchResults([FACILITY_ID]);

      const result = await service.search({ keyword: 'hospital' });

      expect(result.success).toBe(true);
    });

    it('should combine keyword with other filters (AND logic)', async () => {
      setupSearchResults([FACILITY_ID]);

      const result = await service.search({
        country: 'Rwanda',
        keyword: 'general',
      });

      expect(result.success).toBe(true);
      const countCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
      expect(countCall[0]).toContain('f.country = $1');
      expect(countCall[0]).toContain('LIKE $2');
      expect(countCall[1]).toBe('Rwanda');
      expect(countCall[2]).toBe('%general%');
    });
  });

  describe('result formatting', () => {
    it('should return empty collection with count of zero for no matches', async () => {
      setupEmptyResults();

      const result = await service.search({ country: 'Rwanda' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.data).toEqual([]);
        expect(result.data.pagination.totalCount).toBe(0);
        expect(result.data.pagination.currentPage).toBe(1);
        expect(result.data.pagination.totalPages).toBe(0);
        expect(result.data.pagination.pageSize).toBe(100);
      }
    });

    it('should return facilities with pagination metadata', async () => {
      setupSearchResults([FACILITY_ID, FACILITY_ID_2], 2);

      const result = await service.search({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.data).toHaveLength(2);
        expect(result.data.pagination.totalCount).toBe(2);
        expect(result.data.pagination.currentPage).toBe(1);
        expect(result.data.pagination.totalPages).toBe(1);
        expect(result.data.pagination.pageSize).toBe(100);
      }
    });

    it('should calculate totalPages based on totalCount and pageSize', async () => {
      // Simulate 250 total records
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(250) }]);
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ id: FACILITY_ID }]);
      mockPrisma.facility.findUniqueOrThrow.mockResolvedValueOnce(MOCK_FACILITY_DB_RECORD);
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { lat: -1.9403, lon: 29.8739 },
      ]);

      const result = await service.search({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pagination.totalCount).toBe(250);
        expect(result.data.pagination.totalPages).toBe(3); // ceil(250/100)
      }
    });
  });

  describe('soft-delete exclusion', () => {
    it('should always include deleted_at IS NULL in WHERE clause', async () => {
      setupEmptyResults();

      await service.search({});

      const countCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
      expect(countCall[0]).toContain('f.deleted_at IS NULL');
    });

    it('should include deleted_at IS NULL even with other filters', async () => {
      setupEmptyResults();

      await service.search({ country: 'Rwanda', facilityType: 'hospital' });

      const countCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
      expect(countCall[0]).toContain('f.deleted_at IS NULL');
    });
  });

  describe('ordering', () => {
    it('should order results by name_text ASC', async () => {
      setupSearchResults([FACILITY_ID]);

      await service.search({});

      // The data query (second call) should have ORDER BY
      const dataCall = mockPrisma.$queryRawUnsafe.mock.calls[1];
      expect(dataCall[0]).toContain('ORDER BY f.name_text ASC');
    });
  });
});
