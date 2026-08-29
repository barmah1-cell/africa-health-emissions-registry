/**
 * Zod validation schemas for the Africa Health Facilities Registry.
 *
 * All schemas use safeParse() to collect all errors (not fail-fast).
 * String fields enforce a 500-character maximum.
 * Geolocation bounds are validated per context (Africa bounds for facility records,
 * general bounds for geospatial queries).
 */

import { z } from 'zod';
import { AFRICAN_COUNTRIES } from '../types/countries';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_STRING_LENGTH = 500;
const MAX_LOCALES = 20;
const MAX_ENERGY_ENTRIES = 10;
const MIN_ENERGY_ENTRIES = 1;
const MAX_BEDS = 50_000;
const MAX_KEYWORD_LENGTH = 200;
const MIN_KEYWORD_LENGTH = 1;
const MAX_PAGE_SIZE = 500;
const MAP_MARKERS_MIN_LIMIT = 1;
const MAP_MARKERS_MAX_LIMIT = 20_000;
const MAP_MARKERS_DEFAULT_LIMIT = 2_000;
const MIN_PAGE_SIZE = 1;
const MIN_RADIUS_KM = 0.1;
const MAX_RADIUS_KM = 1000;

// Africa geographic bounds
const AFRICA_LAT_MIN = -35;
const AFRICA_LAT_MAX = 37;
const AFRICA_LON_MIN = -25;
const AFRICA_LON_MAX = 55;

// General geographic bounds
const GEO_LAT_MIN = -90;
const GEO_LAT_MAX = 90;
const GEO_LON_MIN = -180;
const GEO_LON_MAX = 180;

// Energy/emissions ranges
const MIN_CONSUMPTION = 0.01;
const MAX_CONSUMPTION = 999_999_999.99;
const MIN_EMISSION_VALUE = 0;
const MAX_EMISSION_VALUE = 999_999_999.99;
const MIN_REPORTING_YEAR = 2000;
const MIN_EMISSION_FACTOR_YEAR = 1990;
const MAX_EMISSION_FACTOR_VALUE = 100;

// Current year (evaluated at module load time)
const CURRENT_YEAR = new Date().getFullYear();


// ---------------------------------------------------------------------------
// Enum Schemas
// ---------------------------------------------------------------------------

export const FacilityTypeSchema = z.enum([
  'hospital',
  'clinic',
  'health_post',
  'pharmacy',
  'laboratory',
  'community_health_center',
]);

export const OperationalStatusSchema = z.enum([
  'operational',
  'temporarily_closed',
  'permanently_closed',
  'under_construction',
]);

export const EnergyTypeSchema = z.enum([
  'diesel_generator',
  'solar',
  'wind',
  'grid_electricity',
  'hybrid',
]);

export const EmissionScopeSchema = z.enum([
  'scope_1',
  'scope_2',
  'scope_3',
]);

export const VerificationMethodSchema = z.enum([
  'field_verified',
  'self_reported',
  'imported_secondary',
  'unverified',
]);

export const OwnershipSchema = z.enum(['public', 'private']);

// ---------------------------------------------------------------------------
// Locale Schema
// ---------------------------------------------------------------------------

/**
 * Validates locale codes. Supports the base set (en, fr, ar, pt, sw) and
 * extensible 2-letter or BCP-47-like patterns (e.g., "en", "fr-FR", "pt-BR").
 */
export const LocaleCodeSchema = z
  .string()
  .min(2, 'Locale code must be at least 2 characters')
  .max(MAX_STRING_LENGTH, `Locale code must not exceed ${MAX_STRING_LENGTH} characters`)
  .regex(
    /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/,
    'Locale code must be a valid format (e.g., "en", "fr", "pt-BR")',
  );

// Base supported locales for reference
export const SUPPORTED_LOCALES = ['en', 'fr', 'ar', 'pt', 'sw'] as const;

