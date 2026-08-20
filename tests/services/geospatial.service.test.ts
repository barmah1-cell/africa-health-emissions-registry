/**
 * Unit tests for GeospatialService.findNearby()
 *
 * Uses mocked Prisma client to verify:
 * - Valid query returns facilities ordered by distance
 * - Invalid coordinates return validation error
 * - Invalid radius returns validation error
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

const FACILITY_ID_1 = '550e8400-e29b-41d4-a716-446655440000';
const FACILITY_ID_2 = '660e8400-e29b-41d4-a716-446655440001';
const FACILITY_ID_3 = '770e8400-e29b-41d4-a716-446655440002';

const makeFacilityDbRecord = (id: string, nameText: string) => ({
  id,
  names: { en: nameText },
  addresses: { en: '123 Main Street' },
  defaultLocale: 'en',
  nameText,
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
});

describe('GeospatialService.findNearby', () => {
  let service: GeospatialService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new GeospatialService(mockPrisma as unknown as PrismaClient);
  });

  /**
   * Helper: set up mock for a successful proximity search returning facilities with distances.
   */
  function setupNearbyResults(
    results: Array<{ id: string; distance_meters: number; nameText: string }>,
    totalCount?: number,
  ) {
    const count = totalCount ?? results.length;

    // Count query
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(count) }]);

    // Data query (id + distance_meters)
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce(
      results.map((r) => ({ id: r.id, distance_meters: r.distance_meters })),
    );

    // For each facility retrieved via getFacilityById
    for (const r of results) {
      mockPrisma.facility.findUniqueOrThrow.mockResolvedValueOnce(
        makeFacilityDbRecord(r.id, r.nameText),
      );
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { lat: -1.9403, lon: 29.8739 },
      ]);
    }
  }

  function setupEmptyResults() {
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(0) }]);
  }

  describe('validation - coordinates', () => {
    it('should reject latitude below -90', async () => {
      const result = await service.findNearby({
        latitude: -91,
        longitude: 29.0,
        radiusKm: 10,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details).toBeDefined();
        const fields = result.error.details!.map((d) => d.field);
        expect(fields).toContain('latitude');
      }
    });

    it('should reject latitude above 90', async () => {
      const result = await service.findNearby({
        latitude: 91,
        longitude: 29.0,
        radiusKm: 10,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details).toBeDefined();
        const fields = result.error.details!.map((d) => d.field);
        expect(fields).toContain('latitude');
      }
    });

    it('should reject longitude below -180', async () => {
      const result = await service.findNearby({
        latitude: 0,
        longitude: -181,
        radiusKm: 10,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details).toBeDefined();
        const fields = result.error.details!.map((d) => d.field);
        expect(fields).toContain('longitude');
      }
    });

    it('should reject longitude above 180', async () => {
      const result = await service.findNearby({
        latitude: 0,
        longitude: 181,
        radiusKm: 10,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details).toBeDefined();
        const fields = result.error.details!.map((d) => d.field);
        expect(fields).toContain('longitude');
      }
    });

    it('should reject missing latitude', async () => {
      const result = await service.findNearby({
        longitude: 29.0,
        radiusKm: 10,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should reject missing longitude', async () => {
      const result = await service.findNearby({
        latitude: -1.9,
        radiusKm: 10,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should accept boundary latitude values (-90 and 90)', async () => {
      setupEmptyResults();
      const result1 = await service.findNearby({
        latitude: -90,
        longitude: 0,
        radiusKm: 10,
      });
      expect(result1.success).toBe(true);

      setupEmptyResults();
      const result2 = await service.findNearby({
        latitude: 90,
        longitude: 0,
        radiusKm: 10,
      });
      expect(result2.success).toBe(true);
    });

    it('should accept boundary longitude values (-180 and 180)', async () => {
      setupEmptyResults();
      const result1 = await service.findNearby({
        latitude: 0,
        longitude: -180,
        radiusKm: 10,
      });
      expect(result1.success).toBe(true);

      setupEmptyResults();
      const result2 = await service.findNearby({
        latitude: 0,
        longitude: 180,
        radiusKm: 10,
      });
      expect(result2.success).toBe(true);
    });
  });

  describe('validation - radius', () => {
    it('should reject radius below 0.1 km', async () => {
      const result = await service.findNearby({
        latitude: -1.9,
        longitude: 29.0,
        radiusKm: 0.05,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details).toBeDefined();
        const fields = result.error.details!.map((d) => d.field);
        expect(fields).toContain('radiusKm');
      }
    });

    it('should reject radius above 1000 km', async () => {
      const result = await service.findNearby({
        latitude: -1.9,
        longitude: 29.0,
        radiusKm: 1001,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details).toBeDefined();
        const fields = result.error.details!.map((d) => d.field);
        expect(fields).toContain('radiusKm');
      }
    });

    it('should reject zero radius', async () => {
      const result = await service.findNearby({
        latitude: -1.9,
        longitude: 29.0,
        radiusKm: 0,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should reject negative radius', async () => {
      const result = await service.findNearby({
        latitude: -1.9,
        longitude: 29.0,
        radiusKm: -5,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should reject missing radius', async () => {
      const result = await service.findNearby({
        latitude: -1.9,
        longitude: 29.0,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should accept boundary radius values (0.1 and 1000)', async () => {
      setupEmptyResults();
      const result1 = await service.findNearby({
        latitude: -1.9,
        longitude: 29.0,
        radiusKm: 0.1,
      });
      expect(result1.success).toBe(true);

      setupEmptyResults();
      const result2 = await service.findNearby({
        latitude: -1.9,
        longitude: 29.0,
        radiusKm: 1000,
      });
      expect(result2.success).toBe(true);
    });
  });

  describe('successful query - ordering by distance', () => {
    it('should return facilities ordered by distance (nearest first)', async () => {
      setupNearbyResults([
        { id: FACILITY_ID_1, distance_meters: 500, nameText: 'Nearby Clinic' },
        { id: FACILITY_ID_2, distance_meters: 2500, nameText: 'Mid Hospital' },
        { id: FACILITY_ID_3, distance_meters: 8000, nameText: 'Far Clinic' },
      ]);

      const result = await service.findNearby({
        latitude: -1.9403,
        longitude: 29.8739,
        radiusKm: 10,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.data).toHaveLength(3);
        // Distance should be in km
        expect(result.data.data[0].distanceKm).toBeCloseTo(0.5, 1);
        expect(result.data.data[1].distanceKm).toBeCloseTo(2.5, 1);
        expect(result.data.data[2].distanceKm).toBeCloseTo(8.0, 1);
        // Verify ordering: first result is closest
        expect(result.data.data[0].distanceKm).toBeLessThan(result.data.data[1].distanceKm);
        expect(result.data.data[1].distanceKm).toBeLessThan(result.data.data[2].distanceKm);
      }
    });

    it('should convert distance from meters to km', async () => {
      setupNearbyResults([
        { id: FACILITY_ID_1, distance_meters: 1500, nameText: 'Test Clinic' },
      ]);

      const result = await service.findNearby({
        latitude: -1.9403,
        longitude: 29.8739,
        radiusKm: 5,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.data[0].distanceKm).toBe(1.5);
      }
    });

    it('should use ST_DWithin in the count query', async () => {
      setupEmptyResults();

      await service.findNearby({
        latitude: -1.9403,
        longitude: 29.8739,
        radiusKm: 10,
      });

      const countCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
      expect(countCall[0]).toContain('ST_DWithin');
      expect(countCall[0]).toContain('deleted_at IS NULL');
    });

    it('should convert radius from km to meters', async () => {
      setupEmptyResults();

      await service.findNearby({
        latitude: -1.9403,
        longitude: 29.8739,
        radiusKm: 10,
      });

      const countCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
      // Radius should be passed as 10000 meters (10 km * 1000)
      expect(countCall[3]).toBe(10000);
    });

    it('should pass longitude and latitude in correct order to ST_MakePoint', async () => {
      setupEmptyResults();

      await service.findNearby({
        latitude: -1.9403,
        longitude: 29.8739,
        radiusKm: 5,
      });

      const countCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
      // ST_MakePoint takes (lon, lat), so longitude should be $1 and latitude $2
      expect(countCall[1]).toBe(29.8739); // longitude
      expect(countCall[2]).toBe(-1.9403); // latitude
    });

    it('should use ORDER BY distance_meters ASC in data query', async () => {
      setupNearbyResults([
        { id: FACILITY_ID_1, distance_meters: 500, nameText: 'Test' },
      ]);

      await service.findNearby({
        latitude: -1.9403,
        longitude: 29.8739,
        radiusKm: 10,
      });

      // Data query is the second call
      const dataCall = mockPrisma.$queryRawUnsafe.mock.calls[1];
      expect(dataCall[0]).toContain('ORDER BY distance_meters ASC');
    });
  });

  describe('empty results', () => {
    it('should return empty collection with count of zero for no matches', async () => {
      setupEmptyResults();

      const result = await service.findNearby({
        latitude: -1.9403,
        longitude: 29.8739,
        radiusKm: 1,
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

    it('should return empty collection preserving requested page number', async () => {
      setupEmptyResults();

      const result = await service.findNearby(
        { latitude: -1.9403, longitude: 29.8739, radiusKm: 1 },
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
    it('should use default pagination (page 1, pageSize 100) when not provided', async () => {
      setupNearbyResults([
        { id: FACILITY_ID_1, distance_meters: 500, nameText: 'Test' },
      ]);

      const result = await service.findNearby({
        latitude: -1.9403,
        longitude: 29.8739,
        radiusKm: 10,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pagination.currentPage).toBe(1);
        expect(result.data.pagination.pageSize).toBe(100);
      }

      // Verify LIMIT and OFFSET in data query
      const dataCall = mockPrisma.$queryRawUnsafe.mock.calls[1];
      expect(dataCall[4]).toBe(100); // LIMIT (pageSize)
      expect(dataCall[5]).toBe(0);   // OFFSET (page 1)
    });

    it('should apply custom pagination parameters', async () => {
      setupNearbyResults(
        [{ id: FACILITY_ID_1, distance_meters: 3000, nameText: 'Test' }],
        25,
      );

      const result = await service.findNearby(
        { latitude: -1.9403, longitude: 29.8739, radiusKm: 10 },
        { page: 2, pageSize: 10 },
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pagination.currentPage).toBe(2);
        expect(result.data.pagination.pageSize).toBe(10);
        expect(result.data.pagination.totalCount).toBe(25);
        expect(result.data.pagination.totalPages).toBe(3); // ceil(25/10)
      }

      // Verify LIMIT and OFFSET in data query
      const dataCall = mockPrisma.$queryRawUnsafe.mock.calls[1];
      expect(dataCall[4]).toBe(10);  // LIMIT (pageSize)
      expect(dataCall[5]).toBe(10);  // OFFSET ((page 2 - 1) * 10)
    });

    it('should calculate totalPages correctly', async () => {
      setupNearbyResults(
        [{ id: FACILITY_ID_1, distance_meters: 500, nameText: 'Test' }],
        150,
      );

      const result = await service.findNearby(
        { latitude: -1.9403, longitude: 29.8739, radiusKm: 50 },
        { page: 1, pageSize: 100 },
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pagination.totalCount).toBe(150);
        expect(result.data.pagination.totalPages).toBe(2); // ceil(150/100)
      }
    });

    it('should reject invalid pagination - page less than 1', async () => {
      const result = await service.findNearby(
        { latitude: -1.9403, longitude: 29.8739, radiusKm: 10 },
        { page: 0, pageSize: 10 },
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details).toBeDefined();
        const fields = result.error.details!.map((d) => d.field);
        expect(fields).toContain('page');
      }
    });

    it('should reject invalid pagination - pageSize greater than 500', async () => {
      const result = await service.findNearby(
        { latitude: -1.9403, longitude: 29.8739, radiusKm: 10 },
        { page: 1, pageSize: 501 },
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details).toBeDefined();
        const fields = result.error.details!.map((d) => d.field);
        expect(fields).toContain('pageSize');
      }
    });

    it('should reject invalid pagination - pageSize less than 1', async () => {
      const result = await service.findNearby(
        { latitude: -1.9403, longitude: 29.8739, radiusKm: 10 },
        { page: 1, pageSize: 0 },
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('soft-delete exclusion', () => {
    it('should always include deleted_at IS NULL in queries', async () => {
      setupEmptyResults();

      await service.findNearby({
        latitude: -1.9403,
        longitude: 29.8739,
        radiusKm: 10,
      });

      const countCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
      expect(countCall[0]).toContain('deleted_at IS NULL');
    });
  });

  describe('facility response fields', () => {
    it('should include all expected fields in facility response', async () => {
      setupNearbyResults([
        { id: FACILITY_ID_1, distance_meters: 1000, nameText: 'Complete Facility' },
      ]);

      const result = await service.findNearby({
        latitude: -1.9403,
        longitude: 29.8739,
        radiusKm: 5,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const facility = result.data.data[0];
        expect(facility).toHaveProperty('id');
        expect(facility).toHaveProperty('names');
        expect(facility).toHaveProperty('addresses');
        expect(facility).toHaveProperty('defaultLocale');
        expect(facility).toHaveProperty('facilityType');
        expect(facility).toHaveProperty('country');
        expect(facility).toHaveProperty('geolocation');
        expect(facility).toHaveProperty('distanceKm');
        expect(facility).toHaveProperty('staleIndicator');
        expect(facility).toHaveProperty('energyStaleIndicator');
        expect(facility.distanceKm).toBe(1.0);
      }
    });
  });
});
