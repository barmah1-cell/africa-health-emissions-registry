/**
 * Export Service
 *
 * Handles CSV export of health facility records:
 * - Validates search filters (reuses SearchFiltersSchema)
 * - Counts matching records and enforces 50,000 record limit
 * - Generates RFC 4180 compliant, UTF-8 encoded CSV via Papa Parse
 * - Returns header-only CSV for zero matching records
 * - Applies same filter logic as FacilityService.search
 */

import { PrismaClient } from '@prisma/client';
import * as Papa from 'papaparse';
import {
  SearchFiltersSchema,
  SearchFiltersInput,
  validateInput,
} from '../validation/schemas';
import { ErrorCode, ERROR_CODES } from '../types/api';
import { ServiceResponse, ServiceError } from './facility.service';

/** Maximum number of records allowed in a single export */
const MAX_EXPORT_RECORDS = 50_000;

/** CSV column headers matching facility attributes */
const CSV_COLUMNS = [
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
  'verification_status',
] as const;

/** Export result containing CSV content */
export interface ExportResult {
  csv: string;
  recordCount: number;
}

/** Export error with total count for EXPORT_TOO_LARGE */
export interface ExportError extends ServiceError {
  error: ServiceError['error'] & {
    totalCount?: number;
  };
}

export type ExportResponse = ServiceResponse<ExportResult> | ExportError;

/** Raw facility row from the database query */
interface FacilityExportRow {
  name_text: string;
  facility_type: string;
  country: string;
  admin_region: string;
  city: string | null;
  lat: number;
  lon: number;
  operational_status: string;
  ownership: string;
  contact_info: Record<string, string> | null;
  beds: number | null;
  verification_status: string;
}

export class ExportService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Export facilities matching the given filters as CSV.
   *
   * @param filters - Raw search filter input to validate (same as search endpoint)
   * @returns ExportResponse with CSV string or error details
   */
  async exportCsv(filters: unknown): Promise<ExportResponse> {
    // 1. Validate filters using SearchFiltersSchema
    const validation = validateInput(SearchFiltersSchema, filters);

    if (!validation.success) {
      const errors = (validation as { success: false; errors: Array<{ path: string; message: string }> }).errors;
      return {
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR as ErrorCode,
          message: 'Validation failed',
          details: errors.map((e) => ({
            field: e.path,
            message: e.message,
          })),
        },
      };
    }

    const data: SearchFiltersInput = validation.data;

    // 2. Build WHERE conditions (same logic as FacilityService.search)
    const { whereClause, params } = this.buildWhereClause(data);

    // 3. Count matching records
    const countQuery = `SELECT COUNT(*) as count FROM facility f WHERE ${whereClause}`;
    const countResult = await this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      countQuery,
      ...params,
    );
    const totalCount = Number(countResult[0].count);

    // 4. If count > 50,000, return EXPORT_TOO_LARGE error
    if (totalCount > MAX_EXPORT_RECORDS) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.EXPORT_TOO_LARGE as ErrorCode,
          message: `Export exceeds maximum allowed size. Found ${totalCount} records, maximum is ${MAX_EXPORT_RECORDS}.`,
          totalCount,
        },
      };
    }

    // 5. If count == 0, return header-only CSV
    if (totalCount === 0) {
      const headerCsv = Papa.unparse({
        fields: [...CSV_COLUMNS],
        data: [],
      });

      return {
        success: true,
        data: {
          csv: headerCsv,
          recordCount: 0,
        },
      };
    }

    // 6. Fetch all matching records (up to 50,000)
    const dataQuery = `
      SELECT
        f.name_text,
        f.facility_type,
        f.country,
        f.admin_region,
        f.city,
        ST_Y(f.geolocation::geometry) as lat,
        ST_X(f.geolocation::geometry) as lon,
        f.operational_status,
        f.ownership,
        f.contact_info,
        f.beds,
        f.verification_status
      FROM facility f
      WHERE ${whereClause}
      ORDER BY f.name_text ASC, f.id ASC
      LIMIT ${MAX_EXPORT_RECORDS}
    `;

    const rows = await this.prisma.$queryRawUnsafe<FacilityExportRow[]>(
      dataQuery,
      ...params,
    );

    // 7. Transform rows to CSV data
    const csvData = rows.map((row) => {
      const contactInfo = row.contact_info as Record<string, string> | null;
      return {
        name: row.name_text,
        facility_type: row.facility_type,
        country: row.country,
        admin_region: row.admin_region,
        city: row.city ?? '',
        latitude: row.lat,
        longitude: row.lon,
        operational_status: row.operational_status,
        ownership: row.ownership,
        phone: contactInfo?.phone ?? '',
        email: contactInfo?.email ?? '',
        website: contactInfo?.website ?? '',
        beds: row.beds ?? '',
        verification_status: row.verification_status,
      };
    });

    // 8. Generate RFC 4180 compliant CSV using Papa Parse
    const csv = Papa.unparse({
      fields: [...CSV_COLUMNS],
      data: csvData,
    });

    return {
      success: true,
      data: {
        csv,
        recordCount: rows.length,
      },
    };
  }

  /**
   * Build WHERE clause and parameters from validated search filters.
   * Reuses the same filter logic as FacilityService.search.
   */
  private buildWhereClause(data: SearchFiltersInput): {
    whereClause: string;
    params: unknown[];
  } {
    const conditions: string[] = ['f.deleted_at IS NULL'];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (data.country) {
      conditions.push(`f.country = $${paramIndex}`);
      params.push(data.country);
      paramIndex++;
    }

    if (data.facilityType) {
      conditions.push(`f.facility_type = $${paramIndex}`);
      params.push(data.facilityType);
      paramIndex++;
    }

    if (data.operationalStatus) {
      conditions.push(`f.operational_status = $${paramIndex}`);
      params.push(data.operationalStatus);
      paramIndex++;
    }

    if (data.verificationStatus) {
      conditions.push(`f.verification_status = $${paramIndex}`);
      params.push(data.verificationStatus);
      paramIndex++;
    }

    if (data.keyword) {
      const keywordPattern = `%${data.keyword.toLowerCase()}%`;
      conditions.push(
        `(EXISTS (SELECT 1 FROM jsonb_each_text(f.names) AS kv WHERE LOWER(kv.value) LIKE $${paramIndex}) OR EXISTS (SELECT 1 FROM jsonb_each_text(f.addresses) AS kv WHERE LOWER(kv.value) LIKE $${paramIndex}))`,
      );
      params.push(keywordPattern);
      paramIndex++;
    }

    if (data.energySource) {
      conditions.push(
        `EXISTS (SELECT 1 FROM energy_source es WHERE es.facility_id = f.id AND es.energy_type = $${paramIndex})`,
      );
      params.push(data.energySource);
      paramIndex++;
    }

    return {
      whereClause: conditions.join(' AND '),
      params,
    };
  }
}
