-- Enable PostGIS extension for geospatial support
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateTable: facility
CREATE TABLE "facility" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "names" JSONB NOT NULL,
    "addresses" JSONB NOT NULL,
    "default_locale" VARCHAR(10) NOT NULL,
    "name_text" VARCHAR(500) NOT NULL,
    "facility_type" VARCHAR(100) NOT NULL,
    "country" VARCHAR(100) NOT NULL,
    "admin_region" VARCHAR(200) NOT NULL,
    "city" VARCHAR(200),
    "ownership" VARCHAR(20) NOT NULL,
    "operational_status" VARCHAR(50) NOT NULL,
    "geolocation" geography(Point, 4326) NOT NULL,
    "contact_info" JSONB,
    "beds" INTEGER,
    "verification_status" VARCHAR(50) NOT NULL DEFAULT 'unverified',
    "verification_date" TIMESTAMP(3),
    "energy_verification_status" VARCHAR(50) NOT NULL DEFAULT 'unverified',
    "energy_verification_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable: energy_source
CREATE TABLE "energy_source" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "facility_id" UUID NOT NULL,
    "energy_type" VARCHAR(50) NOT NULL,
    "consumption_kwh_year" DECIMAL(15,2),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "energy_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ghg_emission
CREATE TABLE "ghg_emission" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "facility_id" UUID NOT NULL,
    "emission_scope" VARCHAR(20) NOT NULL,
    "value_tonnes_co2e" DECIMAL(15,2) NOT NULL,
    "reporting_year" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ghg_emission_pkey" PRIMARY KEY ("id")
);

-- CreateTable: emission_factor
CREATE TABLE "emission_factor" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "country" VARCHAR(100) NOT NULL,
    "energy_source_type" VARCHAR(50) NOT NULL,
    "factor_kg_co2e_per_kwh" DECIMAL(10,6) NOT NULL,
    "reference_year" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emission_factor_pkey" PRIMARY KEY ("id")
);

-- CreateTable: audit_entry
CREATE TABLE "audit_entry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "facility_id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "operation_type" VARCHAR(20) NOT NULL,
    "changes" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable: user
CREATE TABLE "user" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" VARCHAR(10) NOT NULL DEFAULT 'user',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- ============================================================
-- INDEXES
-- ============================================================

-- GIST spatial index on facility.geolocation for proximity and bounding box queries
CREATE INDEX "idx_facility_geolocation_gist" ON "facility" USING GIST ("geolocation");

-- GIN indexes on JSONB columns for keyword search across locales
CREATE INDEX "idx_facility_names_gin" ON "facility" USING GIN ("names");
CREATE INDEX "idx_facility_addresses_gin" ON "facility" USING GIN ("addresses");

-- B-tree composite index for filter queries
CREATE INDEX "idx_facility_country_type_status" ON "facility" ("country", "facility_type", "operational_status");

-- B-tree partial index for active (non-deleted) records
CREATE INDEX "idx_facility_active" ON "facility" ("deleted_at") WHERE "deleted_at" IS NULL;

-- B-tree index on energy_source.facility_id
CREATE INDEX "idx_energy_source_facility" ON "energy_source" ("facility_id");

-- B-tree index on audit_entry.facility_id for audit history retrieval
CREATE INDEX "idx_audit_entry_facility" ON "audit_entry" ("facility_id");

-- B-tree index on audit_entry.created_at for chronological ordering
CREATE INDEX "idx_audit_entry_created_at" ON "audit_entry" ("created_at");

-- ============================================================
-- UNIQUE CONSTRAINTS
-- ============================================================

-- Unique constraint on (facility_id, emission_scope, reporting_year) for GHG emissions
ALTER TABLE "ghg_emission" ADD CONSTRAINT "uq_ghg_emission_facility_scope_year"
    UNIQUE ("facility_id", "emission_scope", "reporting_year");

-- Unique constraint on (country, energy_source_type, reference_year) for emission factors
ALTER TABLE "emission_factor" ADD CONSTRAINT "uq_emission_factor_country_source_year"
    UNIQUE ("country", "energy_source_type", "reference_year");

-- Unique constraint on user email
ALTER TABLE "user" ADD CONSTRAINT "user_email_key" UNIQUE ("email");

-- Unique constraint for duplicate facility detection:
-- Based on (name_text, country, geolocation) as per requirement 1.4
-- name_text is a denormalized column containing the facility name in the default locale
-- Only applies to active (non-deleted) records
CREATE UNIQUE INDEX "uq_facility_name_country_geolocation" ON "facility" (
    "name_text",
    "country",
    "geolocation"
) WHERE "deleted_at" IS NULL;

-- ============================================================
-- FOREIGN KEYS
-- ============================================================

-- energy_source -> facility
ALTER TABLE "energy_source" ADD CONSTRAINT "energy_source_facility_id_fkey"
    FOREIGN KEY ("facility_id") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ghg_emission -> facility
ALTER TABLE "ghg_emission" ADD CONSTRAINT "ghg_emission_facility_id_fkey"
    FOREIGN KEY ("facility_id") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- audit_entry -> facility (SET NULL on delete to preserve audit entries)
ALTER TABLE "audit_entry" ADD CONSTRAINT "audit_entry_facility_id_fkey"
    FOREIGN KEY ("facility_id") REFERENCES "facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;
