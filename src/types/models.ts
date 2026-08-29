/**
 * Core data model interfaces for the Africa Health Facilities Registry.
 */

import type {
  UUID,
  Locale,
  EnergyType,
  EmissionScope,
  VerificationMethod,
  Ownership,
  OperationType,
} from './enums';
import type { FacilityType, OperationalStatus } from './enums';

/** Geographic coordinates (WGS84) */
export interface GeoPoint {
  /** Latitude: -90 to 90 (Africa bounds: -35 to 37) */
  latitude: number;
  /** Longitude: -180 to 180 (Africa bounds: -25 to 55) */
  longitude: number;
}

/** Multilingual text keyed by locale code. Max 20 locales, max 500 chars per value. */
export interface LocalizedText {
  [locale: string]: string;
}

/** Contact information for a facility */
export interface ContactInfo {
  phone?: string;
  email?: string;
  website?: string;
}

/** A single energy source entry within a facility's energy profile */
export interface EnergySourceEntry {
  id: UUID;
  energyType: EnergyType;
  /** Annual consumption in kWh (0.01 to 999,999,999.99) */
  consumptionKwhYear?: number;
}

/** A complete health facility record */
export interface FacilityRecord {
  id: UUID;
  names: LocalizedText;
  addresses: LocalizedText;
  defaultLocale: Locale;
  facilityType: FacilityType;
  country: string;
  adminRegion: string;
  city?: string;
  ownership: Ownership;
  operationalStatus: OperationalStatus;
  geolocation: GeoPoint;
  contactInfo?: ContactInfo;
  /** Number of beds (0 to 50,000) */
  beds?: number;
  /** Energy sources or 'unknown' if no data provided */
  energyProfile: EnergySourceEntry[] | 'unknown';
  verificationStatus: VerificationMethod;
  verificationDate?: Date;
  energyVerificationStatus: VerificationMethod;
  energyVerificationDate?: Date;
  /** True if verification_date > 24 months ago or status is 'unverified' with no date */
  staleIndicator: boolean;
  /** True if energy verification_date > 24 months ago or energy status is 'unverified' with no date */
  energyStaleIndicator: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** GHG emission entry for a facility */
export interface GhgEmission {
  id: UUID;
  facilityId: UUID;
  emissionScope: EmissionScope;
  /** Value in tonnes CO2 equivalent (0 to 999,999,999.99) */
  valueTonnesCo2e: number;
  /** Reporting period year (2000 to current year) */
  reportingYear: number;
}

/** Country-specific emission factor for estimating GHG emissions */
export interface EmissionFactor {
  id: UUID;
  country: string;
  energySourceType: EnergyType;
  /** Factor in kg CO2e per kWh (> 0, <= 100) */
  factorKgCo2ePerKwh: number;
  /** Reference year (1990 to current year) */
  referenceYear: number;
}

/** Audit trail entry recording a change to a facility record */
export interface AuditEntry {
  id: UUID;
  facilityId: UUID;
  userId: string;
  operationType: OperationType;
  /** Map of field name to old/new values. Old is null for creates, new is null for deletes. */
  changes: Record<string, { oldValue: unknown; newValue: unknown }>;
  createdAt: Date;
}

/** Calculated emission estimate for a facility */
export interface EmissionEstimate {
  facilityId: UUID;
  energySourceType: EnergyType;
  consumptionKwh: number;
  emissionFactorKgCo2ePerKwh: number;
  referenceYear: number;
  /** Estimated emissions in tonnes CO2e */
  estimatedTonnesCo2e: number;
}

/** Summary report from a bulk CSV import operation */
export interface ImportReport {
  totalRows: number;
  imported: number;
  skippedValidation: number;
  skippedDuplicate: number;
  errors: Array<{ row: number; errors: string[] }>;
}

/** Minimal facility projection for rendering a single map marker. */
export interface MapMarker {
  id: UUID;
  latitude: number;
  longitude: number;
  facilityType: FacilityType;
  /** Denormalized display name used for the hover tooltip. */
  nameText: string;
  country: string;
  /** True when verification is stale/unverified (drives marker styling). */
  staleIndicator: boolean;
}

/** Response envelope for the slim map endpoint. */
export interface MapMarkersResult {
  markers: MapMarker[];
  /** Number of markers returned (equals markers.length). */
  count: number;
}
