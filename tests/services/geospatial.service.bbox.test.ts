/**
 * Unit tests for GeospatialService.findInBoundingBox()
 *
 * Uses mocked Prisma client to verify:
 * - Valid bounding box returns matching facilities
 * - Invalid coordinates return validation error
 * - Empty result for no matches
 * - Pagination works correctly
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeospatialService } from '../../src/services/geospatial.service';
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
    },
    energySource: {
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
    };
    energySource: {
      create: ReturnType<typeof vi.fn>;
    };
  };
}

const FACILITY_ID_1 = '550e8400-e29b-41d4-a716-446655440000';
const FACILITY_ID_2 = '660e8400-e29b-41d4-a716-446655440001';
const FACILITY_ID_3 = '770e8400-e29b-41d4-a716-446655440002';

const MOCK_FACILITY_1 = {
  id: FACILITY_ID_1,
  names: { en: 'Accra General Hospital' },
  addresses: { en: '10 Independence Ave, Accra' },
  defaultLocale: 'en',
  nameText: 'Accra General Hospital',
  facilityType: 'hospital',
  country: 'Ghana',
  adminRegion: 'Greater Accra',
  city: 'Accra',
  ownership: 'public',
  operationalStatus: 'operational',
  contactInfo: { phone: '+233200000000' },
  beds: 300,
  verificationStatus: 'unverified',
  verificationDate: null,
  energyVerificationStatus: 'unverified',
  energyVerificationDate: null,
  createdAt: new Date('2024-01-15T10:00:00Z'),
  updatedAt: new Date('2024-01-15T10:00:00Z'),
  deletedAt: null,
  energySources: [],
};

const MOCK_FACILITY_2 = {
  ...MOCK_FACILITY_1,
  id: FACILITY_ID_2,
  names: { en: 'Cape Coast Hospital' },
  nameText: 'Cape Coast Hospital',
  city: 'Cape Coast',
};

const MOCK_FACILITY_3 = {
  ...MOCK_FACILITY_1,
  id: FACILITY_ID_3,
  names: { en: 'Kumasi Clinic' },
  nameText: 'Kumasi Clinic',
  facilityType: 'clinic',
  city: 'Kumasi',
};

describe('GeospatialService.findInBoundingBox', () => {
  let service: GeospatialService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new GeospatialService(mockPrisma as unknown as PrismaClient);
  });

  function setupBboxResults(ids: string[], totalCount?: number) {
    const count = totalCount ?? ids.length;
    // Count query
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(count) }]);
    // Data query (IDs)
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce(ids.map((id) => ({ id })));
    // For each facility retrieved via getFacilityById
    for (const id of ids) {
      let record;
      if (id === FACILITY_ID_1) record = MOCK_FACILITY_1;
      else if (id === FACILITY_ID_2) record = MOCK_FACILITY_2;
      else record = MOCK_FACILITY_3;
      mockPrisma.facility.findUniqueOrThrow.mockResolvedValueOnce(record);
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { lat: 5.6037, lon: -0.1870 },
      ]);
    }
  }

  function setupEmptyResults() {
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(0) }]);
  }

  describe('valid bounding box queries', () => {
    it('should return matching facilities within the bounding box', async () => {
      setupBboxResults([FACILITY_ID_1, FACILITY_ID_2]);

      const result = await service.findInBoundingBox({
        swLatitude: 4.0,
        swLongitude: -3.0,
        neLatitude: 8.0,
        neLongitude: 1.0,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.data).toHaveLength(2);
        expect(result.data.data[0].id).toBe(FACILITY_ID_1);
        expect(result.data.data[1].id).toBe(FACILITY_ID_2);
      }
    });

    it('should pass bounding box coordinates to ST_MakeEnvelope query', async () => {
      setupBboxResults([FACILITY_ID_1]);

      await service.findInBoundingBox({
        swLatitude: -10.5,
        swLongitude: 25.0,
        neLatitude: 5.5,
        neLongitude: 40.0,
      });

      // Count query should have the coordinates in correct order: sw_lon, sw_lat, ne_lon, ne_lat
      const countCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
      expect(countCall[0]).toContain('ST_MakeEnvelope');
      expect(countCall[1]).toBe(25.0);   // swLongitude
      expect(countCall[2]).toBe(-10.5);  // swLatitude
      expect(countCall[3]).toBe(40.0);   // neLongitude
      expect(countCall[4]).toBe(5.5);    // neLatitude
    });

    it('should exclude soft-deleted records in the query', async () => {
      setupEmptyResults();

      await service.findInBoundingBox({
        swLatitude: -5.0,
        swLongitude: -5.0,
        neLatitude: 10.0,
        neLongitude: 10.0,
      });

      const countCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
      expect(countCall[0]).toContain('f.deleted_at IS NULL');
    });

    it('should order results by name_text ASC', async () => {
      setupBboxResults([FACILITY_ID_1]);

      await service.findInBoundingBox({
        swLatitude: 4.0,
        swLongitude: -3.0,
        neLatitude: 8.0,
        neLongitude: 1.0,
      });

      // The data query (second call) should have ORDER BY
      const dataCall = mockPrisma.$queryRawUnsafe.mock.calls[1];
      expect(dataCall[0]).toContain('ORDER BY f.name_text ASC');
    });
  });

  describe('invalid coordinate validation', () => {
    it('should reject SW latitude below -90', async () => {
      const result = await service.findInBoundingBox({
        swLatitude: -91,
        swLongitude: 0,
        neLatitude: 10,
        neLongitude: 10,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details).toBeDefined();
        expect(result.error.details!.some((d) => d.field.includes('swLatitude'))).toBe(true);
      }
    });

    it('should reject SW latitude above 90', async () => {
      const result = await service.findInBoundingBox({
        swLatitude: 91,
        swLongitude: 0,
        neLatitude: 10,
        neLongitude: 10,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should reject SW longitude below -180', async () => {
      const result = await service.findInBoundingBox({
        swLatitude: 0,
        swLongitude: -181,
        neLatitude: 10,
        neLongitude: 10,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details!.some((d) => d.field.includes('swLongitude'))).toBe(true);
      }
    });

    it('should reject NE latitude above 90', async () => {
      const result = await service.findInBoundingBox({
        swLatitude: 0,
        swLongitude: 0,
        neLatitude: 100,
        neLongitude: 10,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details!.some((d) => d.field.includes('neLatitude'))).toBe(true);
      }
    });

    it('should reject NE longitude above 180', async () => {
      const result = await service.findInBoundingBox({
        swLatitude: 0,
        swLongitude: 0,
        neLatitude: 10,
        neLongitude: 200,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details!.some((d) => d.field.includes('neLongitude'))).toBe(true);
      }
    });

    it('should reject missing coordinates', async () => {
      const result = await service.findInBoundingBox({
        swLatitude: 0,
        // Missing swLongitude, neLatitude, neLongitude
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details!.length).toBeGreaterThan(0);
      }
    });

    it('should report all invalid coordinates in a single response', async () => {
      const result = await service.findInBoundingBox({
        swLatitude: -100,
        swLongitude: -200,
        neLatitude: 100,
        neLongitude: 200,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        // Should report multiple validation errors at once (not fail-fast)
        expect(result.error.details!.length).toBeGreaterThanOrEqual(4);
      }
    });

    it('should reject non-numeric coordinate values', async () => {
      const result = await service.findInBoundingBox({
        swLatitude: 'abc',
        swLongitude: 0,
        neLatitude: 10,
        neLongitude: 10,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('empty results', () => {
    it('should return empty collection with count zero for no matches', async () => {
      setupEmptyResults();

      const result = await service.findInBoundingBox({
        swLatitude: -20.0,
        swLongitude: -20.0,
        neLatitude: -15.0,
        neLongitude: -15.0,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.data).toEqual([]);
        expect(result.data.pagination.totalCount).toBe(0);
        expect(result.data.pagination.currentPage).toBe(1);
        expect(result.data.pagination.totalPages).toBe(0);
        expect(result.data.pagination.pageSize).toBe(100);
      }
    });

    it('should return empty collection with correct page when using pagination', async () => {
      setupEmptyResults();

      const result = await service.findInBoundingBox(
        {
          swLatitude: -20.0,
          swLongitude: -20.0,
          neLatitude: -15.0,
          neLongitude: -15.0,
        },
        { page: 3, pageSize: 50 },
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.data).toEqual([]);
        expect(result.data.pagination.currentPage).toBe(3);
        expect(result.data.pagination.pageSize).toBe(50);
      }
    });
  });

  describe('pagination', () => {
    it('should use default pagination (page 1, size 100) when not specified', async () => {
      setupBboxResults([FACILITY_ID_1]);

      await service.findInBoundingBox({
        swLatitude: 4.0,
        swLongitude: -3.0,
        neLatitude: 8.0,
        neLongitude: 1.0,
      });

      // Data query should use LIMIT 100 OFFSET 0
      const dataCall = mockPrisma.$queryRawUnsafe.mock.calls[1];
      expect(dataCall[5]).toBe(100); // pageSize (LIMIT)
      expect(dataCall[6]).toBe(0);   // offset
    });

    it('should apply custom pagination parameters', async () => {
      setupBboxResults([FACILITY_ID_1], 50);

      await service.findInBoundingBox(
        {
          swLatitude: 4.0,
          swLongitude: -3.0,
          neLatitude: 8.0,
          neLongitude: 1.0,
        },
        { page: 2, pageSize: 25 },
      );

      // Data query should use LIMIT 25 OFFSET 25
      const dataCall = mockPrisma.$queryRawUnsafe.mock.calls[1];
      expect(dataCall[5]).toBe(25);  // pageSize (LIMIT)
      expect(dataCall[6]).toBe(25);  // offset (page 2 - 1) * 25
    });

    it('should return correct pagination metadata', async () => {
      setupBboxResults([FACILITY_ID_1, FACILITY_ID_2], 75);

      const result = await service.findInBoundingBox(
        {
          swLatitude: 4.0,
          swLongitude: -3.0,
          neLatitude: 8.0,
          neLongitude: 1.0,
        },
        { page: 1, pageSize: 25 },
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pagination.totalCount).toBe(75);
        expect(result.data.pagination.currentPage).toBe(1);
        expect(result.data.pagination.totalPages).toBe(3); // ceil(75/25)
        expect(result.data.pagination.pageSize).toBe(25);
      }
    });

    it('should reject invalid page size (0)', async () => {
      const result = await service.findInBoundingBox(
        {
          swLatitude: 4.0,
          swLongitude: -3.0,
          neLatitude: 8.0,
          neLongitude: 1.0,
        },
        { page: 1, pageSize: 0 },
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should reject invalid page size (> 500)', async () => {
      const result = await service.findInBoundingBox(
        {
          swLatitude: 4.0,
          swLongitude: -3.0,
          neLatitude: 8.0,
          neLongitude: 1.0,
        },
        { page: 1, pageSize: 501 },
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should reject invalid page number (0)', async () => {
      const result = await service.findInBoundingBox(
        {
          swLatitude: 4.0,
          swLongitude: -3.0,
          neLatitude: 8.0,
          neLongitude: 1.0,
        },
        { page: 0, pageSize: 50 },
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should calculate correct offset for page 3 with pageSize 10', async () => {
      setupBboxResults([FACILITY_ID_3], 30);

      await service.findInBoundingBox(
        {
          swLatitude: 4.0,
          swLongitude: -3.0,
          neLatitude: 8.0,
          neLongitude: 1.0,
        },
        { page: 3, pageSize: 10 },
      );

      // Offset should be (3-1)*10 = 20
      const dataCall = mockPrisma.$queryRawUnsafe.mock.calls[1];
      expect(dataCall[5]).toBe(10); // LIMIT
      expect(dataCall[6]).toBe(20); // OFFSET
    });
  });
});
