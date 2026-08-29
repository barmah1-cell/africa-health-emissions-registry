# Implementation Plan: Lightweight Map Endpoint

## Overview

This plan implements a dedicated slim map endpoint (`GET /api/v1/facilities/map`) that returns only the minimal fields required to draw and label a Leaflet marker, with optional bounding-box viewport filtering, optional attribute filters, soft-delete exclusion, public read access via `optionalAuth`, and HTTP caching (ETag / Cache-Control / 304). Full detail is loaded on demand via the existing `GET /api/v1/facilities/:id` endpoint.

The work follows the established layered architecture (Routes → Services → Prisma/Raw SQL), the `createXRouter(prisma)` factory pattern, barrel exports, the `ServiceResponse<T>` result pattern, and existing Zod/PostGIS conventions. Tasks build incrementally: types → validation schema → service → route → wiring → frontend, with tests placed close to the code they validate.

## Tasks

- [x] 1. Add slim marker types
  - [x] 1.1 Define `MapMarker` and `MapMarkersResult` types
    - Add `MapMarker` interface to `src/types/models.ts` with exactly `id`, `latitude`, `longitude`, `facilityType`, `nameText`, `country`, `staleIndicator`
    - Add `MapMarkersResult` interface with `markers: MapMarker[]` and `count: number`
    - Re-export both from the barrel `src/types/index.ts`
    - _Requirements: 1.1, 1.2, 7.1, 7.2, 11.1_

- [x] 2. Add map query validation schema
  - [x] 2.1 Implement `MapMarkersQuerySchema`
    - Add `MapMarkersQuerySchema` and `MapMarkersQueryInput` to `src/validation/schemas.ts`
    - Reuse `GEO_LAT_MIN/MAX`, `GEO_LON_MIN/MAX` for optional bbox corners (`swLatitude`, `swLongitude`, `neLatitude`, `neLongitude`)
    - Reuse `FacilityTypeSchema`, `OperationalStatusSchema`, and `boundedString` + `AFRICAN_COUNTRIES` refinement for optional filters
    - Add all-or-nothing bbox refine (0 or 4 corners provided; 1–3 is a validation error)
    - Ensure aggregated (non-fail-fast) validation via existing `validateInput` / `safeParse` behavior
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 4.4, 4.5, 4.6_

  - [x]* 2.2 Write unit tests for `MapMarkersQuerySchema`
    - Test 0 and 4 corners accepted; 1–3 corners rejected
    - Test out-of-range coordinates rejected with per-field details
    - Test invalid country/facilityType/operationalStatus rejected
    - Test aggregation of multiple invalid params
    - _Requirements: 3.1, 3.2, 3.3, 4.4, 4.5, 4.6_

- [x] 3. Implement MapService
  - [x] 3.1 Implement `MapService.getMapMarkers`
    - Create `src/services/map.service.ts` exporting `MapService` class with constructor injecting `PrismaClient`
    - Implement `getMapMarkers(query): Promise<ServiceResponse<MapMarkersResult>>`
    - Validate input with `MapMarkersQuerySchema` via `validateInput`; return `VALIDATION_ERROR` on failure
    - Build parameterized raw SQL via `prisma.$queryRawUnsafe` with base condition `f.deleted_at IS NULL`
    - Add optional bbox filter using `ST_Intersects(f.geolocation::geometry, ST_MakeEnvelope($..., 4326))` with bound params
    - Add optional `country`, `facility_type`, `operational_status` conditions as bound params (no string interpolation of user values)
    - Select `ST_Y`/`ST_X` for coordinates plus `verification_status`/`verification_date` (used only to compute staleness, not returned)
    - Order by `name_text ASC` for deterministic output (stable ETags)
    - Map rows to `MapMarker[]`, deriving `staleIndicator` via `computeStaleIndicator` imported from `facility.service.ts`
    - Return `{ success: true, data: { markers, count: markers.length } }`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 4.1, 4.2, 4.3, 5.1, 7.1, 7.2, 8.4, 12.1_

  - [x]* 3.2 Write unit tests for `MapService.getMapMarkers`
    - Test validation branch returns `VALIDATION_ERROR`
    - Test WHERE-clause assembly with correct parameter binding (bbox present/absent, each filter)
    - Test `staleIndicator` derivation and exclusion of verification fields
    - Test empty result returns `{ markers: [], count: 0 }`
    - _Requirements: 1.1, 1.4, 5.1, 7.1, 7.2, 12.1_

  - [x]* 3.3 Write property test — Slim Shape, No Leakage
    - **Property 1: Slim Shape — Exact Fields, No Leakage**
    - **Validates: Requirements 1.1, 1.2, 1.4, 11.1**

  - [x]* 3.4 Write property test — Soft-Delete Exclusion
    - **Property 3: Soft-Delete Exclusion**
    - **Validates: Requirements 5.1**

  - [x]* 3.5 Write property test — All-or-Nothing BBox Validation
    - **Property 6: All-or-Nothing BBox Validation**
    - **Validates: Requirements 3.1, 3.2**

  - [x]* 3.6 Write property test — Count Invariant
    - **Property 7: Count Invariant**
    - **Validates: Requirements 7.1, 7.2**

