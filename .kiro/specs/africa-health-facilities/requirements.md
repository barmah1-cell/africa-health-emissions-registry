# Requirements Document

## Introduction

This document defines the requirements for an application that stores and manages data on all health facilities across Africa. The system will serve as a comprehensive registry of health facilities, capturing key attributes such as location, type, capacity, services offered, and operational status. It aims to support health system planners, researchers, and policymakers in making data-driven decisions about healthcare access and resource allocation across the continent.

## Glossary

- **Facility_Registry**: The core system responsible for storing, retrieving, and managing health facility records
- **Health_Facility**: A physical location where health services are provided, including hospitals, clinics, health posts, and community health centers
- **Facility_Record**: A data entry representing a single health facility with all its associated attributes
- **User**: A person who interacts with the system to create, read, update, or search facility data
- **Admin**: A user with elevated privileges to manage system configuration, bulk operations, and user access
- **API**: The application programming interface through which external systems and clients interact with the Facility_Registry
- **Geolocation**: The geographic coordinates (latitude and longitude) identifying the physical position of a Health_Facility
- **Facility_Type**: A classification of a Health_Facility (e.g., hospital, clinic, health post, pharmacy, laboratory)
- **Operational_Status**: The current functioning state of a Health_Facility (e.g., operational, temporarily closed, permanently closed, under construction)
- **Energy_Source**: A type of energy used by a Health_Facility to power its operations (e.g., diesel generator, solar, wind, grid electricity, hybrid)
- **Energy_Profile**: The collection of Energy_Sources used by a Health_Facility, including consumption estimates where available
- **GHG_Emissions**: Greenhouse gas emissions associated with a Health_Facility's energy use, categorized by scope (Scope 1: direct emissions from on-site fuel combustion; Scope 2: indirect emissions from purchased grid electricity; Scope 3: other indirect emissions from the supply chain)
- **Emission_Scope**: A classification of GHG emissions following the GHG Protocol (Scope 1, Scope 2, or Scope 3)
- **Audit_Entry**: A record capturing who modified a Facility_Record, what was changed, and when the change occurred
- **Verification_Status**: An indicator of how recently and by what method a Facility_Record's data was confirmed (e.g., field-verified, self-reported, imported from secondary source, unverified)
- **Emission_Factor**: A coefficient used to estimate GHG emissions from a given Energy_Source, typically expressed in kg CO2e per unit of energy consumed, which varies by country and grid composition
- **Locale**: A language and regional identifier (e.g., en, fr, ar, pt, sw) used for storing multilingual facility names and addresses

## Requirements

### Requirement 1: Store Health Facility Records

**User Story:** As a User, I want to create and store health facility records, so that I can build a comprehensive registry of health facilities in Africa.

#### Acceptance Criteria

1. WHEN a User submits a valid Facility_Record, THE Facility_Registry SHALL persist the record and return a unique identifier within 2 seconds of submission
2. THE Facility_Registry SHALL store the following attributes for each Facility_Record: name (required), Facility_Type (required), country (required), administrative region (required), city or town (optional), physical address (optional), Geolocation (required), Operational_Status (required), ownership (public or private, required), contact information (optional; one or more of: phone number, email address, or website URL), number of beds (optional; integer from 0 to 50,000), and Energy_Profile (optional)
3. WHEN a User submits a Facility_Record with missing required fields, THE Facility_Registry SHALL reject the submission and return a list identifying each missing required field by name
4. THE Facility_Registry SHALL enforce uniqueness of facility records based on an exact match of the combination of name, country, and Geolocation coordinates (latitude and longitude)
5. IF a User submits a Facility_Record that matches an existing record on the uniqueness combination of name, country, and Geolocation, THEN THE Facility_Registry SHALL reject the submission and return an error indicating a duplicate record exists

### Requirement 2: Retrieve Health Facility Records

**User Story:** As a User, I want to retrieve health facility data, so that I can view detailed information about specific facilities.

#### Acceptance Criteria

