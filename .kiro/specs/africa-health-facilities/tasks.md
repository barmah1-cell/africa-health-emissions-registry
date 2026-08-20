# Implementation Plan: Africa Health Facilities Registry

## Overview

This plan implements a RESTful API for a comprehensive health facilities registry across Africa. The system uses Node.js 20 + TypeScript, Express.js, PostgreSQL 16 + PostGIS, Prisma ORM, Zod validation, JWT authentication, and Vitest + fast-check for testing. Tasks are ordered to build foundational layers first, then layer on features incrementally.

## Tasks

- [x] 1. Set up project structure, dependencies, and database schema
  - [x] 1.1 Initialize Node.js project with TypeScript configuration
    - Create project directory structure matching the design (src/, tests/, prisma/)
    - Initialize package.json with dependencies: express, prisma, @prisma/client, zod, jsonwebtoken, papaparse, fast-check, vitest, supertest
    - Configure tsconfig.json with strict mode, ES2022 target
    - Set up Vitest configuration
    - _Requirements: All_

  - [x] 1.2 Define Prisma schema and database migrations
    - Create Prisma schema with all models: Facility, EnergySource, GhgEmission, EmissionFactor, AuditEntry, User
    - Enable PostGIS extension in migration
    - Define JSONB columns for names, addresses, contact_info
    - Add geography(Point, 4326) column for geolocation
    - Create all indexes: GIST spatial, GIN jsonb, B-tree composite, unique constraints
    - Add unique constraint on (facility name text, country, geolocation) for duplicate detection
    - Add unique constraint on (facility_id, emission_scope, reporting_year) for GHG emissions
    - Add unique constraint on (country, energy_source_type, reference_year) for emission factors
    - _Requirements: 1.2, 1.4, 10.1, 10.3, 11.1, 14.1, 14.6_

  - [x] 1.3 Define core TypeScript types and enums
    - Create types for FacilityRecord, EnergySourceEntry, GhgEmission, EmissionFactor, AuditEntry
    - Define enums: FacilityType, OperationalStatus, EnergyType, EmissionScope, VerificationMethod, UserRole
    - Define interfaces: GeoPoint, LocalizedText, ContactInfo, PaginationParams, PaginationMeta, PaginatedResult, ImportReport, EmissionEstimate
    - Define API error types: ErrorResponse with code, message, details
    - Create list of 54 recognized African nations
    - _Requirements: 1.2, 15.1, 15.3, 15.4, 15.5, 15.6_

  - [x] 1.4 Create Zod validation schemas
    - Create schema for CreateFacilityInput with all required/optional fields
    - Create schema for UpdateFacilityInput (partial, all fields optional)
    - Create schema for GeoPoint validation (Africa bounds: lat -35..37, lon -25..55; general bounds: lat -90..90, lon -180..180)
    - Create schema for EnergyProfile (1-10 entries, consumption range 0.01-999,999,999.99)
    - Create schema for GhgEmissions (scope, value 0-999,999,999.99, year 2000-current)
    - Create schema for EmissionFactor (positive, <= 100 kg CO2e/kWh, year 1990-current)
    - Create schema for SearchFilters (country, facility_type, operational_status, keyword 1-200 chars)
    - Create schema for PaginationParams (page >= 1, pageSize 1-500)
    - Create schema for geospatial queries (radius 0.1-1000km, bounding box)
    - Enforce 500-character max for all string fields
    - Validate locale codes against supported set
    - Ensure all schemas report all errors (not fail-fast) using Zod safeParse
    - _Requirements: 1.3, 5.7, 5.8, 6.3, 6.4, 9.4, 10.5, 10.6, 10.9, 14.2, 15.1-15.10_

