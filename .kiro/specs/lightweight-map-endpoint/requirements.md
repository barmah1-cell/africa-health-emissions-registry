# Requirements Document

## Introduction

The map view of the Africa Health Facilities Registry currently renders Leaflet markers by loading full facility records — multilingual JSONB names and addresses, energy profiles, GHG emission data, bed counts, and contact information — even though drawing a map marker needs only a handful of fields. This inflates payloads and slows the initial map paint.

This feature introduces a dedicated slim map endpoint (`GET /api/v1/facilities/map`) that returns only the minimal fields required to plot and label a marker. Full facility detail is loaded on demand when a user clicks a marker, reusing the existing `GET /api/v1/facilities/:id` endpoint. The slim endpoint supports optional server-side bounding-box (viewport) filtering, optional attribute filters (country, facility type, operational status), soft-delete exclusion, public read access, and HTTP caching (ETag / Cache-Control) so repeat loads and pan/zoom operations can be served from the browser cache or short-circuited with a 304 response.

The endpoint reuses established patterns in the codebase: the PostGIS bounding-box technique (`ST_MakeEnvelope`), the Zod geolocation-bounds validation, the layered Routes → Service → Raw SQL architecture, the `ServiceResponse<T>` result pattern, aggregated (non-fail-fast) validation, and `optionalAuth` for public reads.

## Glossary

- **Map_Endpoint**: The new HTTP endpoint `GET /api/v1/facilities/map` that returns slim marker projections.
- **Map_Service**: The service-layer component (`MapService.getMapMarkers`) that validates parameters, builds the slim query, and returns a `ServiceResponse`.
- **Slim_Marker**: A minimal facility projection containing exactly the fields `id`, `latitude`, `longitude`, `facilityType`, `nameText`, `country`, and `staleIndicator`. It deliberately excludes beds, energy profile, GHG emissions, addresses, contact info, and multilingual JSONB name/address objects.
- **Full_Record**: The complete facility representation returned by the existing `GET /api/v1/facilities/:id` endpoint, including beds, energy profile, GHG emissions, contact info, and multilingual fields.
- **Full_Facility_Listing**: The existing `GET /api/v1/facilities` endpoint that returns full facility records subject to filters.
- **Bounding_Box**: A rectangular viewport defined by four corner coordinates — `sw_lat` (south-west latitude), `sw_lon` (south-west longitude), `ne_lat` (north-east latitude), and `ne_lon` (north-east longitude).
- **Viewport_Mode**: Query mode in which all four Bounding_Box corners are provided, constraining results to the rectangle.
- **Global_Mode**: Query mode in which no Bounding_Box corners are provided; results are constrained only by attribute filters (if any).
- **staleIndicator**: A boolean flag, derived by the existing `computeStaleIndicator(verificationStatus, verificationDate)` helper (24-month staleness rule), that is true when a facility's verification is stale or unverified.
- **Soft_Delete**: The convention where a facility is marked deleted via a non-null `deletedAt` timestamp rather than being physically removed; such records are excluded from query results.
- **ETag**: An HTTP response header carrying a hash of the serialized response body, used by clients for cache validation.
- **If-None-Match**: An HTTP request header carrying a previously received ETag value for cache revalidation.
- **304_Not_Modified**: The HTTP status returned with an empty body when the client's `If-None-Match` value matches the current ETag.
- **VALIDATION_ERROR**: The standard error code (mapped to HTTP 400) returned for invalid query input, using the API's error envelope `{ error: { code, message, details? } }`.
- **Aggregated_Validation**: Validation that collects all field errors in a single response rather than stopping at the first error (fail-fast).

## Requirements

### Requirement 1: Slim Marker Projection

**User Story:** As a map user, I want the map endpoint to return only the fields needed to draw a marker, so that the initial map paint is fast and lightweight.

#### Acceptance Criteria

