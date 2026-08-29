/**
 * Property-based tests for MapService.getMapMarkers()
 *
 * These exercise the universal "Correctness Properties" from the design document
 * (.kiro/specs/lightweight-map-endpoint/design.md) using fast-check over
 * randomized mock datasets and query params.
 *
 * Uses a MOCKED/injected Prisma client (matching the unit test harness in
 * tests/services/map.service.test.ts) — no real database is touched. The mock's
 * $queryRawUnsafe stands in for the slim projection query; for the soft-delete
 * property it additionally emulates the `WHERE f.deleted_at IS NULL` filter.
 *
 * Properties covered:
 * - Property 1 (Task 3.3): Slim Shape — Exact Fields, No Leakage
 * - Property 3 (Task 3.4): Soft-Delete Exclusion
 * - Property 6 (Task 3.5): All-or-Nothing BBox Validation
 * - Property 7 (Task 3.6): Count Invariant
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { MapService } from '../../src/services/map.service';
import { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Mock Prisma harness (mirrors tests/services/map.service.test.ts)
// ---------------------------------------------------------------------------

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

// Valid enum sets (confirmed against src/types/enums.ts).
const FACILITY_TYPES = [
  'hospital',
  'clinic',
  'health_post',
  'pharmacy',
  'laboratory',
  'community_health_center',
] as const;

const VERIFICATION_STATUSES = [
  'field_verified',
  'self_reported',
  'imported_secondary',
  'unverified',
] as const;

// The 7 keys that a slim marker must expose — nothing more, nothing less.
const SLIM_KEYS = [
  'id',
  'latitude',
  'longitude',
  'facilityType',
  'nameText',
  'country',
  'staleIndicator',
].sort();

// Fields that must NEVER leak into a slim marker.
const LEAKY_KEYS = [
  'beds',
  'energyProfile',
  'contactInfo',
  'ghgEmissions',
  'emissions',
  'addresses',
  'names',
  'verification_status',
  'verification_date',
  'verificationStatus',
  'verificationDate',
];

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** A raw SQL row shaped like the slim projection query output. */
const dbRowArb = fc.record({
  id: fc.uuid(),
  latitude: fc.double({ min: -90, max: 90, noNaN: true }),
  longitude: fc.double({ min: -180, max: 180, noNaN: true }),
  facility_type: fc.constantFrom(...FACILITY_TYPES),
  name_text: fc.string({ minLength: 1, maxLength: 40 }),
  country: fc.string({ minLength: 1, maxLength: 30 }),
  verification_status: fc.constantFrom(...VERIFICATION_STATUSES),
  verification_date: fc.option(
    fc.date({ min: new Date('2000-01-01'), max: new Date() }),
    { nil: null },
  ),
});

const dbRowsArb = fc.array(dbRowArb, { maxLength: 25 });