- [x] 2. Implement authentication, authorization, and rate limiting middleware
  - [x] 2.1 Implement JWT authentication middleware
    - Create authenticate middleware that validates JWT tokens on write endpoints
    - Create optionalAuth middleware for read endpoints (attaches user if present, passes through otherwise)
    - Return 401 AUTHENTICATION_REQUIRED for missing/invalid/expired tokens
    - Extract user ID and role from JWT claims and attach to request
    - _Requirements: 16.1, 16.2, 16.3, 16.4_

  - [x] 2.2 Implement role-based authorization middleware
    - Create requireAdmin middleware that checks user role is 'admin'
    - Return 403 INSUFFICIENT_PRIVILEGES for non-admin users attempting admin operations
    - Apply to DELETE facility, POST import, emission factor CRUD, audit history endpoints
    - _Requirements: 4.3, 4.4, 16.5_

  - [x] 2.3 Implement rate limiter for failed auth attempts
    - Track failed authentication attempts per source IP
    - Block source for 300 seconds after 10+ consecutive failures within 60 seconds
    - Return 429 RATE_LIMITED with remaining block time
    - Reset counter on successful authentication
    - _Requirements: 16.6_

  - [x]* 2.4 Write property tests for authentication and authorization
    - **Property 29: Authentication Enforcement for Writes**
    - **Property 30: Unauthenticated Read Access**
    - **Property 31: Role-Based Authorization**
    - **Property 32: Rate Limiting**
    - **Validates: Requirements 4.3, 4.4, 16.1-16.6**

- [x] 3. Implement facility CRUD operations
  - [x] 3.1 Implement facility creation (POST /api/v1/facilities)
    - Validate input using Zod schema (return all validation errors)
    - Check uniqueness constraint (name + country + geolocation)
    - Store multilingual names/addresses as JSONB
    - Set default verification_status to 'unverified'
    - Mark energy_profile as 'unknown' if not provided
    - Determine default_locale (user-specified or first provided)
    - Create audit entry for the create operation
    - Return created facility with unique ID within 2 seconds
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 12.3, 13.1_

  - [x] 3.2 Implement facility retrieval (GET /api/v1/facilities/:id)
    - Validate ID format (UUID)
    - Return complete facility record with all attributes, multilingual data, energy profile, verification status
    - Compute stale indicator (verification_date > 24 months or status is 'unverified' with no date)
    - Compute energy stale indicator independently
    - Handle locale preference (prefer requested locale, fallback to default)
    - Return 404 NOT_FOUND for non-existent records
    - Return 400 INVALID_FORMAT for malformed IDs
    - Exclude soft-deleted records
    - _Requirements: 2.1, 2.2, 2.4, 12.5, 13.5, 13.6, 13.7_

  - [x] 3.3 Implement facility update (PATCH /api/v1/facilities/:id)
    - Support partial updates (only submitted fields are changed)
    - Validate updated fields using Zod schema
    - Check uniqueness if name/country/geolocation are being updated
    - Preserve non-updated fields
    - Create audit entry recording old and new values for changed fields
    - Return complete updated record
    - Return 404 if facility doesn't exist
    - Return 400 for invalid field values
    - Return 409 DUPLICATE_RECORD if update would cause duplicate
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 3.4 Implement facility deletion (DELETE /api/v1/facilities/:id)
    - Require Admin role
    - Soft-delete by setting deleted_at timestamp
    - Create audit entry for deletion (new values are null)
    - Return confirmation with deleted facility ID
    - Return 404 if facility doesn't exist
    - Preserve all audit entries for the deleted record
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 11.5_

  - [x]* 3.5 Write property tests for facility CRUD
    - **Property 1: Facility Record Round-Trip Preservation**
    - **Property 2: Required Field Rejection Completeness**
    - **Property 3: Uniqueness Constraint Enforcement**
    - **Property 4: Partial Update Preservation**
    - **Property 5: Soft-Delete Exclusion**
    - **Validates: Requirements 1.1-1.5, 2.1, 2.2, 3.1-3.4, 4.1, 11.5**

- [x] 4. Implement search, filter, and pagination
  - [x] 4.1 Implement search and filter endpoint (GET /api/v1/facilities)
    - Accept query params: country, facility_type, operational_status, energy_source, verification_status, keyword
    - Apply AND logic for multiple filters
    - Perform case-insensitive partial match on names/addresses across all locales for keyword
    - Reject whitespace-only keywords with validation error
    - Validate filter values against allowed sets
    - Order results by facility name ascending (default locale)
    - Exclude soft-deleted records from results
    - Return empty collection with count of zero for no matches
    - _Requirements: 5.1-5.9, 10.7, 10.8, 13.4_

  - [x] 4.2 Implement pagination logic
    - Default page size 100 when not specified
    - Accept page (min 1) and pageSize (min 1, max 500) parameters
    - Sort by unique identifier in ascending order for pagination consistency
    - Return pagination metadata: totalCount, currentPage, totalPages, pageSize
    - Return empty collection for page exceeding total pages
    - Return all records with single-page metadata for <= 100 results without pagination params
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 4.3 Implement country-based listing (GET /api/v1/facilities?country=X)
    - Return all facilities for given country ordered by name ascending
    - Validate country is a recognized African nation
    - Return empty collection if no matches
    - _Requirements: 2.3, 2.5_

  - [x]* 4.4 Write property tests for search and pagination
    - **Property 6: Search Filter AND Logic**
    - **Property 7: Keyword Search Cross-Locale Matching**
    - **Property 8: Search Result Ordering**
    - **Property 14: Pagination Subset Correctness**
    - **Property 15: Pagination Parameter Validation**
    - **Property 33: Whitespace Keyword Rejection**
    - **Validates: Requirements 5.1-5.9, 9.1-9.5, 10.7, 12.4, 13.4**

