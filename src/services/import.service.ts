/**
 * Import Service
 *
 * Handles bulk CSV import of health facility records:
 * - File size validation (max 10 MB)
 * - RFC 4180 compliant CSV parsing via Papa Parse
 * - Header row validation against expected column names
 * - Row count limit enforcement (max 10,000 data rows)
 * - Per-row validation using CreateFacilityInput logic
 * - Duplicate detection (name_text + country + geolocation)
 * - Skipping invalid/duplicate rows without aborting the import
 * - Returns a detailed import report
 */

import Papa from 'papaparse';
import { PrismaClient } from '@prisma/client';
import { AFRICAN_COUNTRIES } from '../types/countries';
import { ErrorCode, ERROR_CODES } from '../types/api';
import { ServiceResponse, ServiceError } from './facility.service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_ROW_COUNT = 10_000;

/** Expected CSV column headers */
const EXPECTED_HEADERS = [
  'name',
  'facility_type',
  'country',
  'admin_region',
  'city',
  'latitude',
  'longitude',
  'operational_status',
  'ownership',
  'phone',
  'email',
  'website',
  'beds',
] as const;

// Valid enum values
const VALID_FACILITY_TYPES = [
  'hospital',
  'clinic',
  'health_post',
  'pharmacy',
  'laboratory',
  'community_health_center',
];

const VALID_OPERATIONAL_STATUSES = [
  'operational',
  'temporarily_closed',
  'permanently_closed',
  'under_construction',
];

const VALID_OWNERSHIP_VALUES = ['public', 'private'];

// Africa geographic bounds
const AFRICA_LAT_MIN = -35;
const AFRICA_LAT_MAX = 37;
const AFRICA_LON_MIN = -25;
const AFRICA_LON_MAX = 55;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Import report returned after processing a CSV file */
export interface ImportReport {
  totalRows: number;
  imported: number;
  skippedValidation: number;
  skippedDuplicate: number;
  errors: Array<{ row: number; errors: string[] }>;
}

/** Result of a successful import operation */
export interface ImportResult {
  success: true;
  data: ImportReport;
}

/** Result when the file is rejected before processing rows */
export type ImportServiceResponse = ImportResult | ServiceError;

// ---------------------------------------------------------------------------
// ImportService
// ---------------------------------------------------------------------------