describe('MapService.getMapMarkers — property-based tests', () => {
  let service: MapService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new MapService(mockPrisma as unknown as PrismaClient);
  });

  // -------------------------------------------------------------------------
  // Property 1 (Task 3.3): Slim Shape — Exact Fields, No Leakage
  // Validates: Requirements 1.1, 1.2, 1.4, 11.1
  // -------------------------------------------------------------------------
  describe('Property 1: Slim Shape — Exact Fields, No Leakage (Reqs 1.1, 1.2, 1.4, 11.1)', () => {
    it('every returned marker has exactly the 7 slim keys and no excluded fields', async () => {
      await fc.assert(
        fc.asyncProperty(dbRowsArb, async (rows) => {
          mockPrisma.$queryRawUnsafe.mockResolvedValueOnce(rows);

          const result = await service.getMapMarkers({});

          expect(result.success).toBe(true);
          if (!result.success) return;

          for (const marker of result.data.markers) {
            // Key set is EXACTLY the seven slim keys.
            expect(Object.keys(marker).sort()).toEqual(SLIM_KEYS);
            // No leaky fields present.
            for (const leaked of LEAKY_KEYS) {
              expect(marker).not.toHaveProperty(leaked);
            }
          }
        }),
        { numRuns: 50 },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Property 3 (Task 3.4): Soft-Delete Exclusion
  // Validates: Requirement 5.1
  // -------------------------------------------------------------------------
  describe('Property 3: Soft-Delete Exclusion (Req 5.1)', () => {
    it('never returns a soft-deleted facility (mock emulates WHERE deleted_at IS NULL)', async () => {
      // Pool of facilities each carrying a deletedAt (null or a date).
      const facilityArb = fc.record({
        row: dbRowArb,
        deletedAt: fc.option(
          fc.date({ min: new Date('2000-01-01'), max: new Date() }),
          { nil: null },
        ),
      });

      await fc.assert(
        fc.asyncProperty(
          fc.array(facilityArb, { maxLength: 25 }),
          async (pool) => {
            const softDeletedIds = new Set(
              pool.filter((f) => f.deletedAt !== null).map((f) => f.row.id),
            );

            // The mock emulates the DB honoring `f.deleted_at IS NULL`:
            // only non-deleted rows are returned by the query.
            const visibleRows = pool
              .filter((f) => f.deletedAt === null)
              .map((f) => f.row);
            mockPrisma.$queryRawUnsafe.mockResolvedValueOnce(visibleRows);

            const result = await service.getMapMarkers({});

            expect(result.success).toBe(true);
            if (!result.success) return;

            for (const marker of result.data.markers) {
              expect(softDeletedIds.has(marker.id)).toBe(false);
            }
          },
        ),
        { numRuns: 50 },
      );
    });

    it('always includes the soft-delete exclusion clause in the generated SQL for any valid query', async () => {
      // Independent generators for the (optional) attribute filters; the SQL
      // must contain `f.deleted_at IS NULL` regardless of which are supplied.
      const queryArb = fc.record(
        {
          country: fc.constantFrom('Nigeria', 'Kenya', 'Ghana'),
          facilityType: fc.constantFrom(...FACILITY_TYPES),
        },
        { requiredKeys: [] },
      );

      await fc.assert(
        fc.asyncProperty(queryArb, async (query) => {
          mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([]);

          const result = await service.getMapMarkers(query);

          expect(result.success).toBe(true);
          const sql = mockPrisma.$queryRawUnsafe.mock.calls[0][0] as string;
          expect(sql).toContain('f.deleted_at IS NULL');

          mockPrisma.$queryRawUnsafe.mockClear();
        }),
        { numRuns: 50 },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Property 6 (Task 3.5): All-or-Nothing BBox Validation
  // Validates: Requirements 3.1, 3.2
  // -------------------------------------------------------------------------
  describe('Property 6: All-or-Nothing BBox Validation (Reqs 3.1, 3.2)', () => {
    const CORNER_KEYS = ['swLatitude', 'swLongitude', 'neLatitude', 'neLongitude'] as const;

    // In-range coordinate value for any corner.
    const coordArb = fc.double({ min: -90, max: 90, noNaN: true });

    it('accepts 0 or 4 corners and rejects 1-3 corners with VALIDATION_ERROR', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Pick a subset of the four corner keys (0..4 of them).
          fc.subarray([...CORNER_KEYS]),
          fc.array(coordArb, { minLength: 4, maxLength: 4 }),
          async (selectedCorners, values) => {
            const query: Record<string, number> = {};
            selectedCorners.forEach((key, idx) => {
              query[key] = values[idx];
            });

            const providedCount = selectedCorners.length;

            // For the valid cases the mock returns an empty result set.
            mockPrisma.$queryRawUnsafe.mockResolvedValue([]);

            const result = await service.getMapMarkers(query);

            if (providedCount === 0 || providedCount === 4) {
              // 0 or 4 corners => accepted (no bbox validation error).
              expect(result.success).toBe(true);
            } else {
              // 1-3 corners => VALIDATION_ERROR.
              expect(result.success).toBe(false);
              if (!result.success) {
                expect(result.error.code).toBe('VALIDATION_ERROR');
              }
            }

            mockPrisma.$queryRawUnsafe.mockClear();
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Property 7 (Task 3.6): Count Invariant
  // Validates: Requirements 7.1, 7.2
  // -------------------------------------------------------------------------
  describe('Property 7: Count Invariant (Reqs 7.1, 7.2)', () => {
    it('response.count always equals response.markers.length', async () => {
      await fc.assert(
        fc.asyncProperty(dbRowsArb, async (rows) => {
          mockPrisma.$queryRawUnsafe.mockResolvedValueOnce(rows);

          const result = await service.getMapMarkers({});

          expect(result.success).toBe(true);
          if (!result.success) return;

          expect(result.data.count).toBe(result.data.markers.length);
        }),
        { numRuns: 50 },
      );
    });
  });
});