- [x] 5. Implement geospatial queries
  - [x] 5.1 Implement proximity search (GET /api/v1/facilities/nearby)
    - Accept latitude, longitude, radius (0.1-1000 km) parameters
    - Use PostGIS ST_DWithin for radius filtering
    - Order results by distance (nearest to farthest)
    - Validate coordinates (lat -90..90, lon -180..180)
    - Validate radius range (0.1-1000 km)
    - Return empty collection for no matches
    - Apply pagination to results
    - _Requirements: 6.1, 6.3, 6.4, 6.5_

  - [x] 5.2 Implement bounding box search (GET /api/v1/facilities/bbox)
    - Accept sw_lat, sw_lon, ne_lat, ne_lon parameters
    - Use PostGIS ST_MakeEnvelope for bounding box filtering
    - Validate all coordinates
    - Return empty collection for no matches
    - Apply pagination to results
    - _Requirements: 6.2, 6.3, 6.5_

  - [x]* 5.3 Write property tests for geospatial queries
    - **Property 9: Geospatial Proximity Correctness**
    - **Property 10: Bounding Box Containment**
    - **Property 11: Geolocation Validation**
    - **Validates: Requirements 6.1-6.5**

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement energy profiles and GHG emissions
  - [x] 7.1 Implement energy profile management (PUT /api/v1/facilities/:id/energy-profile)
    - Accept 1-10 energy source entries per facility
    - Each entry requires energy_type; consumption_kwh_year is optional (0.01-999,999,999.99)
    - Mark energy_profile as 'unknown' when no data provided
    - Update energy_verification_date on profile changes
    - Validate energy_type against allowed set
    - _Requirements: 10.1, 10.2, 10.4, 10.5_

  - [x] 7.2 Implement GHG emissions recording (POST /api/v1/facilities/:id/emissions)
    - Validate emission_scope, value (0-999,999,999.99 tonnes CO2e), reporting_year (2000-current)
    - Enforce uniqueness per facility + scope + year combination
    - Return all validation errors for invalid submissions
    - _Requirements: 10.3, 10.6, 10.9_

  - [x] 7.3 Implement emission estimation (GET /api/v1/facilities/:id/emissions/estimate)
    - Look up facility energy consumption data
    - Find matching emission factor by country + energy_source_type + most recent year <= reporting year
    - Calculate: (consumption_kwh × factor_kg_co2e_per_kwh) / 1000 = tonnes CO2e
    - Return ESTIMATION_UNAVAILABLE if no matching emission factor exists
    - _Requirements: 14.4, 14.5_

  - [x]* 7.4 Write property tests for energy and emissions
    - **Property 16: Energy Profile Storage**
    - **Property 17: GHG Emissions Uniqueness**
    - **Property 18: GHG Emissions Validation**
    - **Validates: Requirements 10.1, 10.3, 10.5, 10.6, 10.9**

- [x] 8. Implement emission factor management
  - [x] 8.1 Implement emission factor CRUD (POST/PUT/DELETE /api/v1/emission-factors)
    - Require Admin role for all operations
    - Validate: country (African nation), energy_source_type, factor (positive, <= 100), reference_year (1990-current)
    - Support multiple entries per country (versioned by reference_year)
    - Enforce unique constraint on (country, energy_source_type, reference_year)
    - Return validation errors for invalid submissions
    - _Requirements: 14.1, 14.2, 14.3, 14.6, 14.7_

  - [x] 8.2 Implement emission factor listing and lookup (GET /api/v1/emission-factors)
    - Allow filtering by country and energy_source_type
    - Support temporal lookup (find most recent factor not exceeding a given year)
    - _Requirements: 14.4, 14.6_

  - [x]* 8.3 Write property tests for emission factors
    - **Property 24: Emission Factor Temporal Lookup**
    - **Validates: Requirements 14.4, 14.6**