// ---------------------------------------------------------------------------
// String helper
// ---------------------------------------------------------------------------

/** A bounded string field: max 500 chars by default */
const boundedString = (fieldName?: string) =>
  z
    .string()
    .max(
      MAX_STRING_LENGTH,
      fieldName
        ? `${fieldName} must not exceed ${MAX_STRING_LENGTH} characters`
        : `Must not exceed ${MAX_STRING_LENGTH} characters`,
    );

// ---------------------------------------------------------------------------
// GeoPoint Schemas
// ---------------------------------------------------------------------------

/** GeoPoint constrained to Africa bounds (for facility records) */
export const AfricaGeoPointSchema = z.object({
  latitude: z
    .number({ required_error: 'Latitude is required', invalid_type_error: 'Latitude must be a number' })
    .min(AFRICA_LAT_MIN, `Latitude must be >= ${AFRICA_LAT_MIN} (Africa bounds)`)
    .max(AFRICA_LAT_MAX, `Latitude must be <= ${AFRICA_LAT_MAX} (Africa bounds)`),
  longitude: z
    .number({ required_error: 'Longitude is required', invalid_type_error: 'Longitude must be a number' })
    .min(AFRICA_LON_MIN, `Longitude must be >= ${AFRICA_LON_MIN} (Africa bounds)`)
    .max(AFRICA_LON_MAX, `Longitude must be <= ${AFRICA_LON_MAX} (Africa bounds)`),
});

/** GeoPoint with general world bounds (for geospatial queries) */
export const GeneralGeoPointSchema = z.object({
  latitude: z
    .number({ required_error: 'Latitude is required', invalid_type_error: 'Latitude must be a number' })
    .min(GEO_LAT_MIN, `Latitude must be >= ${GEO_LAT_MIN}`)
    .max(GEO_LAT_MAX, `Latitude must be <= ${GEO_LAT_MAX}`),
  longitude: z
    .number({ required_error: 'Longitude is required', invalid_type_error: 'Longitude must be a number' })
    .min(GEO_LON_MIN, `Longitude must be >= ${GEO_LON_MIN}`)
    .max(GEO_LON_MAX, `Longitude must be <= ${GEO_LON_MAX}`),
});

// ---------------------------------------------------------------------------
// LocalizedText Schema
// ---------------------------------------------------------------------------

/**
 * Localized text: an object with locale keys and string values.
 * At least 1 entry required, max 20 locales, max 500 chars per value.
 * Keys must be valid locale codes.
 */
export const LocalizedTextSchema = z
  .record(
    LocaleCodeSchema,
    boundedString('Localized text value').min(1, 'Localized text value must not be empty'),
  )
  .refine(
    (obj) => Object.keys(obj).length >= 1,
    { message: 'At least one localized entry is required' },
  )
  .refine(
    (obj) => Object.keys(obj).length <= MAX_LOCALES,
    { message: `Maximum of ${MAX_LOCALES} locales allowed` },
  );

/** Optional localized text (can be empty or omitted) */
export const OptionalLocalizedTextSchema = z
  .record(
    LocaleCodeSchema,
    boundedString('Localized text value'),
  )
  .refine(
    (obj) => Object.keys(obj).length <= MAX_LOCALES,
    { message: `Maximum of ${MAX_LOCALES} locales allowed` },
  )
  .optional();

// ---------------------------------------------------------------------------
// ContactInfo Schema
// ---------------------------------------------------------------------------

export const ContactInfoSchema = z.object({
  phone: boundedString('Phone').optional(),
  email: boundedString('Email')
    .email('Must be a valid email address')
    .optional(),
  website: boundedString('Website')
    .url('Must be a valid URL')
    .optional(),
}).optional();


// ---------------------------------------------------------------------------
// EnergyProfile Schema
// ---------------------------------------------------------------------------