1. WHEN a User requests a Facility_Record by its unique identifier, THE Facility_Registry SHALL return the complete Facility_Record including all stored attributes, multilingual data, Energy_Profile, and Verification_Status
2. IF a User requests a Facility_Record using an identifier that does not match any existing record, THEN THE Facility_Registry SHALL return an error indicating the record was not found
3. WHEN a User requests a list of all Facility_Records for a given country, THE Facility_Registry SHALL return all matching records ordered by facility name in ascending alphabetical order, or an empty collection with a count of zero if no records match
4. IF a User requests a Facility_Record using an identifier that does not conform to the expected format, THEN THE Facility_Registry SHALL reject the request and return a validation error indicating the identifier format is invalid
5. IF a User requests a list of Facility_Records for a country value that is not a recognized African nation, THEN THE Facility_Registry SHALL reject the request and return a validation error indicating the country is invalid

### Requirement 3: Update Health Facility Records

**User Story:** As a User, I want to update health facility data, so that the registry remains accurate and current.

#### Acceptance Criteria

1. WHEN a User submits an update to an existing Facility_Record, THE Facility_Registry SHALL apply the provided field changes without requiring all fields to be resubmitted, and return the complete updated record
2. IF a User submits an update to a Facility_Record that does not exist, THEN THE Facility_Registry SHALL return an error indicating the record was not found and make no changes to the registry
3. IF a User submits an update with invalid field values, THEN THE Facility_Registry SHALL reject the update, preserve the existing Facility_Record unchanged, and return a list of validation errors identifying each invalid field
4. IF a User submits an update to name, country, or Geolocation that would result in a combination matching another existing Facility_Record, THEN THE Facility_Registry SHALL reject the update and return an error indicating a duplicate facility exists

### Requirement 4: Delete Health Facility Records

**User Story:** As an Admin, I want to delete health facility records, so that incorrect or duplicate entries can be removed from the registry.

#### Acceptance Criteria

1. WHEN an Admin requests deletion of an existing Facility_Record, THE Facility_Registry SHALL remove the record from query results, preserve associated Audit_Entries, and return a confirmation including the deleted record's unique identifier
2. IF an Admin requests deletion of a Facility_Record that does not exist, THEN THE Facility_Registry SHALL return an error indicating the record was not found
3. THE Facility_Registry SHALL restrict deletion operations to users with Admin privileges
4. IF a non-Admin User attempts a deletion operation, THEN THE Facility_Registry SHALL reject the request and return an authorization error

### Requirement 5: Search and Filter Health Facilities

**User Story:** As a User, I want to search and filter health facilities, so that I can find facilities matching specific criteria.

#### Acceptance Criteria

1. WHEN a User submits a search query with a country filter, THE Facility_Registry SHALL return all Facility_Records matching that country
2. WHEN a User submits a search query with a Facility_Type filter, THE Facility_Registry SHALL return all Facility_Records matching that type
3. WHEN a User submits a search query with an Operational_Status filter, THE Facility_Registry SHALL return all Facility_Records matching that status
4. WHEN a User submits a search query with multiple filters, THE Facility_Registry SHALL return Facility_Records matching all specified filters (AND logic)
5. WHEN a User submits a search query with a text keyword between 1 and 200 characters, THE Facility_Registry SHALL perform a case-insensitive partial match against facility name and address fields and return all matching Facility_Records
6. WHEN a search query returns no results, THE Facility_Registry SHALL return an empty collection with a count of zero
7. IF a User submits a search query with a filter value that does not belong to the accepted set for that field (country, Facility_Type, or Operational_Status), THEN THE Facility_Registry SHALL reject the query and return a validation error indicating the invalid filter value
8. IF a User submits a search query with an empty or whitespace-only keyword, THEN THE Facility_Registry SHALL reject the query and return a validation error indicating that a non-empty keyword is required
9. WHEN a search query returns results, THE Facility_Registry SHALL return the Facility_Records ordered by facility name in ascending alphabetical order

### Requirement 6: Geospatial Queries

**User Story:** As a User, I want to search for health facilities by geographic proximity, so that I can find facilities near a specific location.

#### Acceptance Criteria

1. WHEN a User submits a Geolocation and a radius between 0.1 and 1000 kilometers, THE Facility_Registry SHALL return all Facility_Records whose Geolocation falls within the specified radius of the submitted point, ordered by distance from nearest to farthest
2. WHEN a User submits a bounding box defined by a southwest corner Geolocation and a northeast corner Geolocation, THE Facility_Registry SHALL return all Facility_Records whose Geolocation falls within that bounding box
3. IF a User submits invalid Geolocation coordinates (latitude outside -90 to 90 or longitude outside -180 to 180), THEN THE Facility_Registry SHALL reject the query and return a validation error indicating which coordinate is invalid
4. IF a User submits a radius that is zero, negative, or greater than 1000 kilometers, THEN THE Facility_Registry SHALL reject the query and return a validation error indicating the accepted radius range
5. WHEN a geospatial query matches no Facility_Records, THE Facility_Registry SHALL return an empty collection with a count of zero

