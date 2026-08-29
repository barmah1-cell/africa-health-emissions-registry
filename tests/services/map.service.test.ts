/**
 * Unit tests for MapService.getMapMarkers()
 *
 * Uses a mocked/injected Prisma client (matching the GeospatialService bbox
 * test conventions) to verify:
 * - Validation branch returns VALIDATION_ERROR (and no query is issued)
 * - WHERE-clause assembly with correct bound parameters (bbox present/absent,
 *   each attribute filter) — no user value is string-interpolated into the SQL
 * - staleIndicator derivation and exclusion of verification fields from markers
 * - Empty result returns { markers: [], count: 0 }
 *
 * _Requirements: 1.1, 1.4, 5.1, 7.1, 7.2, 12.1_
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MapService } from '../../src/services/map.service';
import { PrismaClient } from '@prisma/client';

// Mock PrismaClient — only $queryRawUnsafe is exercised by MapService.
function createMockPrisma() {
  return {
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    $executeRaw: vi.fn(),
  } as unknown as PrismaClient & {
    $queryRaw: ReturnType<typeof vi.fn>;
    $queryRawUnsafe: ReturnType<typeof vi.fn>;
    $executeRaw: ReturnType<typeof vi.fn>;
  };
}

const FACILITY_ID_1 = '550e8400-e29b-41d4-a716-446655440000';
const FACILITY_ID_2 = '660e8400-e29b-41d4-a716-446655440001';

/** Build a raw SQL row as returned by the slim projection query. */
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FACILITY_ID_1,
    latitude: 6.5244,
    longitude: 3.3792,
    facility_type: 'hospital',
    name_text: 'Lagos General Hospital',
    country: 'Nigeria',
    verification_status: 'verified',
    verification_date: new Date(),
    ...overrides,
  };
}

/** A date clearly older than the 24-month staleness threshold. */
function staleDate(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 3);
  return d;
}