/** A single energy source entry */
export const EnergySourceEntrySchema = z.object({
  energyType: EnergyTypeSchema,
  consumptionKwhYear: z
    .number({ invalid_type_error: 'Consumption must be a number' })
    .min(MIN_CONSUMPTION, `Consumption must be >= ${MIN_CONSUMPTION} kWh/year`)
    .max(MAX_CONSUMPTION, `Consumption must be <= ${MAX_CONSUMPTION} kWh/year`)
    .optional(),
});

/** Energy profile: array of 1-10 energy source entries */
export const EnergyProfileSchema = z
  .array(EnergySourceEntrySchema)
  .min(MIN_ENERGY_ENTRIES, `Energy profile must have at least ${MIN_ENERGY_ENTRIES} entry`)
  .max(MAX_ENERGY_ENTRIES, `Energy profile must have at most ${MAX_ENERGY_ENTRIES} entries`);

// ---------------------------------------------------------------------------
// GhgEmissions Schema
// ---------------------------------------------------------------------------

export const GhgEmissionsSchema = z.object({
  emissionScope: EmissionScopeSchema,
  valueTonnesCo2e: z
    .number({ required_error: 'Emission value is required', invalid_type_error: 'Emission value must be a number' })
    .min(MIN_EMISSION_VALUE, `Emission value must be >= ${MIN_EMISSION_VALUE}`)
    .max(MAX_EMISSION_VALUE, `Emission value must be <= ${MAX_EMISSION_VALUE}`),
  reportingYear: z
    .number({ required_error: 'Reporting year is required', invalid_type_error: 'Reporting year must be a number' })
    .int('Reporting year must be an integer')
    .min(MIN_REPORTING_YEAR, `Reporting year must be >= ${MIN_REPORTING_YEAR}`)
    .max(CURRENT_YEAR, `Reporting year must be <= ${CURRENT_YEAR}`),
});

// ---------------------------------------------------------------------------
// EmissionFactor Schema
// ---------------------------------------------------------------------------

export const EmissionFactorSchema = z.object({
  country: boundedString('Country').refine(
    (val) => (AFRICAN_COUNTRIES as readonly string[]).includes(val),
    { message: 'Country must be a recognized African nation' },
  ),
  energySourceType: EnergyTypeSchema,
  factorKgCo2ePerKwh: z
    .number({ required_error: 'Factor value is required', invalid_type_error: 'Factor must be a number' })
    .positive('Factor must be a positive value')
    .max(MAX_EMISSION_FACTOR_VALUE, `Factor must be <= ${MAX_EMISSION_FACTOR_VALUE} kg CO2e/kWh`),
  referenceYear: z
    .number({ required_error: 'Reference year is required', invalid_type_error: 'Reference year must be a number' })
    .int('Reference year must be an integer')
    .min(MIN_EMISSION_FACTOR_YEAR, `Reference year must be >= ${MIN_EMISSION_FACTOR_YEAR}`)
    .max(CURRENT_YEAR, `Reference year must be <= ${CURRENT_YEAR}`),
});

// ---------------------------------------------------------------------------
// CreateFacilityInput Schema
// ---------------------------------------------------------------------------