### Requirement 7: Bulk Data Import

**User Story:** As an Admin, I want to import health facility data in bulk, so that I can efficiently populate the registry from existing datasets.

#### Acceptance Criteria

1. WHEN an Admin submits a CSV file containing Facility_Records with a header row matching Facility_Record attribute names, THE Facility_Registry SHALL parse and store all valid records, and return a summary report indicating the number of records successfully imported, the number skipped due to validation errors, and the number skipped due to duplicates
2. WHEN a CSV file contains records with validation errors, THE Facility_Registry SHALL skip invalid records and return a report listing each skipped record with its row number and error details
3. WHEN a CSV file contains duplicate records (matching an existing name, country, and Geolocation), THE Facility_Registry SHALL skip duplicates and include them in the import report
4. THE Facility_Registry SHALL restrict bulk import operations to users with Admin privileges
5. IF an Admin submits a file that is not valid CSV (malformed structure, unreadable encoding, or empty file with no data rows), THEN THE Facility_Registry SHALL reject the entire file and return an error indicating the file format is invalid
6. IF an Admin submits a CSV file exceeding 10,000 rows or 10 MB in size, THEN THE Facility_Registry SHALL reject the file and return an error indicating the file exceeds the maximum allowed size

### Requirement 8: Data Export

**User Story:** As a User, I want to export health facility data, so that I can use the data in external tools and reports.

#### Acceptance Criteria

1. WHEN a User requests an export of Facility_Records, THE Facility_Registry SHALL generate a UTF-8 encoded, RFC 4180 compliant CSV file containing up to 50,000 records
2. WHEN a User requests an export with filters applied, THE Facility_Registry SHALL include only the Facility_Records matching the specified filters
3. THE Facility_Registry SHALL include a header row in exported CSV files with column names matching the Facility_Record attributes
4. IF the export request matches more than 50,000 Facility_Records, THEN THE Facility_Registry SHALL reject the request and return an error indicating the export exceeds the maximum allowed size, along with the total count of matching records
5. WHEN a User requests an export that matches zero Facility_Records, THE Facility_Registry SHALL return a CSV file containing only the header row

### Requirement 9: Pagination of Results

**User Story:** As a User, I want results to be paginated, so that large datasets are returned in manageable chunks.

#### Acceptance Criteria

1. WHEN a query returns more than 100 Facility_Records and the User has not specified pagination parameters, THE Facility_Registry SHALL return the first 100 records sorted by unique identifier in ascending order, along with pagination metadata (total count, current page number, total pages, and page size)
2. WHEN a User specifies a page number (minimum 1) and page size (minimum 1, maximum 500), THE Facility_Registry SHALL return the corresponding subset of results sorted by unique identifier in ascending order, along with pagination metadata (total count, current page number, total pages, and page size)
3. IF a User requests a page number that exceeds the total number of pages, THEN THE Facility_Registry SHALL return an empty collection with the pagination metadata indicating the requested page number and total pages available
4. IF a User specifies a page size less than 1 or greater than 500 or a page number less than 1, THEN THE Facility_Registry SHALL reject the request and return a validation error indicating the acceptable ranges
5. WHEN a query returns 100 or fewer Facility_Records and the User has not specified pagination parameters, THE Facility_Registry SHALL return all matching records along with pagination metadata indicating a single page

### Requirement 10: Energy Source and GHG Emissions Tracking

**User Story:** As a User, I want to record the energy sources used by each health facility and their associated greenhouse gas emissions, so that I can estimate and track the carbon footprint of health facilities across Africa.

#### Acceptance Criteria

