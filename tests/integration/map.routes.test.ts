/**
 * HTTP-level tests for GET /api/v1/facilities/map
 *
 * These tests exercise the REAL Express middleware stack (CORS, rate limiter,
 * optionalAuth) + the map route + MapService, while stubbing the Prisma query
 * layer. The project's test suite has no live/seeded database, so we mock
 * `@prisma/client` at the module boundary: `new PrismaClient()` (created inside
 * src/app.ts) returns a stub whose `$queryRawUnsafe` is a vi.fn() we control.
 * The stub stands in for PostGIS row retrieval.
 *
 * Covers spec tasks:
 *   - 7.1  Integration tests (Reqs 2.1, 3.1, 4.1, 4.2, 4.3, 5.1, 7.1, 7.2, 7.3, 8.1, 8.3, 9.1)
 *   - 4.2  Property 2: BBox Containment (Reqs 2.1, 2.2, 11.2)
 *   - 4.3  Property 4: Subset Consistency With the Full List (Reqs 2.3, 4.1, 4.2, 4.3, 6.1)
 *   - 4.4  Property 5: Field Agreement (Reqs 1.3, 6.2)
 *   - 4.5  Property 8: ETag Stability & 304 (Reqs 8.1, 8.2, 8.3, 8.4)
 *
 * SCOPING NOTE for tasks 4.3 (Subset Consistency) and 4.4 (Field Agreement):
 * The design's Property 4 and Property 5 compare the map endpoint against the
 * EXISTING full facility listing / GET /facilities/:id over a SHARED live
 * dataset. Faithfully implementing that cross-endpoint equivalence requires a
 * seeded live database that both endpoints read from — which this suite does
 * not have (Prisma is mocked). To avoid asserting false guarantees, we
 * implement the strongest SOUND version under the mocked-Prisma approach:
 *   - 4.3 validates that the map endpoint surfaces EXACTLY the filtered source
 *     pool (no more, no fewer ids) when the mock query draws from that pool.
 *   - 4.4 validates field-for-field agreement between each returned marker's
 *     projection (nameText, facilityType, country, coordinates) and its source
 *     row.
 * A full cross-endpoint check against a live seeded DB is deferred to a future
 * live-DB integration harness.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// --- Mock the Prisma client module BEFORE importing the app ---------------
// A single shared vi.fn() backs $queryRawUnsafe so tests can configure the
// rows the "database" returns. src/app.ts does `new PrismaClient()`, so the
// mocked constructor must return an object exposing that fn.
// `vi.hoisted` ensures the fn exists before the hoisted vi.mock factory runs.
const { queryRawUnsafeMock } = vi.hoisted(() => ({
  queryRawUnsafeMock: vi.fn(),
}));

vi.mock('@prisma/client', () => {
  return {
    PrismaClient: vi.fn().mockImplementation(() => ({
      $queryRaw: vi.fn(),
      $queryRawUnsafe: queryRawUnsafeMock,
      $executeRaw: vi.fn(),
      $connect: vi.fn(),
      $disconnect: vi.fn(),
    })),
  };
});

// Import AFTER the mock is registered so app picks up the stubbed client.
import request from 'supertest';
import app from '../../src/app';

const MAP_URL = '/api/v1/facilities/map';

const VALID_FACILITY_TYPES = [
  'hospital',
  'clinic',
  'health_post',
  'pharmacy',
  'laboratory',
  'community_health_center',
] as const;

const VALID_VERIFICATION_STATUSES = [
  'field_verified',
  'self_reported',
  'imported_secondary',
  'unverified',
] as const;

/** The exact slim marker keys the endpoint must return. */
const SLIM_KEYS = [
  'id',
  'latitude',
  'longitude',
  'facilityType',
  'nameText',
  'country',
  'staleIndicator',
].sort();

/** Build a raw SQL row as the slim projection query would return it. */
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    latitude: 6.5244,
    longitude: 3.3792,
    facility_type: 'hospital',
    name_text: 'Lagos General Hospital',
    country: 'Nigeria',
    verification_status: 'field_verified',
    verification_date: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  queryRawUnsafeMock.mockReset();
});

