/**
 * Unit tests for FacilityService.search() pagination logic
 *
 * Uses mocked Prisma client to verify:
 * - Default page size 100 when not specified
 * - Accept page (min 1) and pageSize (min 1, max 500) parameters
 * - Sort by name_text ASC, id ASC for pagination consistency
 * - Return pagination metadata: totalCount, currentPage, totalPages, pageSize
 * - Return empty collection for page exceeding total pages
 * - Return all records with single-page metadata for <= 100 results without pagination params
 * - Validates pagination parameters (rejects invalid values)
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
const FACILITY_ID_3 = '770e8400-e29b-41d4-a716-446655440002';

const MOCK_FACILITY_DB_RECORD = {
  id: FACILITY_ID,
  names: { en: 'Alpha Hospital' },
  addresses: { en: '123 Main Street' },
  defaultLocale: 'en',
  nameText: 'Alpha Hospital',
  facilityType: 'hospital',
  country: 'Rwanda',
  adminRegion: 'Kigali Province',
  city: 'Kigali',
  ownership: 'public',
  operationalStatus: 'operational',
  contactInfo: null,
  beds: 100,
  verificationStatus: 'unverified',
  verificationDate: null,
  energyVerificationStatus: 'unverified',
  energyVerificationDate: null,
  createdAt: new Date('2024-01-15T10:00:00Z'),
  updatedAt: new Date('2024-01-15T10:00:00Z'),
  deletedAt: null,
  energySources: [],
};

describe('FacilityService.search - Pagination', () => {
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
      mockPrisma.facility.findUniqueOrThrow.mockResolvedValueOnce({
        ...MOCK_FACILITY_DB_RECORD,
        id,
      });
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { lat: -1.9403, lon: 29.8739 },
      ]);
    }
  }

  function setupEmptyResults() {
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(0) }]);
  }

  describe('default pagination (no params specified)', () => {
    it('should default to page=1 and pageSize=100 when no pagination params provided', async () => {
      setupSearchResults([FACILITY_ID], 50);

      const result = await service.search({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pagination.currentPage).toBe(1);
        expect(result.data.pagination.pageSize).toBe(100);
      }
    });

    it('should return all records with single-page metadata for <= 100 results without pagination params', async () => {
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

    it('should use LIMIT 100 and OFFSET 0 by default', async () => {
      setupSearchResults([FACILITY_ID], 1);

      await service.search({});

      const dataCall = mockPrisma.$queryRawUnsafe.mock.calls[1];
      expect(dataCall[0]).toContain('LIMIT 100');
      expect(dataCall[0]).toContain('OFFSET 0');
    });

    it('should compute totalPages correctly for more than 100 records', async () => {
      setupSearchResults([FACILITY_ID], 350);

      const result = await service.search({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pagination.totalCount).toBe(350);
        expect(result.data.pagination.totalPages).toBe(4); // ceil(350/100) = 4
        expect(result.data.pagination.currentPage).toBe(1);
        expect(result.data.pagination.pageSize).toBe(100);
      }
    });
  });

  describe('custom pagination params', () => {
    it('should accept page and pageSize parameters', async () => {
      setupSearchResults([FACILITY_ID_2], 50);

      const result = await service.search({}, { page: 2, pageSize: 25 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pagination.currentPage).toBe(2);
        expect(result.data.pagination.pageSize).toBe(25);
      }
    });

    it('should use correct OFFSET and LIMIT based on page and pageSize', async () => {
      setupSearchResults([FACILITY_ID], 100);

      await service.search({}, { page: 3, pageSize: 20 });

      const dataCall = mockPrisma.$queryRawUnsafe.mock.calls[1];
      // page 3, pageSize 20 => OFFSET = (3-1)*20 = 40
      expect(dataCall[0]).toContain('LIMIT 20');
      expect(dataCall[0]).toContain('OFFSET 40');
    });

    it('should compute totalPages with custom pageSize', async () => {
      setupSearchResults([FACILITY_ID], 100);

      const result = await service.search({}, { page: 1, pageSize: 30 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pagination.totalCount).toBe(100);
        expect(result.data.pagination.totalPages).toBe(4); // ceil(100/30) = 4
        expect(result.data.pagination.pageSize).toBe(30);
      }
    });

    it('should accept pageSize of 1 (minimum)', async () => {
      setupSearchResults([FACILITY_ID], 5);

      const result = await service.search({}, { page: 1, pageSize: 1 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pagination.pageSize).toBe(1);
        expect(result.data.pagination.totalPages).toBe(5);
      }
    });

    it('should accept pageSize of 500 (maximum)', async () => {
      setupSearchResults([FACILITY_ID], 1000);

      const result = await service.search({}, { page: 1, pageSize: 500 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pagination.pageSize).toBe(500);
        expect(result.data.pagination.totalPages).toBe(2); // ceil(1000/500) = 2
      }
    });

    it('should accept page number of 1 (minimum)', async () => {
      setupSearchResults([FACILITY_ID], 10);

      const result = await service.search({}, { page: 1, pageSize: 10 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pagination.currentPage).toBe(1);
      }
    });
  });

  describe('page exceeding total pages', () => {
    it('should return empty data array when page exceeds total pages', async () => {
      // 50 records with pageSize 100 => 1 total page, request page 2
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(50) }]);

      const result = await service.search({}, { page: 2, pageSize: 100 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.data).toEqual([]);
        expect(result.data.pagination.totalCount).toBe(50);
        expect(result.data.pagination.currentPage).toBe(2);
        expect(result.data.pagination.totalPages).toBe(1);
        expect(result.data.pagination.pageSize).toBe(100);
      }
    });

    it('should return empty data when requesting page far beyond total pages', async () => {
      // 10 records, pageSize=10 => 1 page, request page 999
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(10) }]);

      const result = await service.search({}, { page: 999, pageSize: 10 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.data).toEqual([]);
        expect(result.data.pagination.totalCount).toBe(10);
        expect(result.data.pagination.currentPage).toBe(999);
        expect(result.data.pagination.totalPages).toBe(1);
      }
    });

    it('should not execute data query when page exceeds total pages', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(5) }]);

      await service.search({}, { page: 2, pageSize: 100 });

      // Only the count query should have been called (1 call to $queryRawUnsafe)
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    });
  });

  describe('pagination validation', () => {
    it('should reject page less than 1', async () => {
      const result = await service.search({}, { page: 0, pageSize: 100 });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details).toBeDefined();
        const messages = result.error.details!.map((d) => d.message);
        expect(messages.some((m) => m.includes('1'))).toBe(true);
      }
    });

    it('should reject negative page number', async () => {
      const result = await service.search({}, { page: -1, pageSize: 100 });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should reject pageSize less than 1', async () => {
      const result = await service.search({}, { page: 1, pageSize: 0 });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details).toBeDefined();
      }
    });

    it('should reject pageSize greater than 500', async () => {
      const result = await service.search({}, { page: 1, pageSize: 501 });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details).toBeDefined();
        const messages = result.error.details!.map((d) => d.message);
        expect(messages.some((m) => m.includes('500'))).toBe(true);
      }
    });

    it('should reject non-integer page number', async () => {
      const result = await service.search({}, { page: 1.5, pageSize: 100 });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should reject non-integer pageSize', async () => {
      const result = await service.search({}, { page: 1, pageSize: 50.5 });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should validate filter errors before pagination (filters checked first)', async () => {
      const result = await service.search(
        { country: 'Atlantis' },
        { page: 0, pageSize: 0 },
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        // Filter validation errors (country) should be returned first
        expect(result.error.details).toBeDefined();
        const fields = result.error.details!.map((d) => d.field);
        expect(fields.some((f) => f.includes('country'))).toBe(true);
      }
    });
  });

  describe('ordering for pagination consistency', () => {
    it('should order by name_text ASC and id ASC for pagination tiebreaking', async () => {
      setupSearchResults([FACILITY_ID], 1);

      await service.search({});

      const dataCall = mockPrisma.$queryRawUnsafe.mock.calls[1];
      expect(dataCall[0]).toContain('ORDER BY f.name_text ASC, f.id ASC');
    });

    it('should maintain consistent ordering across pages with id tiebreaker', async () => {
      setupSearchResults([FACILITY_ID], 200);

      await service.search({}, { page: 2, pageSize: 50 });

      const dataCall = mockPrisma.$queryRawUnsafe.mock.calls[1];
      expect(dataCall[0]).toContain('ORDER BY f.name_text ASC, f.id ASC');
      expect(dataCall[0]).toContain('LIMIT 50');
      expect(dataCall[0]).toContain('OFFSET 50');
    });
  });

  describe('pagination metadata accuracy', () => {
    it('should return correct metadata for exactly one page of results', async () => {
      setupSearchResults([FACILITY_ID], 100);

      const result = await service.search({}, { page: 1, pageSize: 100 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pagination.totalCount).toBe(100);
        expect(result.data.pagination.currentPage).toBe(1);
        expect(result.data.pagination.totalPages).toBe(1);
        expect(result.data.pagination.pageSize).toBe(100);
      }
    });

    it('should return correct metadata for zero results', async () => {
      setupEmptyResults();

      const result = await service.search({}, { page: 1, pageSize: 50 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.data).toEqual([]);
        expect(result.data.pagination.totalCount).toBe(0);
        expect(result.data.pagination.currentPage).toBe(1);
        expect(result.data.pagination.totalPages).toBe(0);
        expect(result.data.pagination.pageSize).toBe(50);
      }
    });

    it('should return totalPages = ceil(totalCount / pageSize)', async () => {
      setupSearchResults([FACILITY_ID], 101);

      const result = await service.search({}, { page: 1, pageSize: 50 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pagination.totalCount).toBe(101);
        expect(result.data.pagination.totalPages).toBe(3); // ceil(101/50) = 3
      }
    });

    it('should preserve requested page number in metadata even for zero results', async () => {
      setupEmptyResults();

      const result = await service.search({}, { page: 5, pageSize: 10 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pagination.currentPage).toBe(5);
      }
    });
  });

  describe('pagination combined with filters', () => {
    it('should paginate filtered results correctly', async () => {
      setupSearchResults([FACILITY_ID], 75);

      const result = await service.search(
        { country: 'Rwanda' },
        { page: 2, pageSize: 25 },
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pagination.totalCount).toBe(75);
        expect(result.data.pagination.currentPage).toBe(2);
        expect(result.data.pagination.totalPages).toBe(3); // ceil(75/25) = 3
        expect(result.data.pagination.pageSize).toBe(25);
      }

      // Verify correct OFFSET/LIMIT in data query
      const dataCall = mockPrisma.$queryRawUnsafe.mock.calls[1];
      expect(dataCall[0]).toContain('LIMIT 25');
      expect(dataCall[0]).toContain('OFFSET 25'); // (2-1)*25
    });
  });
});
