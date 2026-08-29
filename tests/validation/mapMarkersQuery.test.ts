import { describe, it, expect } from 'vitest';
import { MapMarkersQuerySchema, validateInput } from '../../src/validation';

// ---------------------------------------------------------------------------
// Helper: a fully-valid bounding box (all four corners, in range)
// ---------------------------------------------------------------------------
const validBbox = {
  swLatitude: -10,
  swLongitude: 20,
  neLatitude: 10,
  neLongitude: 40,
};

describe('MapMarkersQuerySchema', () => {
  describe('bounding box: all-or-nothing corners', () => {
    it('accepts an empty object (0 corners, no filters)', () => {
      const result = validateInput(MapMarkersQuerySchema, {});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({});
      }
    });

    it('accepts all four corners with valid coordinates', () => {
      const result = validateInput(MapMarkersQuerySchema, validBbox);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.swLatitude).toBe(-10);
        expect(result.data.neLongitude).toBe(40);
      }
    });

    it('rejects only 1 corner provided (partial bbox)', () => {
      const result = MapMarkersQuerySchema.safeParse({ swLatitude: -10 });
      expect(result.success).toBe(false);
    });

    it('rejects only 2 corners provided (partial bbox)', () => {
      const result = MapMarkersQuerySchema.safeParse({ swLatitude: -10, swLongitude: 20 });
      expect(result.success).toBe(false);
    });

    it('rejects only 3 corners provided (partial bbox)', () => {
      const result = MapMarkersQuerySchema.safeParse({
        swLatitude: -10,
        swLongitude: 20,
        neLatitude: 10,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => /all four corners/i.test(i.message))).toBe(true);
      }
    });
  });

  describe('coordinate range validation', () => {
    it('rejects a corner below the latitude minimum with a per-field path', () => {
      const result = validateInput(MapMarkersQuerySchema, {
        ...validBbox,
        swLatitude: -200,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.errors.map((e) => e.path);
        expect(paths).toContain('swLatitude');
      }
    });

    it('rejects a corner above the longitude maximum with a per-field path', () => {
      const result = validateInput(MapMarkersQuerySchema, {
        ...validBbox,
        neLongitude: 999,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.errors.map((e) => e.path);
        expect(paths).toContain('neLongitude');
      }
    });
  });

  describe('attribute filter validation', () => {
    it('accepts valid filters alone with no bounding box', () => {
      const result = validateInput(MapMarkersQuerySchema, {
        country: 'Ghana',
        facilityType: 'hospital',
        operationalStatus: 'operational',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.country).toBe('Ghana');
        expect(result.data.facilityType).toBe('hospital');
        expect(result.data.operationalStatus).toBe('operational');
      }
    });

    it('rejects a country that is not a recognized African nation', () => {
      const narnia = validateInput(MapMarkersQuerySchema, { country: 'Narnia' });
      expect(narnia.success).toBe(false);

      const france = validateInput(MapMarkersQuerySchema, { country: 'France' });
      expect(france.success).toBe(false);
      if (!france.success) {
        expect(france.errors.map((e) => e.path)).toContain('country');
      }
    });

    it('rejects an invalid facilityType', () => {
      const result = validateInput(MapMarkersQuerySchema, { facilityType: 'spa' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.map((e) => e.path)).toContain('facilityType');
      }
    });

    it('rejects an invalid operationalStatus', () => {
      const result = validateInput(MapMarkersQuerySchema, {
        operationalStatus: 'closed_forever',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.map((e) => e.path)).toContain('operationalStatus');
      }
    });
  });

  describe('limit validation', () => {
    it('accepts a valid limit within range', () => {
      const result = validateInput(MapMarkersQuerySchema, { limit: 500 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(500);
      }
    });

    it('rejects a limit below the minimum (0)', () => {
      const result = validateInput(MapMarkersQuerySchema, { limit: 0 });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.map((e) => e.path)).toContain('limit');
      }
    });

    it('rejects a limit above the maximum (20001)', () => {
      const result = validateInput(MapMarkersQuerySchema, { limit: 20001 });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.map((e) => e.path)).toContain('limit');
      }
    });

    it('rejects a non-integer limit (1.5)', () => {
      const result = validateInput(MapMarkersQuerySchema, { limit: 1.5 });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.map((e) => e.path)).toContain('limit');
      }
    });
  });

  describe('aggregated (non-fail-fast) validation', () => {
    it('reports all field errors when multiple params are invalid', () => {
      const result = validateInput(MapMarkersQuerySchema, {
        country: 'Narnia',
        facilityType: 'spa',
        operationalStatus: 'closed_forever',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.errors.map((e) => e.path);
        expect(paths).toContain('country');
        expect(paths).toContain('facilityType');
        expect(paths).toContain('operationalStatus');
        // Aggregated, not just the first error
        expect(result.errors.length).toBeGreaterThan(1);
      }
    });
  });
});