1. WHEN a request is made to the Map_Endpoint, THE Map_Endpoint SHALL return each facility as a Slim_Marker containing exactly the fields `id`, `latitude`, `longitude`, `facilityType`, `nameText`, `country`, and `staleIndicator`.
2. WHEN the Map_Endpoint returns a Slim_Marker, THE Map_Endpoint SHALL exclude beds, energy profile, GHG emission fields, addresses, contact info, and multilingual JSONB name and address objects from that Slim_Marker.
3. THE Map_Endpoint SHALL derive the `staleIndicator` field of each Slim_Marker using the existing `computeStaleIndicator(verificationStatus, verificationDate)` helper.
4. THE Map_Endpoint SHALL exclude `verificationStatus` and `verificationDate` from each returned Slim_Marker.

### Requirement 2: Bounding-Box Viewport Filtering

**User Story:** As a map user, I want to constrain markers to the current viewport, so that panning and zooming loads only the facilities I can see.

#### Acceptance Criteria

1. WHEN a request supplies all four Bounding_Box corners (`sw_lat`, `sw_lon`, `ne_lat`, `ne_lon`), THE Map_Endpoint SHALL return only Slim_Markers whose coordinates lie within the Bounding_Box.
2. WHILE operating in Viewport_Mode, THE Map_Endpoint SHALL include a Slim_Marker only WHERE `sw_lon` is less than or equal to the marker longitude AND the marker longitude is less than or equal to `ne_lon` AND `sw_lat` is less than or equal to the marker latitude AND the marker latitude is less than or equal to `ne_lat`.
3. WHEN a request supplies no Bounding_Box corners, THE Map_Endpoint SHALL operate in Global_Mode and return all matching Slim_Markers subject only to the applied filters.

### Requirement 3: All-or-Nothing Bounding-Box Validation

**User Story:** As an API consumer, I want partial bounding boxes to be rejected, so that ambiguous viewport queries fail predictably.

#### Acceptance Criteria

1. IF a request supplies between one and three Bounding_Box corners, THEN THE Map_Service SHALL return a VALIDATION_ERROR with HTTP status 400.
2. WHEN a request supplies zero or four Bounding_Box corners, THE Map_Service SHALL accept the Bounding_Box parameters as valid.
3. IF a Bounding_Box corner value falls outside the general world coordinate bounds, THEN THE Map_Service SHALL return a VALIDATION_ERROR with HTTP status 400 including per-field details.

### Requirement 4: Optional Attribute Filters

**User Story:** As a map user, I want to filter markers by country, facility type, and operational status, so that I can focus on a subset of facilities.

#### Acceptance Criteria

1. WHERE a `country` filter is supplied, THE Map_Endpoint SHALL return only Slim_Markers whose country equals the supplied value.
2. WHERE a `facilityType` filter is supplied, THE Map_Endpoint SHALL return only Slim_Markers whose facility type equals the supplied value.
3. WHERE an `operationalStatus` filter is supplied, THE Map_Endpoint SHALL return only Slim_Markers whose operational status equals the supplied value.
4. IF a `country` filter is not a recognized African nation, THEN THE Map_Service SHALL return a VALIDATION_ERROR with HTTP status 400.
5. IF a `facilityType` or `operationalStatus` filter is not a valid enum value, THEN THE Map_Service SHALL return a VALIDATION_ERROR with HTTP status 400.
6. IF a request contains multiple invalid query parameters, THEN THE Map_Service SHALL return a VALIDATION_ERROR whose details aggregate all field errors using Aggregated_Validation.

### Requirement 5: Soft-Delete Exclusion

**User Story:** As a data steward, I want soft-deleted facilities to never appear on the map, so that removed facilities are not shown to users.

#### Acceptance Criteria

1. THE Map_Endpoint SHALL exclude every facility with a non-null `deletedAt` from the returned Slim_Markers for any query.

### Requirement 6: Consistency With the Full Facility Listing

**User Story:** As an API consumer, I want the map markers to correspond to the same facilities as the full listing, so that the map and the list stay in agreement.