// ===========================================================================
// Task 7.1 — Integration tests
// ===========================================================================
describe('GET /api/v1/facilities/map — integration (Task 7.1)', () => {
  it('returns 200 with a slim payload: { markers, count } and exactly the 7 slim keys per marker', async () => {
    // Reqs 1.1, 7.1, 7.2
    queryRawUnsafeMock.mockResolvedValueOnce([
      makeRow({ id: 'a1', name_text: 'Alpha Clinic', facility_type: 'clinic' }),
      makeRow({ id: 'b2', name_text: 'Beta Hospital', facility_type: 'hospital' }),
    ]);

    const res = await request(app).get(MAP_URL);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.markers)).toBe(true);
    expect(res.body.count).toBe(2);
    expect(res.body.count).toBe(res.body.markers.length);

    for (const marker of res.body.markers) {
      expect(Object.keys(marker).sort()).toEqual(SLIM_KEYS);
      // Verification internals must never leak.
      expect(marker).not.toHaveProperty('verification_status');
      expect(marker).not.toHaveProperty('verificationStatus');
      expect(marker).not.toHaveProperty('verification_date');
    }
  });

  it('passes attribute filter combinations (country/facilityType/operationalStatus) through and returns 200', async () => {
    // Reqs 4.1, 4.2, 4.3
    queryRawUnsafeMock.mockResolvedValueOnce([makeRow()]);

    const res = await request(app).get(MAP_URL).query({
      country: 'Nigeria',
      facilityType: 'hospital',
      operationalStatus: 'operational',
    });

    expect(res.status).toBe(200);
    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(1);

    const call = queryRawUnsafeMock.mock.calls[0];
    const sql = call[0] as string;
    const params = call.slice(1) as unknown[];

    // All three filters bound as parameters (no interpolation of user values).
    expect(sql).toContain('f.country =');
    expect(sql).toContain('f.facility_type =');
    expect(sql).toContain('f.operational_status =');
    expect(params).toContain('Nigeria');
    expect(params).toContain('hospital');
    expect(params).toContain('operational');
  });

  it('passes bounding-box viewport params through as ST_MakeEnvelope bound params', async () => {
    // Reqs 2.1
    queryRawUnsafeMock.mockResolvedValueOnce([]);

    const res = await request(app).get(MAP_URL).query({
      sw_lat: -10,
      sw_lon: 20,
      ne_lat: 10,
      ne_lon: 40,
    });

    expect(res.status).toBe(200);
    const call = queryRawUnsafeMock.mock.calls[0];
    const sql = call[0] as string;
    const params = call.slice(1) as unknown[];
    expect(sql).toContain('ST_MakeEnvelope');
    expect(sql).toContain('ST_Intersects');
    // Envelope order: sw_lon, sw_lat, ne_lon, ne_lat.
    expect(params).toEqual([20, -10, 40, 10]);
  });

  it('returns 400 VALIDATION_ERROR for a partial bounding box (only sw_lat)', async () => {
    // Reqs 3.1
    const res = await request(app).get(MAP_URL).query({ sw_lat: 5 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    // No DB call should have been made on a validation failure.
    expect(queryRawUnsafeMock).not.toHaveBeenCalled();
  });

  it('sets ETag and Cache-Control headers on a 200 response', async () => {
    // Reqs 8.1
    queryRawUnsafeMock.mockResolvedValueOnce([makeRow()]);

    const res = await request(app).get(MAP_URL);

    expect(res.status).toBe(200);
    expect(res.headers['etag']).toBeDefined();
    expect(res.headers['etag']).toMatch(/^".*"$/);
    expect(res.headers['cache-control']).toContain('max-age');
  });

  it('returns 304 with an empty body when If-None-Match matches the ETag', async () => {
    // Reqs 8.3
    queryRawUnsafeMock.mockResolvedValue([makeRow()]);

    const first = await request(app).get(MAP_URL);
    const etag = first.headers['etag'];
    expect(etag).toBeDefined();

    const second = await request(app).get(MAP_URL).set('If-None-Match', etag);

    expect(second.status).toBe(304);
    expect(second.text === '' || second.text === undefined).toBe(true);
    expect(second.body).toEqual({});
  });

  it('allows public access via optionalAuth (no Authorization header) → 200', async () => {
    // Reqs 9.1
    queryRawUnsafeMock.mockResolvedValueOnce([makeRow()]);

    const res = await request(app).get(MAP_URL);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  it('returns 200 with { markers: [], count: 0 } for an empty result', async () => {
    // Reqs 7.3
    queryRawUnsafeMock.mockResolvedValueOnce([]);

    const res = await request(app).get(MAP_URL);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ markers: [], count: 0 });
  });
});