describe('MapService.getMapMarkers', () => {
  let service: MapService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new MapService(mockPrisma as unknown as PrismaClient);
  });

  /** Retrieve the sql string and bound params passed to $queryRawUnsafe. */
  function lastQueryCall() {
    const call = mockPrisma.$queryRawUnsafe.mock.calls[0];
    return { sql: call[0] as string, params: call.slice(1) as unknown[] };
  }

  describe('validation branch', () => {
    it('returns VALIDATION_ERROR for a partial bounding box and does not query the DB', async () => {
      // Only one of four corners provided (1-3 corners is invalid).
      const result = await service.getMapMarkers({ swLatitude: 5 });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
      expect(mockPrisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });
  });

  describe('WHERE-clause assembly and parameter binding', () => {
    it('assembles soft-delete-only clause with no params and no ST_Intersects when no bbox/filters given', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([]);

      const result = await service.getMapMarkers({});

      expect(result.success).toBe(true);
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);

      const { sql, params } = lastQueryCall();
      expect(sql).toContain('f.deleted_at IS NULL');
      expect(sql).not.toContain('ST_Intersects');
      expect(params).toEqual([]);
    });

    it('binds bbox corners in order [swLon, swLat, neLon, neLat] using placeholders (no interpolation)', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([]);

      await service.getMapMarkers({
        swLatitude: -10.5,
        swLongitude: 25.0,
        neLatitude: 5.5,
        neLongitude: 40.0,
      });

      const { sql, params } = lastQueryCall();
      // Uses the PostGIS envelope technique.
      expect(sql).toContain('ST_MakeEnvelope');
      expect(sql).toContain('ST_Intersects');
      // Placeholders, not literal values, appear in the SQL text.
      expect(sql).toContain('$1');
      expect(sql).toContain('$2');
      expect(sql).toContain('$3');
      expect(sql).toContain('$4');
      expect(sql).not.toContain('25');
      expect(sql).not.toContain('40');
      // Bound params in ST_MakeEnvelope order: sw_lon, sw_lat, ne_lon, ne_lat.
      expect(params).toEqual([25.0, -10.5, 40.0, 5.5]);
    });

    it('adds a bound country condition', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([]);

      await service.getMapMarkers({ country: 'Nigeria' });

      const { sql, params } = lastQueryCall();
      expect(sql).toContain('f.country = $1');
      expect(sql).not.toContain('Nigeria');
      expect(params).toEqual(['Nigeria']);
    });

    it('adds a bound facility_type condition', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([]);

      await service.getMapMarkers({ facilityType: 'hospital' });

      const { sql, params } = lastQueryCall();
      expect(sql).toContain('f.facility_type = $1');
      expect(sql).not.toContain("'hospital'");
      expect(params).toEqual(['hospital']);
    });

    it('adds a bound operational_status condition', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([]);

      await service.getMapMarkers({ operationalStatus: 'operational' });

      const { sql, params } = lastQueryCall();
      expect(sql).toContain('f.operational_status = $1');
      expect(sql).not.toContain("'operational'");
      expect(params).toEqual(['operational']);
    });

    it('binds bbox and every filter with sequential placeholders in the correct order', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([]);

      await service.getMapMarkers({
        swLatitude: -10.5,
        swLongitude: 25.0,
        neLatitude: 5.5,
        neLongitude: 40.0,
        country: 'Nigeria',
        facilityType: 'hospital',
        operationalStatus: 'operational',
      });

      const { sql, params } = lastQueryCall();
      expect(sql).toContain('f.country = $5');
      expect(sql).toContain('f.facility_type = $6');
      expect(sql).toContain('f.operational_status = $7');
      expect(params).toEqual([25.0, -10.5, 40.0, 5.5, 'Nigeria', 'hospital', 'operational']);
    });
  });

  describe('staleIndicator derivation and field projection', () => {
    it('marks unverified-with-no-date as stale and old-date as stale, recent-date as fresh', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
        makeRow({ id: FACILITY_ID_1, verification_status: 'unverified', verification_date: null }),
        makeRow({ id: FACILITY_ID_2, verification_status: 'verified', verification_date: staleDate() }),
        makeRow({
          id: '770e8400-e29b-41d4-a716-446655440002',
          verification_status: 'verified',
          verification_date: new Date(),
        }),
      ]);

      const result = await service.getMapMarkers({});

      expect(result.success).toBe(true);
      if (result.success) {
        const byId = Object.fromEntries(result.data.markers.map((m) => [m.id, m]));
        expect(byId[FACILITY_ID_1].staleIndicator).toBe(true); // unverified, no date
        expect(byId[FACILITY_ID_2].staleIndicator).toBe(true); // date older than 24 months
        expect(byId['770e8400-e29b-41d4-a716-446655440002'].staleIndicator).toBe(false); // recent
      }
    });

    it('returns only the slim marker keys and excludes verification fields', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([makeRow()]);

      const result = await service.getMapMarkers({});

      expect(result.success).toBe(true);
      if (result.success) {
        const marker = result.data.markers[0];
        expect(Object.keys(marker).sort()).toEqual(
          ['country', 'facilityType', 'id', 'latitude', 'longitude', 'nameText', 'staleIndicator'].sort(),
        );
        expect(marker).not.toHaveProperty('verification_status');
        expect(marker).not.toHaveProperty('verification_date');
        expect(marker).not.toHaveProperty('verificationStatus');
        expect(marker).not.toHaveProperty('verificationDate');
      }
    });

    it('maps row scalar fields onto the marker', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([makeRow()]);

      const result = await service.getMapMarkers({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.markers[0]).toMatchObject({
          id: FACILITY_ID_1,
          latitude: 6.5244,
          longitude: 3.3792,
          facilityType: 'hospital',
          nameText: 'Lagos General Hospital',
          country: 'Nigeria',
        });
      }
    });
  });

  describe('empty result', () => {
    it('returns { markers: [], count: 0 } when the query returns no rows', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([]);

      const result = await service.getMapMarkers({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ markers: [], count: 0 });
      }
    });

    it('sets count equal to the number of markers', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
        makeRow({ id: FACILITY_ID_1 }),
        makeRow({ id: FACILITY_ID_2 }),
      ]);

      const result = await service.getMapMarkers({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.count).toBe(2);
        expect(result.data.count).toBe(result.data.markers.length);
      }
    });
  });
});