1. THE Facility_Registry SHALL store one or more Energy_Source entries (up to a maximum of 10) for each Facility_Record, where each entry includes the energy type (diesel generator, solar, wind, grid electricity, or hybrid)
2. WHEN a User submits a Facility_Record without Energy_Source data, THE Facility_Registry SHALL accept the record and mark the Energy_Profile as unknown
3. WHEN a User submits GHG_Emissions data for a Facility_Record, THE Facility_Registry SHALL store the emissions value categorized by Emission_Scope (Scope 1, Scope 2, or Scope 3), enforcing uniqueness per combination of Facility_Record, Emission_Scope, and reporting period year
4. WHEN a User updates the Energy_Profile of an existing Facility_Record, THE Facility_Registry SHALL apply the changes and retain a timestamp of the last update to the Energy_Profile
5. THE Facility_Registry SHALL allow partial Energy_Profile data, where a minimum valid entry includes only the energy type, and consumption quantity (expressed in kWh per year, ranging from 0.01 to 999,999,999.99) is optional
6. WHEN a User submits GHG_Emissions data, THE Facility_Registry SHALL validate that each emission entry includes an Emission_Scope, a numeric value in tonnes of CO2 equivalent (ranging from 0 to 999,999,999.99), and a reporting period year (ranging from 2000 to the current calendar year)
7. WHEN a User searches with an Energy_Source filter, THE Facility_Registry SHALL return all Facility_Records that use the specified energy type
8. WHEN a User searches with a filter for facilities with unknown Energy_Profiles, THE Facility_Registry SHALL return all Facility_Records where Energy_Profile is marked as unknown
9. IF a User submits GHG_Emissions data that fails validation (missing Emission_Scope, non-numeric or out-of-range emissions value, or missing or out-of-range reporting period year), THEN THE Facility_Registry SHALL reject the submission and return a list of validation errors indicating which fields failed

### Requirement 11: Data Provenance and Audit Trail

**User Story:** As an Admin, I want to track all changes made to facility records, so that I can understand the history of data modifications and identify the source of each change.

#### Acceptance Criteria

1. WHEN a User creates, updates, or deletes a Facility_Record, THE Facility_Registry SHALL create an Audit_Entry recording the user identity, timestamp, operation type, and the fields that were changed
2. WHEN an Admin requests the audit history of a Facility_Record, THE Facility_Registry SHALL return a chronological list of all Audit_Entries for that record sorted from oldest to newest
3. THE Facility_Registry SHALL store the previous and new values for each field modified in an Audit_Entry; for create operations the previous value SHALL be null, and for delete operations the new value SHALL be null
4. THE Facility_Registry SHALL retain Audit_Entries indefinitely and prevent their modification or deletion
5. THE Facility_Registry SHALL retain Audit_Entries for deleted Facility_Records and make them accessible by the original facility identifier
6. THE Facility_Registry SHALL restrict access to audit history to users with Admin privileges

### Requirement 12: Multi-Language Support

**User Story:** As a User, I want to store facility names and addresses in multiple languages, so that the registry is accessible to users across Africa's diverse linguistic landscape.

#### Acceptance Criteria

1. THE Facility_Registry SHALL support storing facility names in up to 20 Locales per Facility_Record (including but not limited to English, French, Arabic, Portuguese, and Swahili)
2. THE Facility_Registry SHALL support storing physical addresses in multiple Locales, up to 20 Locales per Facility_Record
3. WHEN a User submits a Facility_Record with multilingual data, THE Facility_Registry SHALL store all provided language variants and designate the Locale explicitly marked by the User as the default; IF no default is specified by the User, THEN THE Facility_Registry SHALL designate the first provided Locale as the default
4. WHEN a User performs a keyword search, THE Facility_Registry SHALL match against facility names and addresses in all stored Locales
5. WHEN a User specifies a preferred Locale in a query, THE Facility_Registry SHALL return results with names and addresses in that Locale where available, falling back to the default Locale otherwise
6. WHEN a User submits a Facility_Record without a facility name in at least one supported Locale, THE Facility_Registry SHALL reject the submission and return a validation error indicating that a name in at least one Locale is required

### Requirement 13: Data Freshness and Verification Status

**User Story:** As a User, I want to know how recently facility data was verified and its source, so that I can assess the reliability of the information.

#### Acceptance Criteria

1. THE Facility_Registry SHALL store a Verification_Status for each Facility_Record indicating the verification method (field-verified, self-reported, imported from secondary source, or unverified), defaulting to "unverified" when a new Facility_Record is created without an explicit Verification_Status
2. THE Facility_Registry SHALL store a verification date indicating when the Facility_Record was last confirmed
3. WHEN a User updates a Facility_Record and marks the data as verified, THE Facility_Registry SHALL update the Verification_Status to the method specified by the User and set the verification date to the current system timestamp
4. WHEN a User searches with a Verification_Status filter, THE Facility_Registry SHALL return all Facility_Records matching that status
5. WHEN a Facility_Record has a verification date older than 24 months from the current date, THE Facility_Registry SHALL include a stale indicator in the record's query result representation alongside the existing Verification_Status and verification date
6. THE Facility_Registry SHALL store a Verification_Status and a verification date independently for the Energy_Profile data, separate from the overall Facility_Record verification, and the 24-month staleness rule SHALL apply independently to the Energy_Profile verification date
7. IF a Facility_Record has never been verified (Verification_Status is "unverified" and no verification date exists), THEN THE Facility_Registry SHALL include a stale indicator in query results for that record

