/**
 * Geospatial Service
 *
 * Handles geospatial queries for health facilities:
 * - Bounding box search using PostGIS ST_MakeEnvelope
 * - Validates coordinates via Zod schemas
 * - Excludes soft-deleted records
 * - Applies pagination to results
 * - Orders results by facility name ascending for consistency
 */

import { PrismaClient } from '@prisma/client';
import {
  BoundingBoxQuerySchema,
  BoundingBoxQueryInput,
  ProximityQuerySchema,
  PaginationParamsSchema,
  validateInput,
} from '../validation/schemas';
import { ErrorCode, ERROR_CODES, PaginatedResult } from '../types/api';
import {
  ServiceResponse,
  ServiceResult,
  ServiceError,
  FacilityResponse,
  computeStaleIndicator,
} from './facility.service';

/** Facility response extended with distance information */
export interface FacilityWithDistance extends FacilityResponse {
  distanceKm: number;
}

/** Default pagination values */
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 100;

export class GeospatialService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Find facilities within a given radius of a point, ordered by distance.
   *
   * Uses PostGIS ST_DWithin for efficient radius filtering.
   * Validates coordinates (lat -90..90, lon -180..180) and radius (0.1-1000 km).
   * Excludes soft-deleted records.
   * Orders results by distance from nearest to farthest.
   * Applies pagination.
   *
   * @param query - Raw proximity query input (latitude, longitude, radiusKm)
   * @param pagination - Optional pagination parameters (page, pageSize)
   * @returns Paginated list of facilities with distance, or validation error
   */
  async findNearby(
    query: unknown,
    pagination?: unknown,
  ): Promise<ServiceResponse<PaginatedResult<FacilityWithDistance>>> {
    // 1. Validate proximity query parameters
    const queryValidation = validateInput(ProximityQuerySchema, query);

    if (!queryValidation.success) {
      const validationError = queryValidation as { success: false; errors: Array<{ path: string; message: string }> };
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

    const { latitude, longitude, radiusKm } = queryValidation.data;

    // 2. Validate pagination parameters (use defaults if not provided)
    let page = DEFAULT_PAGE;
    let pageSize = DEFAULT_PAGE_SIZE;

    if (pagination !== undefined && pagination !== null) {
      const paginationValidation = validateInput(PaginationParamsSchema, pagination);

      if (!paginationValidation.success) {
        const paginationError = paginationValidation as { success: false; errors: Array<{ path: string; message: string }> };
        return {
          success: false,
          error: {
            code: ERROR_CODES.VALIDATION_ERROR as ErrorCode,
            message: 'Validation failed',
            details: paginationError.errors.map((e) => ({
              field: e.path,
              message: e.message,
            })),
          },
        };
      }

      page = paginationValidation.data.page!;
      pageSize = paginationValidation.data.pageSize!;
    }

    // 3. Convert radius from km to meters for PostGIS
    const radiusMeters = radiusKm * 1000;

    // 4. Calculate pagination offset
    const offset = (page - 1) * pageSize;

    // 5. Count total matching facilities within radius
    const countResult = await this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) as count
       FROM facility f
       WHERE f.deleted_at IS NULL
         AND ST_DWithin(
           f.geolocation,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
           $3
         )`,
      longitude,
      latitude,
      radiusMeters,
    );

    const totalCount = Number(countResult[0].count);

    // 6. If no results, return empty paginated result
    if (totalCount === 0) {
      return {
        success: true,
        data: {
          data: [],
          pagination: {
            totalCount: 0,
            currentPage: page,
            totalPages: 0,
            pageSize,
          },
        },
      };
    }

    // 7. Query facilities with distance, ordered by distance ASC
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; distance_meters: number }>
    >(
      `SELECT f.id,
              ST_Distance(
                f.geolocation,
                ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
              ) as distance_meters
       FROM facility f
       WHERE f.deleted_at IS NULL
         AND ST_DWithin(
           f.geolocation,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
           $3
         )
       ORDER BY distance_meters ASC
       LIMIT $4 OFFSET $5`,
      longitude,
      latitude,
      radiusMeters,
      pageSize,
      offset,
    );

    // 8. Fetch full facility records and attach distance
    const facilities: FacilityWithDistance[] = [];

    for (const row of rows) {
      const facility = await this.getFacilityById(row.id);
      facilities.push({
        ...facility,
        distanceKm: Number(row.distance_meters) / 1000,
      });
    }

    // 9. Return paginated result
    const totalPages = Math.ceil(totalCount / pageSize);

    return {
      success: true,
      data: {
        data: facilities,
        pagination: {
          totalCount,
          currentPage: page,
          totalPages,
          pageSize,
        },
      },
    };
  }

  /**
   * Finds facilities within a bounding box defined by SW and NE corners.
   *
   * Uses PostGIS ST_MakeEnvelope for spatial filtering.
   * Validates coordinates via BoundingBoxQuerySchema.
   * Excludes soft-deleted records.
   * Orders results by name_text ASC.
   * Applies pagination.
   *
   * @param params - Raw bounding box query parameters
   * @param pagination - Optional pagination parameters (page, pageSize)
   * @returns Paginated list of facilities within the bounding box
   */
  async findInBoundingBox(
    params: unknown,
    pagination?: unknown,
  ): Promise<ServiceResponse<PaginatedResult<FacilityResponse>>> {
    // 1. Validate bounding box coordinates
    const bboxValidation = validateInput(BoundingBoxQuerySchema, params);

    if (!bboxValidation.success) {
      const validationError = bboxValidation as { success: false; errors: Array<{ path: string; message: string }> };
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

    const bbox = bboxValidation.data as BoundingBoxQueryInput;

    // 2. Validate pagination if provided
    let page = DEFAULT_PAGE;
    let pageSize = DEFAULT_PAGE_SIZE;

    if (pagination !== undefined && pagination !== null) {
      const paginationValidation = validateInput(PaginationParamsSchema, pagination);

      if (!paginationValidation.success) {
        const paginationError = paginationValidation as { success: false; errors: Array<{ path: string; message: string }> };
        return {
          success: false,
          error: {
            code: ERROR_CODES.VALIDATION_ERROR as ErrorCode,
            message: 'Validation failed',
            details: paginationError.errors.map((e) => ({
              field: e.path,
              message: e.message,
            })),
          },
        };
      }

      page = paginationValidation.data.page!;
      pageSize = paginationValidation.data.pageSize!;
    }

    const offset = (page - 1) * pageSize;

    // 3. Count total matching facilities
    const countResult = await this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) as count
       FROM facility f
       WHERE f.deleted_at IS NULL
         AND ST_Intersects(
           f.geolocation::geometry,
           ST_MakeEnvelope($1, $2, $3, $4, 4326)
         )`,
      bbox.swLongitude,
      bbox.swLatitude,
      bbox.neLongitude,
      bbox.neLatitude,
    );

    const totalCount = Number(countResult[0].count);

    // 4. If no matches, return empty collection
    if (totalCount === 0) {
      return {
        success: true,
        data: {
          data: [],
          pagination: {
            totalCount: 0,
            currentPage: page,
            totalPages: 0,
            pageSize,
          },
        },
      };
    }

    // 5. Fetch matching facility IDs with pagination
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT f.id
       FROM facility f
       WHERE f.deleted_at IS NULL
         AND ST_Intersects(
           f.geolocation::geometry,
           ST_MakeEnvelope($1, $2, $3, $4, 4326)
         )
       ORDER BY f.name_text ASC
       LIMIT $5 OFFSET $6`,
      bbox.swLongitude,
      bbox.swLatitude,
      bbox.neLongitude,
      bbox.neLatitude,
      pageSize,
      offset,
    );

    // 6. Fetch full records for each matched facility
    const facilities: FacilityResponse[] = [];
    for (const row of rows) {
      const facility = await this.getFacilityById(row.id);
      facilities.push(facility);
    }

    // 7. Return paginated result
    const totalPages = Math.ceil(totalCount / pageSize);

    return {
      success: true,
      data: {
        data: facilities,
        pagination: {
          totalCount,
          currentPage: page,
          totalPages,
          pageSize,
        },
      },
    };
  }

  /**
   * Retrieve a facility by ID and map it to the response format.
   * Replicates the pattern from FacilityService for consistency.
   */
  private async getFacilityById(id: string): Promise<FacilityResponse> {
    const facility = await this.prisma.facility.findUniqueOrThrow({
      where: { id },
      include: {
        energySources: true,
      },
    });

    // Get geolocation coordinates using raw SQL
    const geoResult = await this.prisma.$queryRaw<
      Array<{ lat: number; lon: number }>
    >`
      SELECT
        ST_Y(geolocation::geometry) as lat,
        ST_X(geolocation::geometry) as lon
      FROM facility
      WHERE id = ${id}::uuid
    `;

    const geo = geoResult[0];

    const hasEnergySources = facility.energySources.length > 0;

    return {
      id: facility.id,
      names: facility.names as Record<string, string>,
      addresses: facility.addresses as Record<string, string>,
      defaultLocale: facility.defaultLocale,
      nameText: facility.nameText,
      facilityType: facility.facilityType,
      country: facility.country,
      adminRegion: facility.adminRegion,
      city: facility.city,
      ownership: facility.ownership,
      operationalStatus: facility.operationalStatus,
      geolocation: { latitude: geo.lat, longitude: geo.lon },
      contactInfo: facility.contactInfo as Record<string, string> | null,
      beds: facility.beds,
      energyProfile: hasEnergySources
        ? facility.energySources.map((es) => ({
            id: es.id,
            energyType: es.energyType,
            consumptionKwhYear: es.consumptionKwhYear
              ? Number(es.consumptionKwhYear)
              : null,
          }))
        : 'unknown',
      verificationStatus: facility.verificationStatus,
      verificationDate: facility.verificationDate,
      energyVerificationStatus: facility.energyVerificationStatus,
      energyVerificationDate: facility.energyVerificationDate,
      staleIndicator: computeStaleIndicator(
        facility.verificationStatus,
        facility.verificationDate,
      ),
      energyStaleIndicator: computeStaleIndicator(
        facility.energyVerificationStatus,
        facility.energyVerificationDate,
      ),
      createdAt: facility.createdAt,
      updatedAt: facility.updatedAt,
    };
  }
}
