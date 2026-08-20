/**
 * Core type aliases and enums for the Africa Health Facilities Registry.
 */

/** UUID string type alias */
export type UUID = string;

/** Supported locale codes - extensible beyond the base set */
export type Locale = 'en' | 'fr' | 'ar' | 'pt' | 'sw' | string;

/** Classification of health facility */
export enum FacilityType {
  Hospital = 'hospital',
  Clinic = 'clinic',
  HealthPost = 'health_post',
  Pharmacy = 'pharmacy',
  Laboratory = 'laboratory',
  CommunityHealthCenter = 'community_health_center',
}

/** Current functioning state of a facility */
export enum OperationalStatus {
  Operational = 'operational',
  TemporarilyClosed = 'temporarily_closed',
  PermanentlyClosed = 'permanently_closed',
  UnderConstruction = 'under_construction',
}

/** Type of energy source used by a facility */
export enum EnergyType {
  DieselGenerator = 'diesel_generator',
  Solar = 'solar',
  Wind = 'wind',
  GridElectricity = 'grid_electricity',
  Hybrid = 'hybrid',
}

/** GHG Protocol emission scope classification */
export enum EmissionScope {
  Scope1 = 'scope_1',
  Scope2 = 'scope_2',
  Scope3 = 'scope_3',
}

/** Method by which facility data was verified */
export enum VerificationMethod {
  FieldVerified = 'field_verified',
  SelfReported = 'self_reported',
  ImportedSecondary = 'imported_secondary',
  Unverified = 'unverified',
}

/** User role within the system */
export enum UserRole {
  User = 'user',
  Admin = 'admin',
}

/** Ownership type of a facility */
export type Ownership = 'public' | 'private';

/** Audit operation types */
export type OperationType = 'create' | 'update' | 'delete';