- [x] 9. Implement audit trail
  - [x] 9.1 Implement audit service
    - Create append-only audit entries on every create, update, delete operation
    - Record: user_id, timestamp, operation_type, changes (old/new values per field)
    - For creates: old values are null
    - For deletes: new values are null
    - Prevent modification or deletion of audit entries
    - Retain audit entries for deleted facilities
    - _Requirements: 11.1, 11.3, 11.4, 11.5_

  - [x] 9.2 Implement audit history retrieval (GET /api/v1/facilities/:id/audit)
    - Require Admin role
    - Return chronological list of audit entries (oldest to newest)
    - Support retrieval by original facility ID even for deleted facilities
    - _Requirements: 11.2, 11.5, 11.6_

  - [x]* 9.3 Write property tests for audit trail
    - **Property 19: Audit Entry Completeness**
    - **Property 20: Audit History Chronological Order**
    - **Validates: Requirements 11.1, 11.2, 11.3**

- [x] 10. Implement multi-language support
  - [x] 10.1 Implement multilingual storage and retrieval
    - Store names/addresses as JSONB with locale keys (up to 20 locales per record)
    - Determine default locale: user-specified or first provided
    - Validate at least one name in a supported locale is provided
    - Support keyword search across all stored locales (GIN index on JSONB)
    - Implement locale preference: return preferred locale data or fallback to default
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [x]* 10.2 Write property tests for multi-language support
    - **Property 21: Multi-Locale Storage and Default Selection**
    - **Property 22: Locale Preference Fallback**
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.5**

- [x] 11. Implement data verification and staleness
  - [x] 11.1 Implement verification status tracking
    - Store verification_status (field-verified, self-reported, imported_secondary, unverified) per facility
    - Store verification_date per facility
    - Store separate energy_verification_status and energy_verification_date
    - Default to 'unverified' on creation
    - Update verification_status and date when user marks data as verified
    - Compute stale indicator: true if verification_date > 24 months ago OR status is 'unverified' with no date
    - Apply staleness logic independently to energy profile verification
    - Support filtering by verification_status in search
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7_

  - [x]* 11.2 Write property tests for verification staleness
    - **Property 23: Verification Staleness Indicator**
    - **Validates: Requirements 13.5, 13.6, 13.7**

- [x] 12. Implement bulk import and data export
  - [x] 12.1 Implement CSV bulk import (POST /api/v1/facilities/import)
    - Require Admin role
    - Parse CSV using Papa Parse (RFC 4180 compliant, streaming)
    - Validate header row matches expected attribute names
    - Reject invalid files: malformed CSV, unreadable encoding, empty files
    - Reject files exceeding 10,000 rows or 10 MB
    - Process each row: validate, check duplicates, store valid records
    - Skip invalid rows and duplicate rows (don't abort entire import)
    - Return import report: total rows, imported count, skipped_validation count, skipped_duplicate count, error details per skipped row
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 12.2 Implement CSV export (GET /api/v1/facilities/export)
    - Generate UTF-8 encoded, RFC 4180 compliant CSV
    - Include header row with column names matching facility attributes
    - Apply search filters to limit exported records
    - Reject requests matching > 50,000 records (return error with total count)
    - Return header-only CSV for zero matching records
    - Maximum 50,000 records per export
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x]* 12.3 Write property tests for import/export
    - **Property 12: CSV Import Summary Accuracy**
    - **Property 13: CSV Export Round-Trip**
    - **Validates: Requirements 7.1, 7.2, 7.3, 8.1, 8.2, 8.3**

- [x] 13. Implement input validation layer
  - [x] 13.1 Implement comprehensive validation middleware
    - Validate country against 54 African nations list
    - Validate geolocation within Africa bounds (lat -35..37, lon -25..55)
    - Validate all enum fields against predefined sets
    - Validate locale codes against supported set
    - Enforce 500-character max on all string fields
    - Aggregate all validation errors into single response (not fail-fast)
    - Wire validation middleware into all routes
    - _Requirements: 15.1-15.10_

  - [x]* 13.2 Write property tests for validation
    - **Property 25: Enum Validation Completeness**
    - **Property 26: Africa Geolocation Bounds Validation**
    - **Property 27: Field Length Validation**
    - **Property 28: Aggregate Validation Error Reporting**
    - **Validates: Requirements 15.1-15.10**