### Requirement 14: Emission Factor References

**User Story:** As a User, I want the system to store country-specific emission factors, so that GHG emissions can be estimated from energy source data when direct measurements are unavailable.

#### Acceptance Criteria

1. THE Facility_Registry SHALL store Emission_Factor values for each combination of country and Energy_Source type
2. WHEN an Admin submits or updates an Emission_Factor, THE Facility_Registry SHALL validate that the entry includes a country, Energy_Source type, a positive numeric factor value in kg CO2e per kWh, and a reference year between 1990 and the current calendar year (inclusive)
3. IF an Admin submits an Emission_Factor entry that fails validation, THEN THE Facility_Registry SHALL reject the submission and return a list of the fields that failed validation
4. WHEN a Facility_Record has energy consumption data but no direct GHG_Emissions measurement, THE Facility_Registry SHALL allow Users to calculate estimated emissions by multiplying the consumption value in kWh by the Emission_Factor matching the facility's country, Energy_Source type, and the most recent reference year that does not exceed the facility's reporting period year, and SHALL return the result in tonnes of CO2 equivalent
5. WHEN no Emission_Factor exists for a given country and Energy_Source combination, THE Facility_Registry SHALL return a response indicating that estimation is unavailable for that facility and Energy_Source combination
6. THE Facility_Registry SHALL support multiple Emission_Factor entries per country to account for yearly updates (each entry is associated with a reference year)
7. THE Facility_Registry SHALL restrict creation, modification, and deletion of Emission_Factor entries to users with Admin privileges

### Requirement 15: Input Validation

**User Story:** As a User, I want the system to validate my input, so that data quality is maintained across the registry.

#### Acceptance Criteria

1. THE Facility_Registry SHALL validate that country values correspond to recognized African nations (54 countries)
2. THE Facility_Registry SHALL validate that Geolocation coordinates fall within the geographic boundaries of the African continent (latitude -35 to 37, longitude -25 to 55)
3. THE Facility_Registry SHALL validate that Facility_Type values belong to a predefined set of accepted types
4. THE Facility_Registry SHALL validate that Operational_Status values belong to a predefined set of accepted statuses
5. THE Facility_Registry SHALL validate that Energy_Source values belong to a predefined set of accepted types (diesel generator, solar, wind, grid electricity, hybrid)
6. THE Facility_Registry SHALL validate that Verification_Status values belong to a predefined set (field-verified, self-reported, imported from secondary source, unverified)
7. THE Facility_Registry SHALL validate that Locale values correspond to supported language codes
8. THE Facility_Registry SHALL validate that Emission_Factor values are positive numeric values not exceeding 100 kg CO2e per kWh
9. IF a Facility_Record contains a field value exceeding 500 characters, THEN THE Facility_Registry SHALL reject the record and return a validation error
10. IF a submission fails multiple validation rules simultaneously, THEN THE Facility_Registry SHALL return all validation errors together in a single response rather than failing on the first error encountered

### Requirement 16: API Access and Authentication

**User Story:** As a User, I want secure access to the system through an API, so that I can integrate facility data into other applications.

#### Acceptance Criteria

1. THE API SHALL require authentication for all write operations (create, update, delete, import)
2. THE API SHALL allow unauthenticated read access for search and retrieval operations
3. IF a write request is received without any authentication credentials, THEN THE API SHALL reject the request and return an authentication error indicating that credentials are required
4. WHEN a User provides invalid authentication credentials, THE API SHALL reject the request and return an authentication error indicating that the credentials are not valid
5. WHEN an authenticated User attempts an operation restricted to the Admin role (deletion or bulk import), THE API SHALL reject the request and return an authorization error indicating insufficient privileges
6. IF the API receives more than 10 consecutive failed authentication attempts from the same source within 60 seconds, THEN THE API SHALL temporarily block further authentication attempts from that source for 300 seconds
