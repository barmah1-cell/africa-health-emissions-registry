/**
 * Map Service
 *
 * Provides a slim marker projection for the lightweight map endpoint:
 * - Returns only the fields required to draw/label a Leaflet marker
 * - Optional bounding-box viewport filtering (PostGIS ST_MakeEnvelope + ST_Intersects)
 * - Optional attribute filters (country, facilityType, operationalStatus)
 * - Excludes soft-deleted records (deleted_at IS NULL)
 * - Orders by name_text ASC for deterministic output (stable ETags)
 *
 * All user-supplied values are passed as bound SQL parameters (never
 * string-interpolated) to prevent SQL injection.
 */

import { PrismaClient } from '@prisma/client';
import { MapMarkersQuerySchema, validateInput, MAP_MARKERS_DEFAULT_CAP } from '../validation/schemas';
import { ErrorCode, ERROR_CODES } from '../types/api';
import { FacilityType } from '../types/enums';
import { MapMarker, MapMarkersResult } from '../types/models';
import { ServiceResponse, computeStaleIndicator } from './facility.service';

/** Shape of a raw SQL row returned by the slim marker projection query. */
interface MapMarkerRow {
  id: string;
  latitude: number;
  longitude: number;
  facility_type: string;
  name_text: string;
  country: string;
  verification_status: string;
  verification_date: Date | null;
}

export class MapService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Return slim marker projections, optionally constrained to a bounding box
   * and/or attribute filters. Excludes soft-deleted facilities. Ordered by
   * name_text ASC for deterministic output (stable ETags).
   *
   * @param query - Raw query params (bbox corners + optional filters)
   * @returns ServiceResponse<MapMarkersResult>
   */
  async getMapMarkers(query: unknown): Promise<ServiceResponse<MapMarkersResult>> {
    // 1. Validate query parameters (aggregated, non-fail-fast)
    const validation = validateInput(MapMarkersQuerySchema, query);

    if (!validation.success) {
      const validationError = validation as {
        success: false;
        errors: Array<{ path: string; message: string }>;
      };
      return {
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR as ErrorCode,
          message: 'Validation failed',
          details: validationError.errors.map((e) => ({
            field: e.path,
            message: e.message,
          })),
        },
      };
    }

    const data = validation.data;

    // 2. Assemble the WHERE clause from parameterized fragments.
    //    Base condition excludes soft-deleted records.
    const conditions: string[] = ['f.deleted_at IS NULL'];
    const params: unknown[] = [];
    let p = 0;

    // Optional bounding box (all-or-nothing, enforced by schema)
    if (data.swLatitude !== undefined) {
      conditions.push(
        `ST_Intersects(
           f.geolocation::geometry,
           ST_MakeEnvelope($${++p}, $${++p}, $${++p}, $${++p}, 4326)
         )`,
      );
      params.push(
        data.swLongitude,
        data.swLatitude,
        data.neLongitude,
        data.neLatitude,
      );
    }

    // Optional attribute filters (bound params, never interpolated)
    if (data.country !== undefined) {
      conditions.push(`f.country = $${++p}`);
      params.push(data.country);
    }
    if (data.facilityType !== undefined) {
      conditions.push(`f.facility_type = $${++p}`);
      params.push(data.facilityType);
    }
    if (data.operationalStatus !== undefined) {
      conditions.push(`f.operational_status = $${++p}`);
      params.push(data.operationalStatus);
    }

    // 3. Apply the marker cap. Fetch cap + 1 rows so we can detect whether the
    //    result was truncated (more facilities match than the cap allows).
    const cap = data.limit ?? MAP_MARKERS_DEFAULT_CAP;
    const fetchLimit = cap + 1;
    const limitPlaceholder = `$${++p}`;
    params.push(fetchLimit);

    // 4. Build the slim projection query.
    //    verification_status/verification_date are selected only to compute
    //    staleIndicator and are NOT returned to the client.
    const sql = `
      SELECT
        f.id,
        ST_Y(f.geolocation::geometry) AS latitude,
        ST_X(f.geolocation::geometry) AS longitude,
        f.facility_type,
        f.name_text,
        f.country,
        f.verification_status,
        f.verification_date
      FROM facility f
      WHERE ${conditions.join(' AND ')}
      ORDER BY f.name_text ASC
      LIMIT ${limitPlaceholder}
    `;

    // 5. Execute the parameterized raw query
    const rows = await this.prisma.$queryRawUnsafe<MapMarkerRow[]>(sql, ...params);

    // 6. Detect truncation: if we got more than `cap` rows, the result is
    //    capped. Trim back to the cap for the response.
    const capped = rows.length > cap;
    const visibleRows = capped ? rows.slice(0, cap) : rows;

    // 7. Map rows to slim markers, deriving staleIndicator from the reused helper
    const markers: MapMarker[] = visibleRows.map((r) => ({
      id: r.id,
      latitude: r.latitude,
      longitude: r.longitude,
      facilityType: r.facility_type as FacilityType,
      nameText: r.name_text,
      country: r.country,
      staleIndicator: computeStaleIndicator(
        r.verification_status,
        r.verification_date,
      ),
    }));

    return { success: true, data: { markers, count: markers.length, capped } };
  }
}