export class ImportService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Import facilities from a CSV file buffer.
   *
   * @param fileBuffer - The raw CSV file content as a Buffer
   * @param userId - ID of the admin performing the import
   * @returns Import report with counts and per-row errors, or an error response
   */
  async importCsv(fileBuffer: Buffer, userId: string): Promise<ImportServiceResponse> {
    // 1. Check file size (reject > 10 MB)
    if (fileBuffer.length > MAX_FILE_SIZE_BYTES) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.FILE_TOO_LARGE as ErrorCode,
          message: 'File exceeds the maximum allowed size of 10 MB',
        },
      };
    }

    // 2. Parse CSV using Papa Parse with header: true
    const csvContent = fileBuffer.toString('utf-8');

    let parseResult: Papa.ParseResult<Record<string, string>>;
    try {
      parseResult = Papa.parse<Record<string, string>>(csvContent, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header: string) => header.trim().toLowerCase(),
      });
    } catch {
      return {
        success: false,
        error: {
          code: ERROR_CODES.INVALID_FILE_FORMAT as ErrorCode,
          message: 'File is not valid CSV: parsing failed',
        },
      };
    }

    // Check for parse errors that indicate malformed CSV
    if (parseResult.errors.length > 0) {
      const hasCriticalErrors = parseResult.errors.some(
        (e) => e.type === 'Delimiter' || e.type === 'Quotes',
      );
      if (hasCriticalErrors) {
        return {
          success: false,
          error: {
            code: ERROR_CODES.INVALID_FILE_FORMAT as ErrorCode,
            message: 'File is not valid CSV: malformed structure',
          },
        };
      }
    }

    // 3. Validate header row contains expected columns
    const actualHeaders = parseResult.meta.fields ?? [];
    const missingHeaders = EXPECTED_HEADERS.filter(
      (h) => !actualHeaders.includes(h),
    );

    if (missingHeaders.length > 0) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.INVALID_FILE_FORMAT as ErrorCode,
          message: `CSV header is missing required columns: ${missingHeaders.join(', ')}`,
        },
      };
    }

    // 4. Reject empty files (no data rows)
    const rows = parseResult.data;
    if (rows.length === 0) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.INVALID_FILE_FORMAT as ErrorCode,
          message: 'CSV file contains no data rows',
        },
      };
    }

    // 5. Reject files with > 10,000 data rows
    if (rows.length > MAX_ROW_COUNT) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.FILE_TOO_LARGE as ErrorCode,
          message: `CSV file exceeds maximum of ${MAX_ROW_COUNT} data rows`,
        },
      };
    }

    // 6. Process each row
    const report: ImportReport = {
      totalRows: rows.length,
      imported: 0,
      skippedValidation: 0,
      skippedDuplicate: 0,
      errors: [],
    };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2; // +2 because row 1 is header, data starts at row 2

      // 6a. Validate row
      const validationErrors = this.validateRow(row);
      if (validationErrors.length > 0) {
        report.skippedValidation++;
        report.errors.push({ row: rowNumber, errors: validationErrors });
        continue;
      }

      // 6b. Check duplicate (name_text + country + geolocation)
      const name = row.name.trim();
      const country = row.country.trim();
      const latitude = parseFloat(row.latitude);
      const longitude = parseFloat(row.longitude);

      const isDuplicate = await this.checkDuplicate(name, country, longitude, latitude);
      if (isDuplicate) {
        report.skippedDuplicate++;
        continue;
      }

      // 6c. Store valid, non-duplicate record
      try {
        await this.insertFacility(row, userId);
        report.imported++;
      } catch {
        report.skippedValidation++;
        report.errors.push({
          row: rowNumber,
          errors: ['Failed to insert record into database'],
        });
      }
    }

    return {
      success: true,
      data: report,
    };
  }

  /**
   * Validate a single CSV row against the expected schema.
   * Returns an array of error messages (empty if valid).
   */
  private validateRow(row: Record<string, string>): string[] {
    const errors: string[] = [];

    // Required fields
    const name = row.name?.trim();
    if (!name) {
      errors.push('name is required');
    }

    const facilityType = row.facility_type?.trim();
    if (!facilityType) {
      errors.push('facility_type is required');
    } else if (!VALID_FACILITY_TYPES.includes(facilityType)) {
      errors.push(`facility_type must be one of: ${VALID_FACILITY_TYPES.join(', ')}`);
    }

    const country = row.country?.trim();
    if (!country) {
      errors.push('country is required');
    } else if (!(AFRICAN_COUNTRIES as readonly string[]).includes(country)) {
      errors.push('country must be a recognized African nation');
    }

    const adminRegion = row.admin_region?.trim();
    if (!adminRegion) {
      errors.push('admin_region is required');
    }

    // Geolocation validation
    const latStr = row.latitude?.trim();
    const lonStr = row.longitude?.trim();

    if (!latStr) {
      errors.push('latitude is required');
    } else {
      const lat = parseFloat(latStr);
      if (isNaN(lat)) {
        errors.push('latitude must be a valid number');
      } else if (lat < AFRICA_LAT_MIN || lat > AFRICA_LAT_MAX) {
        errors.push(`latitude must be between ${AFRICA_LAT_MIN} and ${AFRICA_LAT_MAX} (Africa bounds)`);
      }
    }

    if (!lonStr) {
      errors.push('longitude is required');
    } else {
      const lon = parseFloat(lonStr);
      if (isNaN(lon)) {
        errors.push('longitude must be a valid number');
      } else if (lon < AFRICA_LON_MIN || lon > AFRICA_LON_MAX) {
        errors.push(`longitude must be between ${AFRICA_LON_MIN} and ${AFRICA_LON_MAX} (Africa bounds)`);
      }
    }

    const operationalStatus = row.operational_status?.trim();
    if (!operationalStatus) {
      errors.push('operational_status is required');
    } else if (!VALID_OPERATIONAL_STATUSES.includes(operationalStatus)) {
      errors.push(`operational_status must be one of: ${VALID_OPERATIONAL_STATUSES.join(', ')}`);
    }

    const ownership = row.ownership?.trim();
    if (!ownership) {
      errors.push('ownership is required');
    } else if (!VALID_OWNERSHIP_VALUES.includes(ownership)) {
      errors.push(`ownership must be one of: ${VALID_OWNERSHIP_VALUES.join(', ')}`);
    }

    // Optional fields validation
    const bedsStr = row.beds?.trim();
    if (bedsStr) {
      const beds = parseInt(bedsStr, 10);
      if (isNaN(beds)) {
        errors.push('beds must be a valid integer');
      } else if (beds < 0 || beds > 50_000) {
        errors.push('beds must be between 0 and 50000');
      }
    }

    const email = row.email?.trim();
    if (email) {
      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        errors.push('email must be a valid email address');
      }
    }

    const website = row.website?.trim();
    if (website) {
      try {
        new URL(website);
      } catch {
        errors.push('website must be a valid URL');
      }
    }

    return errors;
  }

  /**
   * Check if a facility with the same name, country, and geolocation already exists.
   */
  private async checkDuplicate(
    nameText: string,
    country: string,
    longitude: number,
    latitude: number,
  ): Promise<boolean> {
    const result = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM facility
      WHERE name_text = ${nameText}
        AND country = ${country}
        AND deleted_at IS NULL
        AND ST_Equals(
          geolocation::geometry,
          ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)
        )
    `;

    return Number(result[0].count) > 0;
  }

  /**
   * Insert a facility record from a parsed CSV row.
   */
  private async insertFacility(
    row: Record<string, string>,
    userId: string,
  ): Promise<string> {
    const name = row.name.trim();
    const facilityType = row.facility_type.trim();
    const country = row.country.trim();
    const adminRegion = row.admin_region.trim();
    const city = row.city?.trim() || null;
    const latitude = parseFloat(row.latitude);
    const longitude = parseFloat(row.longitude);
    const operationalStatus = row.operational_status.trim();
    const ownership = row.ownership.trim();

    // Build contactInfo object
    const contactInfo: Record<string, string> = {};
    if (row.phone?.trim()) contactInfo.phone = row.phone.trim();
    if (row.email?.trim()) contactInfo.email = row.email.trim();
    if (row.website?.trim()) contactInfo.website = row.website.trim();
    const contactInfoJson = Object.keys(contactInfo).length > 0 ? contactInfo : null;

    const beds = row.beds?.trim() ? parseInt(row.beds.trim(), 10) : null;

    // names.en = name (use English locale for imports)
    const names = { en: name };

    const result = await this.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO facility (
        id, names, addresses, default_locale, name_text, facility_type,
        country, admin_region, city, ownership, operational_status,
        contact_info, beds, verification_status, energy_verification_status,
        geolocation, created_at, updated_at
      ) VALUES (
        gen_random_uuid(),
        ${JSON.stringify(names)}::jsonb,
        '{}'::jsonb,
        'en',
        ${name},
        ${facilityType},
        ${country},
        ${adminRegion},
        ${city},
        ${ownership},
        ${operationalStatus},
        ${contactInfoJson ? JSON.stringify(contactInfoJson) : null}::jsonb,
        ${beds},
        'unverified',
        'unverified',
        ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography,
        NOW(),
        NOW()
      )
      RETURNING id
    `;

    const facilityId = result[0].id;

    // Create audit entry
    await this.prisma.auditEntry.create({
      data: {
        facilityId,
        userId,
        operationType: 'create',
        changes: { source: 'csv_import', row: row } as any,
      },
    });

    return facilityId;
  }
}