export const CreateFacilityInputSchema = z.object({
  /** Names in at least 1 locale, max 20 */
  names: LocalizedTextSchema,
  /** Physical addresses (optional, multilingual) */
  addresses: OptionalLocalizedTextSchema,
  /** Facility classification */
  facilityType: FacilityTypeSchema,
  /** Must be a recognized African nation */
  country: boundedString('Country').refine(
    (val) => (AFRICAN_COUNTRIES as readonly string[]).includes(val),
    { message: 'Country must be a recognized African nation' },
  ),
  /** Administrative region */
  adminRegion: boundedString('Admin region').min(1, 'Admin region is required'),
  /** City or town (optional) */
  city: boundedString('City').optional(),
  /** Geolocation within Africa bounds */
  geolocation: AfricaGeoPointSchema,
  /** Current operational status */
  operationalStatus: OperationalStatusSchema,
  /** Ownership type */
  ownership: OwnershipSchema,
  /** Contact information (optional) */
  contactInfo: ContactInfoSchema,
  /** Number of beds (optional, 0-50000 integer) */
  beds: z
    .number({ invalid_type_error: 'Beds must be a number' })
    .int('Beds must be an integer')
    .min(0, 'Beds must be >= 0')
    .max(MAX_BEDS, `Beds must be <= ${MAX_BEDS}`)
    .optional(),
  /** Energy profile (optional, 1-10 entries) */
  energyProfile: EnergyProfileSchema.optional(),
  /** Verification status (optional, defaults to 'unverified') */
  verificationStatus: VerificationMethodSchema.optional(),
  /** Default locale (optional) */
  defaultLocale: LocaleCodeSchema.optional(),
});

// ---------------------------------------------------------------------------
// UpdateFacilityInput Schema (partial - all fields optional)
// ---------------------------------------------------------------------------

export const UpdateFacilityInputSchema = z.object({
  names: LocalizedTextSchema.optional(),
  addresses: OptionalLocalizedTextSchema,
  facilityType: FacilityTypeSchema.optional(),
  country: boundedString('Country')
    .refine(
      (val) => (AFRICAN_COUNTRIES as readonly string[]).includes(val),
      { message: 'Country must be a recognized African nation' },
    )
    .optional(),
  adminRegion: boundedString('Admin region').min(1, 'Admin region must not be empty').optional(),
  city: boundedString('City').optional(),
  geolocation: AfricaGeoPointSchema.optional(),
  operationalStatus: OperationalStatusSchema.optional(),
  ownership: OwnershipSchema.optional(),
  contactInfo: ContactInfoSchema,
  beds: z
    .number({ invalid_type_error: 'Beds must be a number' })
    .int('Beds must be an integer')
    .min(0, 'Beds must be >= 0')
    .max(MAX_BEDS, `Beds must be <= ${MAX_BEDS}`)
    .optional(),
  energyProfile: EnergyProfileSchema.optional(),
  verificationStatus: VerificationMethodSchema.optional(),
  defaultLocale: LocaleCodeSchema.optional(),
});


// ---------------------------------------------------------------------------
// SearchFilters Schema
// ---------------------------------------------------------------------------

export const SearchFiltersSchema = z.object({
  country: boundedString('Country')
    .refine(
      (val) => (AFRICAN_COUNTRIES as readonly string[]).includes(val),
      { message: 'Country must be a recognized African nation' },
    )
    .optional(),
  facilityType: FacilityTypeSchema.optional(),
  operationalStatus: OperationalStatusSchema.optional(),
  energySource: EnergyTypeSchema.optional(),
  verificationStatus: VerificationMethodSchema.optional(),
  /** Keyword search: 1-200 chars, must not be whitespace-only */
  keyword: z
    .string()
    .min(MIN_KEYWORD_LENGTH, `Keyword must be at least ${MIN_KEYWORD_LENGTH} character`)
    .max(MAX_KEYWORD_LENGTH, `Keyword must not exceed ${MAX_KEYWORD_LENGTH} characters`)
    .refine(
      (val) => val.trim().length > 0,
      { message: 'Keyword must not be whitespace-only' },
    )
    .optional(),
});

// ---------------------------------------------------------------------------
// PaginationParams Schema
// ---------------------------------------------------------------------------

export const PaginationParamsSchema = z.object({
  page: z
    .number({ required_error: 'Page is required', invalid_type_error: 'Page must be a number' })
    .int('Page must be an integer')
    .min(1, 'Page must be >= 1'),
  pageSize: z
    .number({ required_error: 'Page size is required', invalid_type_error: 'Page size must be a number' })
    .int('Page size must be an integer')
    .min(MIN_PAGE_SIZE, `Page size must be >= ${MIN_PAGE_SIZE}`)
    .max(MAX_PAGE_SIZE, `Page size must be <= ${MAX_PAGE_SIZE}`),
});