- [x] 4. Implement map route and wire into the app
  - [x] 4.1 Implement `createMapRouter` and register it
    - Create `src/routes/map.routes.ts` exporting `createMapRouter(prisma)` with `GET /facilities/map` using `optionalAuth`
    - Map snake_case query params (`sw_lat`, `sw_lon`, `ne_lat`, `ne_lon`) plus `country`/`facilityType`/`operationalStatus` to the service call
    - Map `ServiceResponse` errors to HTTP via `ERROR_HTTP_STATUS` and the standard error envelope
    - Compute ETag (sha1 of serialized body via Node `crypto`), set `ETag` and `Cache-Control: public, max-age=60`
    - Return `304` with empty body when `If-None-Match` matches the computed ETag
    - Register the router in `src/routes/index.ts` and mount it BEFORE the facility router so `/facilities/map` matches before `/facilities/:id`
    - _Requirements: 2.1, 3.1, 3.3, 4.4, 4.5, 4.6, 7.1, 7.2, 7.3, 8.1, 8.2, 8.3, 9.1, 12.2_

  - [x]* 4.2 Write property test — BBox Containment
    - **Property 2: BBox Containment**
    - **Validates: Requirements 2.1, 2.2, 11.2**

  - [x]* 4.3 Write property test — Subset Consistency With the Full List
    - **Property 4: Subset Consistency With the Full List**
    - **Validates: Requirements 2.3, 4.1, 4.2, 4.3, 6.1**

  - [x]* 4.4 Write property test — Field Agreement
    - **Property 5: Field Agreement**
    - **Validates: Requirements 1.3, 6.2**

  - [x]* 4.5 Write property test — ETag Stability & 304
    - **Property 8: ETag Stability & 304**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4**

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Wire the frontend to the slim endpoint
  - [x] 6.1 Update `loadMapMarkers()` to call the slim endpoint
    - In `public/index.html`, change `loadMapMarkers()` to fetch `GET /facilities/map` with current Leaflet viewport bounds (`map.getBounds()`) mapped to `sw_lat`/`sw_lon`/`ne_lat`/`ne_lon`, plus existing filter params and selected facility type
    - Remove the multi-page full-record background loop
    - Add a `normalizeMarker(m)` adapter that shapes `{ latitude, longitude }` into `geolocation` so `makeMarker`/`makeTooltip`/`getTypeColor` keep working unchanged
    - Optionally bind `loadMapMarkers` to the Leaflet `moveend` event for viewport-driven loading
    - _Requirements: 10.3, 11.1, 11.2_

  - [x] 6.2 Update `selectFacilityFromMap(f)` for fetch-on-click detail
    - Change `selectFacilityFromMap(f)` to fetch the Full_Record from the existing `GET /facilities/:id` using the marker `id`
    - Pass the full record to `showDetail(...)` so beds, energy profile, GHG, and contact info remain available on demand
    - _Requirements: 10.1, 10.2_

- [x] 7. Integration tests for the map endpoint
  - [x]* 7.1 Write integration tests for `GET /api/v1/facilities/map`
    - Test 200 slim payload shape and `count` field
    - Test bbox viewport filtering and attribute filter combinations
    - Test 400 on partial bbox (1–3 corners)
    - Test ETag header present, and `If-None-Match` → 304 with empty body
    - Test soft-deleted facilities excluded and public access via `optionalAuth` (no credentials)
    - _Requirements: 2.1, 3.1, 4.1, 4.2, 4.3, 5.1, 7.1, 7.2, 7.3, 8.1, 8.3, 9.1_

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the universal correctness properties from the design document
- Unit and integration tests validate specific examples, error paths, and HTTP behavior
- The endpoint reuses existing patterns: PostGIS `ST_MakeEnvelope`/`ST_Intersects`, Zod geo bounds, `ServiceResponse<T>`, `optionalAuth`, and the `computeStaleIndicator` helper
- No new runtime dependencies; ETag hashing uses Node's built-in `crypto`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4", "3.5", "3.6"] },
    { "id": 4, "tasks": ["4.1"] },
    { "id": 5, "tasks": ["4.2", "4.3", "4.4", "4.5", "6.1", "6.2"] },
    { "id": 6, "tasks": ["7.1"] }
  ]
}
```
