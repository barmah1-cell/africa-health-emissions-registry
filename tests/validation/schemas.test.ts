import { describe, it, expect } from 'vitest';
import {
  CreateFacilityInputSchema,
  UpdateFacilityInputSchema,
  AfricaGeoPointSchema,
  GeneralGeoPointSchema,
  EnergyProfileSchema,
  GhgEmissionsSchema,
  EmissionFactorSchema,
  SearchFiltersSchema,
  PaginationParamsSchema,
  ProximityQuerySchema,
  BoundingBoxQuerySchema,
  LocaleCodeSchema,
  validateInput,
} from '../../src/validation';

// ---------------------------------------------------------------------------
// Helper: a minimal valid facility input
// ---------------------------------------------------------------------------
const validFacilityInput = {
  names: { en: 'Test Hospital' },
  facilityType: 'hospital',
  country: 'Kenya',
  adminRegion: 'Nairobi County',
  geolocation: { latitude: -1.286, longitude: 36.817 },
  operationalStatus: 'operational',
  ownership: 'public',
};

describe('CreateFacilityInputSchema', () => {
  it('accepts a valid facility input with required fields only', () => {
    const result = CreateFacilityInputSchema.safeParse(validFacilityInput);
    expect(result.success).toBe(true);
  });

  it('accepts a valid facility with all optional fields', () => {
    const full = {
      ...validFacilityInput,
      addresses: { en: '123 Main St' },
      city: 'Nairobi',
      contactInfo: { phone: '+254700000000', email: 'test@example.com', website: 'https://example.com' },
      beds: 200,
      energyProfile: [{ energyType: 'solar', consumptionKwhYear: 50000 }],
      verificationStatus: 'field_verified',
      defaultLocale: 'en',
    };
    const result = CreateFacilityInputSchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields and reports all errors', () => {
    const result = CreateFacilityInputSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('names');
      expect(paths).toContain('facilityType');
      expect(paths).toContain('country');
      expect(paths).toContain('adminRegion');
      expect(paths).toContain('operationalStatus');
      expect(paths).toContain('ownership');
      // Multiple errors reported (not fail-fast)
      expect(result.error.issues.length).toBeGreaterThan(1);
    }
  });

  it('rejects invalid country (not African nation)', () => {
    const input = { ...validFacilityInput, country: 'France' };
    const result = CreateFacilityInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects geolocation outside Africa bounds', () => {
    const input = { ...validFacilityInput, geolocation: { latitude: 50, longitude: 10 } };
    const result = CreateFacilityInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects string fields exceeding 500 characters', () => {
    const longStr = 'a'.repeat(501);
    const input = { ...validFacilityInput, adminRegion: longStr };
    const result = CreateFacilityInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects beds exceeding 50000', () => {
    const input = { ...validFacilityInput, beds: 50001 };
    const result = CreateFacilityInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects non-integer beds', () => {
    const input = { ...validFacilityInput, beds: 10.5 };
    const result = CreateFacilityInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects empty names object', () => {
    const input = { ...validFacilityInput, names: {} };
    const result = CreateFacilityInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe('UpdateFacilityInputSchema', () => {
  it('accepts an empty object (all fields optional)', () => {
    const result = UpdateFacilityInputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts a partial update', () => {
    const result = UpdateFacilityInputSchema.safeParse({ operationalStatus: 'temporarily_closed' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid enum value', () => {
    const result = UpdateFacilityInputSchema.safeParse({ facilityType: 'invalid_type' });
    expect(result.success).toBe(false);
  });
});

describe('AfricaGeoPointSchema', () => {
  it('accepts valid Africa coordinates', () => {
    const result = AfricaGeoPointSchema.safeParse({ latitude: 0, longitude: 30 });
    expect(result.success).toBe(true);
  });

  it('rejects latitude outside Africa bounds', () => {
    const result = AfricaGeoPointSchema.safeParse({ latitude: 50, longitude: 30 });
    expect(result.success).toBe(false);
  });

  it('rejects longitude outside Africa bounds', () => {
    const result = AfricaGeoPointSchema.safeParse({ latitude: 0, longitude: 60 });
    expect(result.success).toBe(false);
  });

  it('accepts boundary values', () => {
    expect(AfricaGeoPointSchema.safeParse({ latitude: -35, longitude: -25 }).success).toBe(true);
    expect(AfricaGeoPointSchema.safeParse({ latitude: 37, longitude: 55 }).success).toBe(true);
  });
});

describe('GeneralGeoPointSchema', () => {
  it('accepts valid world coordinates', () => {
    const result = GeneralGeoPointSchema.safeParse({ latitude: 45, longitude: -120 });
    expect(result.success).toBe(true);
  });

  it('rejects latitude outside -90..90', () => {
    const result = GeneralGeoPointSchema.safeParse({ latitude: 91, longitude: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects longitude outside -180..180', () => {
    const result = GeneralGeoPointSchema.safeParse({ latitude: 0, longitude: 181 });
    expect(result.success).toBe(false);
  });
});

describe('EnergyProfileSchema', () => {
  it('accepts valid energy profile with 1 entry', () => {
    const result = EnergyProfileSchema.safeParse([{ energyType: 'solar' }]);
    expect(result.success).toBe(true);
  });

  it('accepts valid profile with consumption', () => {
    const result = EnergyProfileSchema.safeParse([
      { energyType: 'diesel_generator', consumptionKwhYear: 5000 },
    ]);
    expect(result.success).toBe(true);
  });

  it('rejects empty array', () => {
    const result = EnergyProfileSchema.safeParse([]);
    expect(result.success).toBe(false);
  });

  it('rejects more than 10 entries', () => {
    const entries = Array.from({ length: 11 }, () => ({ energyType: 'solar' }));
    const result = EnergyProfileSchema.safeParse(entries);
    expect(result.success).toBe(false);
  });

  it('rejects consumption below 0.01', () => {
    const result = EnergyProfileSchema.safeParse([
      { energyType: 'solar', consumptionKwhYear: 0.001 },
    ]);
    expect(result.success).toBe(false);
  });

  it('rejects consumption above 999,999,999.99', () => {
    const result = EnergyProfileSchema.safeParse([
      { energyType: 'solar', consumptionKwhYear: 1_000_000_000 },
    ]);
    expect(result.success).toBe(false);
  });
});

describe('GhgEmissionsSchema', () => {
  it('accepts valid emissions data', () => {
    const result = GhgEmissionsSchema.safeParse({
      emissionScope: 'scope_1',
      valueTonnesCo2e: 150.5,
      reportingYear: 2023,
    });
    expect(result.success).toBe(true);
  });

  it('accepts zero emission value', () => {
    const result = GhgEmissionsSchema.safeParse({
      emissionScope: 'scope_2',
      valueTonnesCo2e: 0,
      reportingYear: 2020,
    });
    expect(result.success).toBe(true);
  });

  it('rejects reporting year before 2000', () => {
    const result = GhgEmissionsSchema.safeParse({
      emissionScope: 'scope_1',
      valueTonnesCo2e: 100,
      reportingYear: 1999,
    });
    expect(result.success).toBe(false);
  });

  it('rejects emission value exceeding max', () => {
    const result = GhgEmissionsSchema.safeParse({
      emissionScope: 'scope_1',
      valueTonnesCo2e: 1_000_000_000,
      reportingYear: 2023,
    });
    expect(result.success).toBe(false);
  });

  it('reports all errors simultaneously', () => {
    const result = GhgEmissionsSchema.safeParse({
      emissionScope: 'invalid',
      valueTonnesCo2e: -1,
      reportingYear: 1900,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(1);
    }
  });
});

describe('EmissionFactorSchema', () => {
  it('accepts a valid emission factor', () => {
    const result = EmissionFactorSchema.safeParse({
      country: 'Nigeria',
      energySourceType: 'grid_electricity',
      factorKgCo2ePerKwh: 0.52,
      referenceYear: 2022,
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-positive factor', () => {
    const result = EmissionFactorSchema.safeParse({
      country: 'Nigeria',
      energySourceType: 'grid_electricity',
      factorKgCo2ePerKwh: 0,
      referenceYear: 2022,
    });
    expect(result.success).toBe(false);
  });

  it('rejects factor exceeding 100', () => {
    const result = EmissionFactorSchema.safeParse({
      country: 'Nigeria',
      energySourceType: 'grid_electricity',
      factorKgCo2ePerKwh: 101,
      referenceYear: 2022,
    });
    expect(result.success).toBe(false);
  });

  it('rejects reference year before 1990', () => {
    const result = EmissionFactorSchema.safeParse({
      country: 'Nigeria',
      energySourceType: 'grid_electricity',
      factorKgCo2ePerKwh: 0.5,
      referenceYear: 1989,
    });
    expect(result.success).toBe(false);
  });
});

describe('SearchFiltersSchema', () => {
  it('accepts empty filters', () => {
    const result = SearchFiltersSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts valid filter combination', () => {
    const result = SearchFiltersSchema.safeParse({
      country: 'Kenya',
      facilityType: 'hospital',
      operationalStatus: 'operational',
      keyword: 'malaria',
    });
    expect(result.success).toBe(true);
  });

  it('rejects whitespace-only keyword', () => {
    const result = SearchFiltersSchema.safeParse({ keyword: '   ' });
    expect(result.success).toBe(false);
  });

  it('rejects keyword exceeding 200 characters', () => {
    const result = SearchFiltersSchema.safeParse({ keyword: 'a'.repeat(201) });
    expect(result.success).toBe(false);
  });

  it('rejects invalid facility type', () => {
    const result = SearchFiltersSchema.safeParse({ facilityType: 'invalid' });
    expect(result.success).toBe(false);
  });
});

describe('PaginationParamsSchema', () => {
  it('accepts valid pagination params', () => {
    const result = PaginationParamsSchema.safeParse({ page: 1, pageSize: 100 });
    expect(result.success).toBe(true);
  });

  it('rejects page < 1', () => {
    const result = PaginationParamsSchema.safeParse({ page: 0, pageSize: 100 });
    expect(result.success).toBe(false);
  });

  it('rejects pageSize < 1', () => {
    const result = PaginationParamsSchema.safeParse({ page: 1, pageSize: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects pageSize > 500', () => {
    const result = PaginationParamsSchema.safeParse({ page: 1, pageSize: 501 });
    expect(result.success).toBe(false);
  });

  it('accepts boundary values', () => {
    expect(PaginationParamsSchema.safeParse({ page: 1, pageSize: 1 }).success).toBe(true);
    expect(PaginationParamsSchema.safeParse({ page: 1, pageSize: 500 }).success).toBe(true);
  });
});

describe('ProximityQuerySchema', () => {
  it('accepts valid proximity query', () => {
    const result = ProximityQuerySchema.safeParse({ latitude: 0, longitude: 30, radiusKm: 50 });
    expect(result.success).toBe(true);
  });

  it('rejects radius < 0.1', () => {
    const result = ProximityQuerySchema.safeParse({ latitude: 0, longitude: 30, radiusKm: 0.05 });
    expect(result.success).toBe(false);
  });

  it('rejects radius > 1000', () => {
    const result = ProximityQuerySchema.safeParse({ latitude: 0, longitude: 30, radiusKm: 1001 });
    expect(result.success).toBe(false);
  });

  it('accepts boundary radius values', () => {
    expect(ProximityQuerySchema.safeParse({ latitude: 0, longitude: 0, radiusKm: 0.1 }).success).toBe(true);
    expect(ProximityQuerySchema.safeParse({ latitude: 0, longitude: 0, radiusKm: 1000 }).success).toBe(true);
  });
});

describe('BoundingBoxQuerySchema', () => {
  it('accepts valid bounding box', () => {
    const result = BoundingBoxQuerySchema.safeParse({
      swLatitude: -10,
      swLongitude: 20,
      neLatitude: 10,
      neLongitude: 40,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid coordinates', () => {
    const result = BoundingBoxQuerySchema.safeParse({
      swLatitude: -91,
      swLongitude: 20,
      neLatitude: 10,
      neLongitude: 40,
    });
    expect(result.success).toBe(false);
  });
});

describe('LocaleCodeSchema', () => {
  it('accepts valid 2-letter locale codes', () => {
    expect(LocaleCodeSchema.safeParse('en').success).toBe(true);
    expect(LocaleCodeSchema.safeParse('fr').success).toBe(true);
    expect(LocaleCodeSchema.safeParse('ar').success).toBe(true);
    expect(LocaleCodeSchema.safeParse('pt').success).toBe(true);
    expect(LocaleCodeSchema.safeParse('sw').success).toBe(true);
  });

  it('accepts locale with region code', () => {
    expect(LocaleCodeSchema.safeParse('pt-BR').success).toBe(true);
    expect(LocaleCodeSchema.safeParse('fr-FR').success).toBe(true);
  });

  it('rejects invalid locale formats', () => {
    expect(LocaleCodeSchema.safeParse('e').success).toBe(false);
    expect(LocaleCodeSchema.safeParse('english').success).toBe(false);
    expect(LocaleCodeSchema.safeParse('EN').success).toBe(false);
  });
});

describe('validateInput helper', () => {
  it('returns success with parsed data for valid input', () => {
    const result = validateInput(PaginationParamsSchema, { page: 1, pageSize: 50 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ page: 1, pageSize: 50 });
    }
  });

  it('returns all errors for invalid input', () => {
    const result = validateInput(PaginationParamsSchema, { page: 0, pageSize: 501 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBe(2);
    }
  });
});