// ===========================================================================
// Task 4.2 — Property 2: BBox Containment
// Validates: Requirements 2.1, 2.2, 11.2
// ===========================================================================
describe('Property 2: BBox Containment (Task 4.2)', () => {
  it('returns only markers whose coordinates lie within the supplied bounding box', async () => {
    await fc.assert(
      fc.asyncProperty(
        // A bbox with sw <= ne on each axis.
        fc
          .record({
            swLat: fc.double({ min: -80, max: 0, noNaN: true }),
            swLon: fc.double({ min: -170, max: 0, noNaN: true }),
            latSpan: fc.double({ min: 1, max: 80, noNaN: true }),
            lonSpan: fc.double({ min: 1, max: 170, noNaN: true }),
          })
          .map((b) => ({
            swLat: b.swLat,
            swLon: b.swLon,
            neLat: b.swLat + b.latSpan,
            neLon: b.swLon + b.lonSpan,
          })),
        // A pool of facility rows with arbitrary coordinates.
        fc.array(
          fc.record({
            id: fc.uuid(),
            latitude: fc.double({ min: -89, max: 89, noNaN: true }),
            longitude: fc.double({ min: -179, max: 179, noNaN: true }),
            facility_type: fc.constantFrom(...VALID_FACILITY_TYPES),
            name_text: fc.string({ minLength: 1, maxLength: 20 }),
            country: fc.constant('Nigeria'),
            verification_status: fc.constantFrom(...VALID_VERIFICATION_STATUSES),
            verification_date: fc.constant(new Date()),
          }),
          { minLength: 0, maxLength: 15 },
        ),
        async (bbox, pool) => {
          // The mock stands in for ST_Intersects: return only rows inside bbox.
          const inside = pool.filter(
            (r) =>
              bbox.swLon <= r.longitude &&
              r.longitude <= bbox.neLon &&
              bbox.swLat <= r.latitude &&
              r.latitude <= bbox.neLat,
          );
          queryRawUnsafeMock.mockReset();
          queryRawUnsafeMock.mockResolvedValueOnce(inside);

          const res = await request(app).get(MAP_URL).query({
            sw_lat: bbox.swLat,
            sw_lon: bbox.swLon,
            ne_lat: bbox.neLat,
            ne_lon: bbox.neLon,
          });

          expect(res.status).toBe(200);
          for (const m of res.body.markers) {
            expect(m.longitude).toBeGreaterThanOrEqual(bbox.swLon);
            expect(m.longitude).toBeLessThanOrEqual(bbox.neLon);
            expect(m.latitude).toBeGreaterThanOrEqual(bbox.swLat);
            expect(m.latitude).toBeLessThanOrEqual(bbox.neLat);
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});

// ===========================================================================
// Task 4.3 — Property 4: Subset Consistency With the Full List
// Validates: Requirements 2.3, 4.1, 4.2, 4.3, 6.1
//
// Sound-under-mock version: with the mock configured so the map query draws
// from a given source pool under identical filters, the map endpoint must
// surface EXACTLY that pool's ids (no more, no fewer). See file-header note.
// ===========================================================================
describe('Property 4: Subset Consistency with the source pool (Task 4.3)', () => {
  it('returns exactly the set of ids present in the filtered source pool', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            id: fc.uuid(),
            latitude: fc.double({ min: -89, max: 89, noNaN: true }),
            longitude: fc.double({ min: -179, max: 179, noNaN: true }),
            facility_type: fc.constantFrom(...VALID_FACILITY_TYPES),
            name_text: fc.string({ minLength: 1, maxLength: 20 }),
            country: fc.constant('Kenya'),
            verification_status: fc.constantFrom(...VALID_VERIFICATION_STATUSES),
            verification_date: fc.constant(new Date()),
          }),
          { minLength: 0, maxLength: 20 },
        ),
        async (pool) => {
          // De-duplicate ids so the "source of truth" is well defined.
          const seen = new Set<string>();
          const uniquePool = pool.filter((r) => {
            if (seen.has(r.id)) return false;
            seen.add(r.id);
            return true;
          });

          queryRawUnsafeMock.mockReset();
          queryRawUnsafeMock.mockResolvedValueOnce(uniquePool);

          const res = await request(app)
            .get(MAP_URL)
            .query({ country: 'Kenya' });

          expect(res.status).toBe(200);
          const returnedIds = new Set<string>(
            res.body.markers.map((m: { id: string }) => m.id),
          );
          const poolIds = new Set<string>(uniquePool.map((r) => r.id));

          expect(returnedIds).toEqual(poolIds);
          expect(res.body.count).toBe(uniquePool.length);
        },
      ),
      { numRuns: 40 },
    );
  });
});