- [x] 14. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Wire Express application and routes
  - [x] 15.1 Create Express app with middleware stack
    - Set up Express application with JSON body parser
    - Wire auth middleware (optional for reads, required for writes)
    - Wire validation middleware using Zod schemas
    - Wire rate limiter middleware
    - Set up error handling middleware for consistent error responses
    - Configure CORS if needed
    - _Requirements: 16.1-16.6_

  - [x] 15.2 Define all API routes and wire to services
    - Create router for facility CRUD: POST, GET /:id, PATCH /:id, DELETE /:id
    - Create router for search: GET /facilities with query params
    - Create router for geospatial: GET /facilities/nearby, GET /facilities/bbox
    - Create router for bulk: POST /facilities/import, GET /facilities/export
    - Create router for energy/emissions: PUT /:id/energy-profile, POST /:id/emissions, GET /:id/emissions/estimate
    - Create router for emission factors: POST, PUT /:id, DELETE /:id, GET
    - Create router for audit: GET /:id/audit
    - Wire Admin-only routes with requireAdmin middleware
    - _Requirements: All_

  - [x] 15.3 Implement consistent error response formatting
    - Create error handler middleware
    - Map Zod validation errors to VALIDATION_ERROR format with field details
    - Map Prisma unique constraint errors to DUPLICATE_RECORD
    - Map authentication failures to AUTHENTICATION_REQUIRED
    - Map authorization failures to INSUFFICIENT_PRIVILEGES
    - Ensure no internal details leak in error responses
    - _Requirements: 1.3, 3.3, 15.10_

- [x] 16. Integration testing and final wiring
  - [x]* 16.1 Write integration tests for facility API
    - Test full HTTP request cycle for create, retrieve, update, delete
    - Test authentication and authorization flows
    - Test error responses and status codes
    - _Requirements: 1.1-1.5, 2.1-2.5, 3.1-3.4, 4.1-4.4_

  - [x]* 16.2 Write integration tests for search, geospatial, and export APIs
    - Test search with various filter combinations
    - Test geospatial proximity and bounding box queries
    - Test CSV export with filters
    - Test pagination across endpoints
    - _Requirements: 5.1-5.9, 6.1-6.5, 8.1-8.5, 9.1-9.5_

  - [x]* 16.3 Write integration tests for import, energy, emissions, and audit APIs
    - Test bulk CSV import with valid/invalid/duplicate rows
    - Test energy profile updates and GHG emissions recording
    - Test emission estimation
    - Test audit history retrieval
    - _Requirements: 7.1-7.6, 10.1-10.9, 11.1-11.6, 14.1-14.7_

- [x] 17. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The audit service is integrated into CRUD operations (task 3) but its own endpoint and tests are in task 9
- Multi-language support (task 10) is architecturally part of facility storage (JSONB columns created in task 1.2) but the retrieval/search logic is implemented separately
- PostGIS spatial functions (ST_DWithin, ST_MakeEnvelope) handle geospatial queries natively

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4", "2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3"] },
    { "id": 4, "tasks": ["2.4", "3.1"] },
    { "id": 5, "tasks": ["3.2", "3.3", "3.4", "9.1"] },
    { "id": 6, "tasks": ["3.5", "4.1", "10.1"] },
    { "id": 7, "tasks": ["4.2", "4.3", "5.1", "5.2"] },
    { "id": 8, "tasks": ["4.4", "5.3", "10.2", "11.1"] },
    { "id": 9, "tasks": ["7.1", "7.2", "8.1"] },
    { "id": 10, "tasks": ["7.3", "8.2", "11.2"] },
    { "id": 11, "tasks": ["7.4", "8.3", "9.2"] },
    { "id": 12, "tasks": ["9.3", "12.1", "12.2"] },
    { "id": 13, "tasks": ["12.3", "13.1"] },
    { "id": 14, "tasks": ["13.2", "15.1"] },
    { "id": 15, "tasks": ["15.2"] },
    { "id": 16, "tasks": ["15.3"] },
    { "id": 17, "tasks": ["16.1", "16.2", "16.3"] }
  ]
}
```
