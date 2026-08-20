# Product Overview

The **Africa Health Facilities Registry** is a REST API that maintains a comprehensive registry of health facilities across Africa.

## Core Capabilities

- CRUD operations for health facility records with multilingual support (names and addresses stored as localized JSONB)
- Geospatial queries using PostGIS (proximity search, bounding box)
- Energy profile tracking per facility (energy sources, consumption)
- GHG emission tracking and estimation with country-specific emission factors
- Bulk import/export of facility data (CSV via PapaParse)
- Audit trail for all data mutations
- Verification status tracking with staleness indicators (24-month threshold)
- Role-based access control (user/admin) with JWT authentication

## Domain Context

- All facilities are located within Africa; geolocation inputs are validated against Africa bounds
- Facilities support soft-delete (deletedAt timestamp)
- Uniqueness is enforced on (name_text, country, geolocation)
- Energy verification and facility verification are tracked independently
- The API is versioned under `/api/v1`