// ---------------------------------------------------------------------------
// Geospatial Query Schemas
// ---------------------------------------------------------------------------

/** Proximity search: a center point and radius in kilometers */
export const ProximityQuerySchema = z.object({
  latitude: z
    .number({ required_error: 'Latitude is required', invalid_type_error: 'Latitude must be a number' })
    .min(GEO_LAT_MIN, `Latitude must be >= ${GEO_LAT_MIN}`)
    .max(GEO_LAT_MAX, `Latitude must be <= ${GEO_LAT_MAX}`),
  longitude: z
    .number({ required_error: 'Longitude is required', invalid_type_error: 'Longitude must be a number' })
    .min(GEO_LON_MIN, `Longitude must be >= ${GEO_LON_MIN}`)
    .max(GEO_LON_MAX, `Longitude must be <= ${GEO_LON_MAX}`),
  radiusKm: z
    .number({ required_error: 'Radius is required', invalid_type_error: 'Radius must be a number' })
    .min(MIN_RADIUS_KM, `Radius must be >= ${MIN_RADIUS_KM} km`)
    .max(MAX_RADIUS_KM, `Radius must be <= ${MAX_RADIUS_KM} km`),
});

/** Bounding box search: southwest and northeast corners */
export const BoundingBoxQuerySchema = z.object({
  swLatitude: z
    .number({ required_error: 'SW latitude is required', invalid_type_error: 'SW latitude must be a number' })
    .min(GEO_LAT_MIN, `SW latitude must be >= ${GEO_LAT_MIN}`)
    .max(GEO_LAT_MAX, `SW latitude must be <= ${GEO_LAT_MAX}`),
  swLongitude: z
    .number({ required_error: 'SW longitude is required', invalid_type_error: 'SW longitude must be a number' })
    .min(GEO_LON_MIN, `SW longitude must be >= ${GEO_LON_MIN}`)
    .max(GEO_LON_MAX, `SW longitude must be <= ${GEO_LON_MAX}`),
  neLatitude: z
    .number({ required_error: 'NE latitude is required', invalid_type_error: 'NE latitude must be a number' })
    .min(GEO_LAT_MIN, `NE latitude must be >= ${GEO_LAT_MIN}`)
    .max(GEO_LAT_MAX, `NE latitude must be <= ${GEO_LAT_MAX}`),
  neLongitude: z
    .number({ required_error: 'NE longitude is required', invalid_type_error: 'NE longitude must be a number' })
    .min(GEO_LON_MIN, `NE longitude must be >= ${GEO_LON_MIN}`)
    .max(GEO_LON_MAX, `NE longitude must be <= ${GEO_LON_MAX}`),
});

// ---------------------------------------------------------------------------
// Map Markers Query Schema
// ---------------------------------------------------------------------------

/**
 * Query params for the slim map endpoint (`GET /api/v1/facilities/map`).
 *
 * Bounding box corners are all-or-nothing: either all four corners are supplied
 * (viewport mode) or none (global mode); supplying 1-3 corners is a validation
 * error. Attribute filters (country, facilityType, operationalStatus) are
 * independent and optional. Reuses the general world geo bounds (same as
 * BoundingBoxQuerySchema) and the African-nation country refinement from
 * SearchFiltersSchema. Validated via safeParse for aggregated (non-fail-fast)
 * error reporting.
 */
