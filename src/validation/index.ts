/**
 * Barrel export for validation schemas and inferred types.
 */

// Enum schemas
export {
  FacilityTypeSchema,
  OperationalStatusSchema,
  EnergyTypeSchema,
  EmissionScopeSchema,
  VerificationMethodSchema,
  OwnershipSchema,
} from './schemas';

// Locale
export { LocaleCodeSchema, SUPPORTED_LOCALES } from './schemas';

// GeoPoint schemas
export { AfricaGeoPointSchema, GeneralGeoPointSchema } from './schemas';

// Localized text
export { LocalizedTextSchema, OptionalLocalizedTextSchema } from './schemas';

// Contact info
export { ContactInfoSchema } from './schemas';

// Energy & Emissions
export {
  EnergySourceEntrySchema,
  EnergyProfileSchema,
  GhgEmissionsSchema,
  EmissionFactorSchema,
} from './schemas';

// Facility input schemas
export { CreateFacilityInputSchema, UpdateFacilityInputSchema } from './schemas';

// Search & Pagination
export { SearchFiltersSchema, PaginationParamsSchema } from './schemas';

// Geospatial queries
export { ProximityQuerySchema, BoundingBoxQuerySchema } from './schemas';

// Helper
export { validateInput } from './schemas';

// Inferred types
export type {
  CreateFacilityInput,
  UpdateFacilityInput,
  AfricaGeoPoint,
  GeneralGeoPoint,
  EnergyProfileInput,
  EnergySourceEntryInput,
  GhgEmissionsInput,
  EmissionFactorInput,
  SearchFiltersInput,
  PaginationParamsInput,
  ProximityQueryInput,
  BoundingBoxQueryInput,
} from './schemas';