// ===========================================================================
// Task 4.4 — Property 5: Field Agreement
// Validates: Requirements 1.3, 6.2
//
// Sound-under-mock version: each returned marker's projected fields must match
// its source row field-for-field (nameText, facilityType, country, coords).
// See file-header note re: deferred live cross-endpoint check.
// ===========================================================================
describe('Property 5: Field Agreement between marker and source row (Task 4.4)', () => {
  it('projects nameText, facilityType, country and coordinates identical to the source row', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            id: fc.uuid(),
            latitude: fc.double({ min: -89, max: 89, noNaN: true }),
            longitude: fc.double({ min: -179, max: 179, noNaN: true }),
            facility_type: fc.constantFrom(...VALID_FACILITY_TYPES),
            name_text: fc.string({ minLength: 1, maxLength: 30 }),
            country: fc.constantFrom('Nigeria', 'Kenya', 'Ghana', 'Egypt'),
            verification_status: fc.constantFrom(...VALID_VERIFICATION_STATUSES),
            verification_date: fc.constant(new Date()),
          }),
          { minLength: 1, maxLength: 15 },
        ),
        async (pool) => {
          // Ensure unique ids so we can look up the source row per marker.
          const seen = new Set<string>();
          const uniquePool = pool.filter((r) => {
            if (seen.has(r.id)) return false;
            seen.add(r.id);
            return true;
          });

          queryRawUnsafeMock.mockReset();
          queryRawUnsafeMock.mockResolvedValueOnce(uniquePool);

          const res = await request(app).get(MAP_URL);

          expect(res.status).toBe(200);
          const sourceById = Object.fromEntries(
            uniquePool.map((r) => [r.id, r]),
          );

          for (const m of res.body.markers) {
            const src = sourceById[m.id];
            expect(src).toBeDefined();
            expect(m.nameText).toBe(src.name_text);
            expect(m.facilityType).toBe(src.facility_type);
            expect(m.country).toBe(src.country);
            // Add 0 to normalize -0 -> 0 (JSON serialization collapses the
            // sign of negative zero, which is irrelevant for coordinates).
            expect(m.latitude + 0).toBe(src.latitude + 0);
            expect(m.longitude + 0).toBe(src.longitude + 0);
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});

// ===========================================================================
// Task 4.5 — Property 8: ETag Stability & 304
// Validates: Requirements 8.1, 8.2, 8.3, 8.4
// ===========================================================================
describe('Property 8: ETag Stability & 304 (Task 4.5)', () => {
  it('identical requests yield identical ETags, and matching If-None-Match yields 304 with empty body', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            id: fc.uuid(),
            latitude: fc.double({ min: -89, max: 89, noNaN: true }),
            longitude: fc.double({ min: -179, max: 179, noNaN: true }),
            facility_type: fc.constantFrom(...VALID_FACILITY_TYPES),
            name_text: fc.string({ minLength: 1, maxLength: 20 }),
            country: fc.constantFrom('Nigeria', 'Kenya', 'Ghana'),
            verification_status: fc.constantFrom(...VALID_VERIFICATION_STATUSES),
            verification_date: fc.constant(new Date()),
          }),
          { minLength: 0, maxLength: 12 },
        ),
        // Arbitrary (valid) filter params attached to both requests.
        fc.record({
          country: fc.option(
            fc.constantFrom('Nigeria', 'Kenya', 'Ghana'),
            { nil: undefined },
          ),
          facilityType: fc.option(
            fc.constantFrom(...VALID_FACILITY_TYPES),
            { nil: undefined },
          ),
        }),
        async (pool, filters) => {
          const query: Record<string, string> = {};
          if (filters.country) query.country = filters.country;
          if (filters.facilityType) query.facilityType = filters.facilityType;

          // Same mocked rows for both identical requests.
          queryRawUnsafeMock.mockReset();
          queryRawUnsafeMock.mockResolvedValue(pool);

          const first = await request(app).get(MAP_URL).query(query);
          const second = await request(app).get(MAP_URL).query(query);

          expect(first.status).toBe(200);
          expect(second.status).toBe(200);
          expect(first.headers['etag']).toBeDefined();
          // Stability: identical query + identical rows → same ETag.
          expect(second.headers['etag']).toBe(first.headers['etag']);

          // Conditional request with matching If-None-Match → 304, empty body.
          const conditional = await request(app)
            .get(MAP_URL)
            .query(query)
            .set('If-None-Match', first.headers['etag']);

          expect(conditional.status).toBe(304);
          expect(conditional.body).toEqual({});
          expect(conditional.text === '' || conditional.text === undefined).toBe(true);
        },
      ),
      { numRuns: 30 },
    );
  });
});