export const MapMarkersQuerySchema = z
  .object({
    swLatitude: z
      .number({ invalid_type_error: 'SW latitude must be a number' })
      .min(GEO_LAT_MIN, `SW latitude must be >= ${GEO_LAT_MIN}`)
      .max(GEO_LAT_MAX, `SW latitude must be <= ${GEO_LAT_MAX}`)
      .optional(),
    swLongitude: z
      .number({ invalid_type_error: 'SW longitude must be a number' })
      .min(GEO_LON_MIN, `SW longitude must be >= ${GEO_LON_MIN}`)
      .max(GEO_LON_MAX, `SW longitude must be <= ${GEO_LON_MAX}`)
      .optional(),
    neLatitude: z
      .number({ invalid_type_error: 'NE latitude must be a number' })
      .min(GEO_LAT_MIN, `NE latitude must be >= ${GEO_LAT_MIN}`)
      .max(GEO_LAT_MAX, `NE latitude must be <= ${GEO_LAT_MAX}`)
      .optional(),
    neLongitude: z
      .number({ invalid_type_error: 'NE longitude must be a number' })
      .min(GEO_LON_MIN, `NE longitude must be >= ${GEO_LON_MIN}`)
      .max(GEO_LON_MAX, `NE longitude must be <= ${GEO_LON_MAX}`)
      .optional(),
    country: boundedString('Country')
      .refine(
        (val) => (AFRICAN_COUNTRIES as readonly string[]).includes(val),
        { message: 'Country must be a recognized African nation' },
      )
      .optional(),
    facilityType: FacilityTypeSchema.optional(),
    operationalStatus: OperationalStatusSchema.optional(),
    limit: z
      .number({ invalid_type_error: 'Limit must be a number' })
      .int('Limit must be an integer')
      .min(MAP_MARKERS_MIN_LIMIT, `Limit must be >= ${MAP_MARKERS_MIN_LIMIT}`)
      .max(MAP_MARKERS_MAX_LIMIT, `Limit must be <= ${MAP_MARKERS_MAX_LIMIT}`)
      .optional(),
  })
  .refine(
    (q) => {
      const corners = [q.swLatitude, q.swLongitude, q.neLatitude, q.neLongitude];
      const provided = corners.filter((c) => c !== undefined).length;
      return provided === 0 || provided === 4;
    },
    {
      message:
        'Bounding box requires all four corners (sw_lat, sw_lon, ne_lat, ne_lon) or none',
    },
  );

// ---------------------------------------------------------------------------
// Inferred Types
// ---------------------------------------------------------------------------

export type CreateFacilityInput = z.infer<typeof CreateFacilityInputSchema>;
export type UpdateFacilityInput = z.infer<typeof UpdateFacilityInputSchema>;
export type AfricaGeoPoint = z.infer<typeof AfricaGeoPointSchema>;
export type GeneralGeoPoint = z.infer<typeof GeneralGeoPointSchema>;
export type EnergyProfileInput = z.infer<typeof EnergyProfileSchema>;
export type EnergySourceEntryInput = z.infer<typeof EnergySourceEntrySchema>;
export type GhgEmissionsInput = z.infer<typeof GhgEmissionsSchema>;
export type EmissionFactorInput = z.infer<typeof EmissionFactorSchema>;
export type SearchFiltersInput = z.infer<typeof SearchFiltersSchema>;
export type PaginationParamsInput = z.infer<typeof PaginationParamsSchema>;
export type ProximityQueryInput = z.infer<typeof ProximityQuerySchema>;
export type BoundingBoxQueryInput = z.infer<typeof BoundingBoxQuerySchema>;
export type MapMarkersQueryInput = z.infer<typeof MapMarkersQuerySchema>;

/** Default marker cap applied when the `limit` param is omitted. */
export const MAP_MARKERS_DEFAULT_CAP = MAP_MARKERS_DEFAULT_LIMIT;

// ---------------------------------------------------------------------------
// Helper: safeParse wrapper for consistent usage
// ---------------------------------------------------------------------------

/**
 * Validates input against a Zod schema using safeParse (collects all errors).
 * Returns the parsed result or an array of error messages.
 */
export function validateInput<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
): { success: true; data: T } | { success: false; errors: Array<{ path: string; message: string }> } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors = result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
  return { success: false, errors };
}