#### Acceptance Criteria

1. WHEN the Map_Endpoint and the Full_Facility_Listing are queried with identical filters in Global_Mode, THE Map_Endpoint SHALL return the same set of facility `id` values as the Full_Facility_Listing.
2. WHEN a Slim_Marker is returned, THE Map_Endpoint SHALL provide `nameText`, `facilityType`, `country`, `staleIndicator`, and coordinate values that match the corresponding Full_Record served by `GET /api/v1/facilities/:id`.

### Requirement 7: Response Envelope and Count

**User Story:** As an API consumer, I want a consistent response envelope with an accurate count, so that I can reason about how many markers were returned.

#### Acceptance Criteria

1. WHEN the Map_Endpoint returns a successful response, THE Map_Endpoint SHALL include a `markers` array and a `count` field.
2. WHEN the Map_Endpoint returns a successful response, THE Map_Endpoint SHALL set `count` equal to the number of elements in the `markers` array.
3. WHEN no facilities match the query, THE Map_Endpoint SHALL return HTTP status 200 with a body of `{ "markers": [], "count": 0 }`.

### Requirement 8: HTTP Caching With ETag and Conditional Requests

**User Story:** As a map user, I want repeated map loads and pan/zoom operations to use the browser cache, so that the map stays responsive and database load is reduced.

#### Acceptance Criteria

1. WHEN the Map_Endpoint returns a successful response, THE Map_Endpoint SHALL set an ETag header derived from the serialized response body and a Cache-Control header.
2. WHEN two identical requests are made to the Map_Endpoint, THE Map_Endpoint SHALL produce the same ETag value for both responses.
3. IF a request carries an If-None-Match header equal to the current ETag, THEN THE Map_Endpoint SHALL respond with 304_Not_Modified and an empty body.
4. THE Map_Endpoint SHALL order Slim_Markers deterministically so that identical queries produce a stable ETag.

### Requirement 9: Public Read Access

**User Story:** As a map user, I want to view facility markers without logging in, so that the public map is openly accessible.

#### Acceptance Criteria

1. WHEN a request is made to the Map_Endpoint without authentication credentials, THE Map_Endpoint SHALL process the request and return Slim_Markers using `optionalAuth`.

### Requirement 10: Fetch-on-Click Full Detail

**User Story:** As a map user, I want clicking a marker to load the complete facility record, so that beds, energy, GHG, and contact information remain fully available on demand.

#### Acceptance Criteria

1. WHEN a user clicks a map marker, THE frontend SHALL request the Full_Record for that marker's `id` from the existing `GET /api/v1/facilities/:id` endpoint.
2. WHEN the Full_Record is retrieved, THE frontend SHALL display the complete facility detail including beds, energy profile, GHG emissions, and contact information.
3. WHEN the map is loaded or the viewport changes, THE frontend SHALL request Slim_Markers for the current viewport from the Map_Endpoint.

### Requirement 11: Performance and Payload Reduction

**User Story:** As a map user, I want the map data to be substantially smaller than full records, so that the map paints quickly and scales as facilities grow.

#### Acceptance Criteria

1. THE Map_Endpoint SHALL return a per-facility payload limited to the seven Slim_Marker scalar fields, which is a strict subset of the Full_Record fields.
2. WHILE operating in Viewport_Mode, THE Map_Endpoint SHALL constrain the number of returned Slim_Markers to those within the current Bounding_Box.

### Requirement 12: SQL Injection Safety

**User Story:** As a security reviewer, I want all query values bound as SQL parameters, so that user input cannot be injected into the raw SQL query.

#### Acceptance Criteria

1. WHEN the Map_Service builds its raw SQL query, THE Map_Service SHALL pass all user-supplied values as bound SQL parameters rather than interpolating them into the query text.
2. IF the raw SQL query fails unexpectedly, THEN THE Map_Endpoint SHALL propagate the error to the centralized error handler, which returns HTTP status 500.
