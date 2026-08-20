/**
 * Facility Service
 *
 * Handles creation of health facility records including:
 * - Input validation via Zod schema (returns all errors)
 * - Uniqueness constraint enforcement (name + country + geolocation)
 * - Multilingual names/addresses stored as JSONB
 * - Default verification_status set to 'unverified'
 * - Energy profile marked as 'unknown' if not provided
 * - Default locale determination
 * - Audit entry creation for the create operation
 */

import { PrismaClient, Prisma } from '@prisma/client';
import {
  CreateFacilityInputSchema,
  CreateFacilityInput,
  UpdateFacilityInputSchema,
  UpdateFacilityInput,
  SearchFiltersSchema,
  SearchFiltersInput,
  PaginationParamsSchema,
  PaginationParamsInput,
  validateInput,
} from '../validation/schemas';
import { ErrorCode, ERROR_CODES, PaginatedResult } from '../types/api';
import { resolveLocalizedText, determineDefaultLocale } from '../utils/locale';

/** Result type for service operations */
export interface ServiceResult<T> {
  success: true;
  data: T;
}

/** Error result type */
export interface ServiceError {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: Array<{ field: string; message: string; value?: unknown }>;
  };
}

export type ServiceResponse<T> = ServiceResult<T> | ServiceError;

/** Facility record as returned from the service */
export interface FacilityResponse {
  id: string;
  names: Record<string, string>;
  addresses: Record<string, string>;
  defaultLocale: string;
  nameText: string;
  facilityType: string;
  country: string;
  adminRegion: string;
  city: string | null;
  ownership: string;
  operationalStatus: string;
  geolocation: { latitude: number; longitude: number };
  contactInfo: Record<string, string> | null;
  beds: number | null;
  energyProfile: Array<{ id: string; energyType: string; consumptionKwhYear: number | null }> | 'unknown';
  verificationStatus: string;
  verificationDate: Date | null;
  energyVerificationStatus: string;
  energyVerificationDate: Date | null;
  staleIndicator: boolean;
  energyStaleIndicator: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Facility response with locale-resolved name/address */
export interface FacilityResponseWithLocale extends FacilityResponse {
  name: string;
  address: string;
}

/** UUID format regex pattern */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Compute whether a verification status is considered stale.
 * Stale if: verification_date > 24 months ago OR status is 'unverified' with no date.
 */
export function computeStaleIndicator(
  verificationStatus: string,
  verificationDate: Date | null,
): boolean {
  if (verificationStatus === 'unverified' && !verificationDate) {
    return true;
  }
  if (verificationDate) {
    const twentyFourMonthsAgo = new Date();
    twentyFourMonthsAgo.setMonth(twentyFourMonthsAgo.getMonth() - 24);
    return verificationDate < twentyFourMonthsAgo;
  }
  return false;
}

export class FacilityService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Creates a new health facility record.
   *
   * @param input - Raw input data to validate and persist
   * @param userId - ID of the authenticated user performing the operation
   * @returns ServiceResponse with the created facility or error details
   */
  async create(
    input: unknown,
    userId: string,
  ): Promise<ServiceResponse<FacilityResponse>> {
    // 1. Validate input using Zod schema (returns all validation errors)
    const validation = validateInput(CreateFacilityInputSchema, input);

    if (!validation.success) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR as ErrorCode,
          message: 'Validation failed',
          details: validation.errors.map((e) => ({
            field: e.path,
            message: e.message,
          })),
        },
      };
    }

    const data: CreateFacilityInput = validation.data;

    // 2. Determine default locale
    const defaultLocale = determineDefaultLocale(data.names, data.defaultLocale);

    // 3. Compute denormalized nameText from the default locale name
    const nameText = data.names[defaultLocale] ?? Object.values(data.names)[0];

    // 4. Determine verification_status (default to 'unverified')
    const verificationStatus = data.verificationStatus ?? 'unverified';

    // 5. Determine energy profile status
    const hasEnergyProfile = !!(data.energyProfile && data.energyProfile.length > 0);

    // 6. Prepare addresses (default to empty object if not provided)
    const addresses = data.addresses ?? {};

    // 7. Check uniqueness constraint (name_text + country + geolocation)
    //    Uses raw SQL because geolocation is a PostGIS type
    const duplicateCheck = await this.checkDuplicate(
      nameText,
      data.country,
      data.geolocation.longitude,
      data.geolocation.latitude,
    );

    if (duplicateCheck) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.DUPLICATE_RECORD as ErrorCode,
          message: 'A facility with the same name, country, and location already exists',
        },
      };
    }

    // 8. Create the facility using raw SQL for the geolocation field
    try {
      const facilityId = await this.insertFacility({
        names: data.names,
        addresses,
        defaultLocale,
        nameText,
        facilityType: data.facilityType,
        country: data.country,
        adminRegion: data.adminRegion,
        city: data.city ?? null,
        ownership: data.ownership,
        operationalStatus: data.operationalStatus,
        contactInfo: data.contactInfo ?? null,
        beds: data.beds ?? null,
        verificationStatus,
        longitude: data.geolocation.longitude,
        latitude: data.geolocation.latitude,
      });

      // 9. Create energy source entries if energy profile is provided
      if (hasEnergyProfile && data.energyProfile) {
        await this.createEnergySources(facilityId, data.energyProfile);
      }

      // 10. Create audit entry for the create operation
      await this.createAuditEntry(facilityId, userId, data);

      // 11. Retrieve the complete facility record
      const facility = await this.getFacilityById(facilityId, hasEnergyProfile);

      return {
        success: true,
        data: facility,
      };
    } catch (error) {
      // Handle Prisma unique constraint violation (P2002)
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return {
          success: false,
          error: {
            code: ERROR_CODES.DUPLICATE_RECORD as ErrorCode,
            message: 'A facility with the same name, country, and location already exists',
          },
        };
      }
      throw error;
    }
  }

  /**
   * Retrieves a single facility by its unique ID.
   *
   * @param id - The UUID of the facility to retrieve
   * @param locale - Optional preferred locale for name/address resolution
   * @returns ServiceResponse with the facility or error details
   */
  async getById(
    id: string,
    locale?: string,
  ): Promise<ServiceResponse<FacilityResponseWithLocale>> {
    // 1. Validate UUID format
    if (!UUID_REGEX.test(id)) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.INVALID_FORMAT as ErrorCode,
          message: 'Invalid facility ID format. Expected a valid UUID.',
        },
      };
    }

    // 2. Fetch the facility, excluding soft-deleted records
    const facility = await this.prisma.facility.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        energySources: true,
      },
    });

    if (!facility) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND as ErrorCode,
          message: `Facility with ID '${id}' not found`,
        },
      };
    }

    // 3. Get geolocation coordinates using raw SQL (PostGIS)
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

    // 4. Determine energy profile
    const hasEnergySources = facility.energySources.length > 0;
    const energyProfile: FacilityResponse['energyProfile'] = hasEnergySources
      ? facility.energySources.map((es) => ({
          id: es.id,
          energyType: es.energyType,
          consumptionKwhYear: es.consumptionKwhYear
            ? Number(es.consumptionKwhYear)
            : null,
        }))
      : 'unknown';

    // 5. Compute stale indicators
    const staleIndicator = computeStaleIndicator(
      facility.verificationStatus,
      facility.verificationDate,
    );
    const energyStaleIndicator = computeStaleIndicator(
      facility.energyVerificationStatus,
      facility.energyVerificationDate,
    );

    // 6. Resolve locale for name and address
    const names = facility.names as Record<string, string>;
    const addresses = facility.addresses as Record<string, string>;
    const defaultLocale = facility.defaultLocale;

    const name = resolveLocalizedText(names, locale, defaultLocale);
    const address = resolveLocalizedText(addresses, locale, defaultLocale);

    return {
      success: true,
      data: {
        id: facility.id,
        names,
        addresses,
        defaultLocale,
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
        energyProfile,
        verificationStatus: facility.verificationStatus,
        verificationDate: facility.verificationDate,
        energyVerificationStatus: facility.energyVerificationStatus,
        energyVerificationDate: facility.energyVerificationDate,
        staleIndicator,
        energyStaleIndicator,
        createdAt: facility.createdAt,
        updatedAt: facility.updatedAt,
        name,
        address,
      },
    };
  }

  /**
   * Updates an existing health facility record with partial data.
   *
   * @param id - UUID of the facility to update
   * @param input - Raw partial input data to validate and apply
   * @param userId - ID of the authenticated user performing the operation
   * @returns ServiceResponse with the updated facility or error details
   */
  async update(
    id: string,
    input: unknown,
    userId: string,
  ): Promise<ServiceResponse<FacilityResponse>> {
    // 1. Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.INVALID_FORMAT as ErrorCode,
          message: 'Invalid facility ID format. Expected a UUID.',
        },
      };
    }

    // 2. Validate input using UpdateFacilityInputSchema
    const validation = validateInput(UpdateFacilityInputSchema, input);

    if (!validation.success) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR as ErrorCode,
          message: 'Validation failed',
          details: validation.errors.map((e) => ({
            field: e.path,
            message: e.message,
          })),
        },
      };
    }

    const data: UpdateFacilityInput = validation.data;

    // 3. Retrieve existing facility (exclude soft-deleted)
    const existing = await this.prisma.facility.findUnique({
      where: { id },
      include: { energySources: true },
    });

    if (!existing || existing.deletedAt !== null) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND as ErrorCode,
          message: 'Facility not found',
        },
      };
    }

    // Get existing geolocation
    const existingGeo = await this.prisma.$queryRaw<
      Array<{ lat: number; lon: number }>
    >`
      SELECT
        ST_Y(geolocation::geometry) as lat,
        ST_X(geolocation::geometry) as lon
      FROM facility
      WHERE id = ${id}::uuid
    `;
    const currentGeo = existingGeo[0];

    // 4. Detect actual changes by comparing submitted fields with existing values
    const changes: Record<string, { oldValue: unknown; newValue: unknown }> = {};

    if (data.names !== undefined && JSON.stringify(data.names) !== JSON.stringify(existing.names)) {
      changes.names = { oldValue: existing.names, newValue: data.names };
    }
    if (data.addresses !== undefined && JSON.stringify(data.addresses) !== JSON.stringify(existing.addresses)) {
      changes.addresses = { oldValue: existing.addresses, newValue: data.addresses };
    }
    if (data.facilityType !== undefined && data.facilityType !== existing.facilityType) {
      changes.facilityType = { oldValue: existing.facilityType, newValue: data.facilityType };
    }
    if (data.country !== undefined && data.country !== existing.country) {
      changes.country = { oldValue: existing.country, newValue: data.country };
    }
    if (data.adminRegion !== undefined && data.adminRegion !== existing.adminRegion) {
      changes.adminRegion = { oldValue: existing.adminRegion, newValue: data.adminRegion };
    }
    if (data.city !== undefined && data.city !== existing.city) {
      changes.city = { oldValue: existing.city, newValue: data.city };
    }
    if (data.operationalStatus !== undefined && data.operationalStatus !== existing.operationalStatus) {
      changes.operationalStatus = { oldValue: existing.operationalStatus, newValue: data.operationalStatus };
    }
    if (data.ownership !== undefined && data.ownership !== existing.ownership) {
      changes.ownership = { oldValue: existing.ownership, newValue: data.ownership };
    }
    if (data.contactInfo !== undefined && JSON.stringify(data.contactInfo) !== JSON.stringify(existing.contactInfo)) {
      changes.contactInfo = { oldValue: existing.contactInfo, newValue: data.contactInfo };
    }
    if (data.beds !== undefined && data.beds !== existing.beds) {
      changes.beds = { oldValue: existing.beds, newValue: data.beds };
    }
    if (data.verificationStatus !== undefined && data.verificationStatus !== existing.verificationStatus) {
      changes.verificationStatus = { oldValue: existing.verificationStatus, newValue: data.verificationStatus };
    }
    if (data.defaultLocale !== undefined && data.defaultLocale !== existing.defaultLocale) {
      changes.defaultLocale = { oldValue: existing.defaultLocale, newValue: data.defaultLocale };
    }
    if (data.geolocation !== undefined) {
      const geoChanged =
        data.geolocation.latitude !== currentGeo.lat ||
        data.geolocation.longitude !== currentGeo.lon;
      if (geoChanged) {
        changes.geolocation = {
          oldValue: { latitude: currentGeo.lat, longitude: currentGeo.lon },
          newValue: data.geolocation,
        };
      }
    }

    // If no actual changes detected, return the existing record as-is
    if (Object.keys(changes).length === 0) {
      const hasEnergy = existing.energySources.length > 0;
      const facility = await this.getFacilityById(id, hasEnergy);
      return { success: true, data: facility };
    }

    // 5. Check uniqueness if name/country/geolocation are being updated
    const newNames = data.names ?? (existing.names as Record<string, string>);
    const newDefaultLocale = data.defaultLocale ?? existing.defaultLocale;
    const newNameText = newNames[newDefaultLocale] ?? Object.values(newNames)[0];
    const newCountry = data.country ?? existing.country;
    const newGeoLat = data.geolocation?.latitude ?? currentGeo.lat;
    const newGeoLon = data.geolocation?.longitude ?? currentGeo.lon;

    if (changes.names || changes.country || changes.geolocation || changes.defaultLocale) {
      const duplicateCheck = await this.checkDuplicateExcluding(
        newNameText,
        newCountry,
        newGeoLon,
        newGeoLat,
        id,
      );

      if (duplicateCheck) {
        return {
          success: false,
          error: {
            code: ERROR_CODES.DUPLICATE_RECORD as ErrorCode,
            message: 'A facility with the same name, country, and location already exists',
          },
        };
      }
    }

    // 6. Build update data for Prisma (non-geo fields)
    const updateData: Record<string, unknown> = {};
    if (changes.names) updateData.names = data.names;
    if (changes.addresses) updateData.addresses = data.addresses;
    if (changes.facilityType) updateData.facilityType = data.facilityType;
    if (changes.country) updateData.country = data.country;
    if (changes.adminRegion) updateData.adminRegion = data.adminRegion;
    if (changes.city) updateData.city = data.city;
    if (changes.operationalStatus) updateData.operationalStatus = data.operationalStatus;
    if (changes.ownership) updateData.ownership = data.ownership;
    if (changes.contactInfo) updateData.contactInfo = data.contactInfo ?? Prisma.JsonNull;
    if (changes.beds) updateData.beds = data.beds;
    if (changes.verificationStatus) {
      updateData.verificationStatus = data.verificationStatus;
      // When verification status changes, set verification_date to current timestamp
      updateData.verificationDate = new Date();
      changes.verificationDate = {
        oldValue: existing.verificationDate,
        newValue: updateData.verificationDate,
      };
    }
    if (changes.defaultLocale) updateData.defaultLocale = data.defaultLocale;

    // Update nameText if names or defaultLocale changed
    if (changes.names || changes.defaultLocale) {
      updateData.nameText = newNameText;
    }

    // 7. Apply the update
    if (Object.keys(updateData).length > 0) {
      await this.prisma.facility.update({
        where: { id },
        data: updateData,
      });
    }

    // 8. Use raw SQL to update geolocation if it changed
    if (changes.geolocation && data.geolocation) {
      await this.prisma.$executeRaw`
        UPDATE facility
        SET geolocation = ST_SetSRID(ST_MakePoint(${data.geolocation.longitude}, ${data.geolocation.latitude}), 4326)::geography,
            updated_at = NOW()
        WHERE id = ${id}::uuid
      `;
    }

    // 9. Create audit entry recording only the fields that actually changed
    await this.prisma.auditEntry.create({
      data: {
        facilityId: id,
        userId,
        operationType: 'update',
        changes: changes as unknown as Prisma.InputJsonValue,
      },
    });

    // 10. Return the complete updated record
    const hasEnergy = existing.energySources.length > 0 || data.energyProfile !== undefined;
    const updatedFacility = await this.getFacilityById(id, hasEnergy);

    return { success: true, data: updatedFacility };
  }

  /**
   * Searches and filters facilities based on provided criteria.
   *
   * - Validates filters via SearchFiltersSchema
   * - Validates optional pagination params via PaginationParamsSchema
   * - Applies AND logic for multiple filters
   * - Keyword performs case-insensitive partial match across all locales in names/addresses JSONB
   * - Rejects whitespace-only keywords
   * - Validates filter values against allowed sets
   * - Orders results by name_text ASC (default locale name), id ASC (tiebreaker for pagination consistency)
   * - Excludes soft-deleted records
   * - Returns empty collection with count of zero for no matches
   * - For energy_source = 'unknown': returns facilities with no energy sources
   * - Supports pagination: page (min 1) and pageSize (min 1, max 500), defaults to page=1, pageSize=100
   * - Returns empty data array for pages exceeding total pages
   *
   * @param filters - Raw search filter input to validate
   * @param pagination - Optional pagination parameters (page, pageSize)
   * @returns ServiceResponse with paginated results or error details
   */
  async search(
    filters: unknown,
    pagination?: unknown,
  ): Promise<ServiceResponse<PaginatedResult<FacilityResponse>>> {
    // 1. Validate filters using SearchFiltersSchema
    const validation = validateInput(SearchFiltersSchema, filters);

    if (!validation.success) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR as ErrorCode,
          message: 'Validation failed',
          details: validation.errors.map((e) => ({
            field: e.path,
            message: e.message,
          })),
        },
      };
    }

    const data: SearchFiltersInput = validation.data;

    // 2. Determine pagination params (default page=1, pageSize=100)
    let page = 1;
    let pageSize = 100;

    if (pagination !== undefined && pagination !== null) {
      const paginationValidation = validateInput(PaginationParamsSchema, pagination);
      if (!paginationValidation.success) {
        return {
          success: false,
          error: {
            code: ERROR_CODES.VALIDATION_ERROR as ErrorCode,
            message: 'Validation failed',
            details: paginationValidation.errors.map((e) => ({
              field: e.path,
              message: e.message,
            })),
          },
        };
      }
      page = paginationValidation.data.page;
      pageSize = paginationValidation.data.pageSize;
    }

    // 3. Build dynamic WHERE conditions
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
      // For energy_source filter: join with energy_source table WHERE energy_type matches
      conditions.push(
        `EXISTS (SELECT 1 FROM energy_source es WHERE es.facility_id = f.id AND es.energy_type = $${paramIndex})`,
      );
      params.push(data.energySource);
      paramIndex++;
    }

    // 4. Build and execute the query
    const whereClause = conditions.join(' AND ');

    try {
      // Count query
      const countQuery = `SELECT COUNT(*) as count FROM facility f WHERE ${whereClause}`;
      const countResult = await this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        countQuery,
        ...params,
      );
      const totalCount = Number(countResult[0].count);

      // Compute pagination metadata
      const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize);

      // If no results, return empty paginated result
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

      // If requested page exceeds total pages, return empty data with pagination metadata
      if (page > totalPages) {
        return {
          success: true,
          data: {
            data: [],
            pagination: {
              totalCount,
              currentPage: page,
              totalPages,
              pageSize,
            },
          },
        };
      }

      // Data query with ordering and pagination
      // Primary sort: name_text ASC (search result ordering per req 5.9)
      // Secondary sort: id ASC (pagination consistency / tiebreaker per req 9.1)
      const offset = (page - 1) * pageSize;
      const dataQuery = `
        SELECT f.id
        FROM facility f
        WHERE ${whereClause}
        ORDER BY f.name_text ASC, f.id ASC
        LIMIT ${pageSize}
        OFFSET ${offset}
      `;
      const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
        dataQuery,
        ...params,
      );

      // Fetch full records for each matched facility
      const facilities: FacilityResponse[] = [];
      for (const row of rows) {
        const facility = await this.getFacilityById(row.id, true);
        facilities.push(facility);
      }

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
    } catch (error) {
      throw error;
    }
  }

  /**
   * Check if a facility with the same name, country, and geolocation exists,
   * excluding a specific facility ID (for updates).
   */
  private async checkDuplicateExcluding(
    nameText: string,
    country: string,
    longitude: number,
    latitude: number,
    excludeId: string,
  ): Promise<boolean> {
    const result = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM facility
      WHERE name_text = ${nameText}
        AND country = ${country}
        AND deleted_at IS NULL
        AND id != ${excludeId}::uuid
        AND ST_Equals(
          geolocation::geometry,
          ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)
        )
    `;

    return Number(result[0].count) > 0;
  }

  /**
   * Check if a facility with the same name, country, and geolocation exists.
   * Only checks non-deleted records.
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
   * Insert a facility using raw SQL to handle the PostGIS geolocation field.
   * Returns the generated UUID.
   */
  private async insertFacility(params: {
    names: Record<string, string>;
    addresses: Record<string, string>;
    defaultLocale: string;
    nameText: string;
    facilityType: string;
    country: string;
    adminRegion: string;
    city: string | null;
    ownership: string;
    operationalStatus: string;
    contactInfo: Record<string, unknown> | null;
    beds: number | null;
    verificationStatus: string;
    longitude: number;
    latitude: number;
  }): Promise<string> {
    const result = await this.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO facility (
        id, names, addresses, default_locale, name_text, facility_type,
        country, admin_region, city, ownership, operational_status,
        contact_info, beds, verification_status, energy_verification_status,
        geolocation, created_at, updated_at
      ) VALUES (
        gen_random_uuid(),
        ${JSON.stringify(params.names)}::jsonb,
        ${JSON.stringify(params.addresses)}::jsonb,
        ${params.defaultLocale},
        ${params.nameText},
        ${params.facilityType},
        ${params.country},
        ${params.adminRegion},
        ${params.city},
        ${params.ownership},
        ${params.operationalStatus},
        ${params.contactInfo ? JSON.stringify(params.contactInfo) : null}::jsonb,
        ${params.beds},
        ${params.verificationStatus},
        'unverified',
        ST_SetSRID(ST_MakePoint(${params.longitude}, ${params.latitude}), 4326)::geography,
        NOW(),
        NOW()
      )
      RETURNING id
    `;

    return result[0].id;
  }

  /**
   * Create energy source entries for a facility.
   */
  private async createEnergySources(
    facilityId: string,
    energyProfile: Array<{ energyType: string; consumptionKwhYear?: number }>,
  ): Promise<void> {
    for (const source of energyProfile) {
      await this.prisma.energySource.create({
        data: {
          facilityId,
          energyType: source.energyType,
          consumptionKwhYear: source.consumptionKwhYear ?? null,
        },
      });
    }
  }

  /**
   * Create an audit entry for a facility create operation.
   */
  private async createAuditEntry(
    facilityId: string,
    userId: string,
    inputData: CreateFacilityInput,
  ): Promise<void> {
    const changes: Record<string, { oldValue: unknown; newValue: unknown }> = {};

    // Record all submitted values with oldValue as null (create operation)
    const fieldsToAudit: Array<[string, unknown]> = [
      ['names', inputData.names],
      ['addresses', inputData.addresses ?? {}],
      ['facilityType', inputData.facilityType],
      ['country', inputData.country],
      ['adminRegion', inputData.adminRegion],
      ['city', inputData.city ?? null],
      ['geolocation', inputData.geolocation],
      ['operationalStatus', inputData.operationalStatus],
      ['ownership', inputData.ownership],
      ['contactInfo', inputData.contactInfo ?? null],
      ['beds', inputData.beds ?? null],
      ['energyProfile', inputData.energyProfile ?? 'unknown'],
      ['verificationStatus', inputData.verificationStatus ?? 'unverified'],
      ['defaultLocale', inputData.defaultLocale ?? Object.keys(inputData.names)[0]],
    ];

    for (const [field, value] of fieldsToAudit) {
      changes[field] = { oldValue: null, newValue: value };
    }

    await this.prisma.auditEntry.create({
      data: {
        facilityId,
        userId,
        operationType: 'create',
        changes: changes as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Deletes a health facility record (soft-delete).
   *
   * @param id - The UUID of the facility to delete
   * @param userId - ID of the authenticated user performing the operation
   * @returns ServiceResponse with the deleted facility ID or error details
   */
  async delete(
    id: string,
    userId: string,
  ): Promise<ServiceResponse<{ id: string }>> {
    // 1. Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.INVALID_FORMAT as ErrorCode,
          message: 'Invalid facility ID format. Must be a valid UUID.',
        },
      };
    }

    // 2. Check that the facility exists and is not already soft-deleted
    const facility = await this.prisma.facility.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });

    if (!facility) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND as ErrorCode,
          message: 'Facility not found',
        },
      };
    }

    // 3. Soft-delete the facility by setting deleted_at
    await this.prisma.facility.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    // 4. Create audit entry for the deletion
    await this.createDeleteAuditEntry(id, userId, facility);

    // 5. Return confirmation with deleted facility ID
    return {
      success: true,
      data: { id },
    };
  }

  /**
   * Create an audit entry for a facility delete operation.
   * Records old values from the existing record and sets new values to null.
   */
  private async createDeleteAuditEntry(
    facilityId: string,
    userId: string,
    facility: {
      names: unknown;
      addresses: unknown;
      facilityType: string;
      country: string;
      adminRegion: string;
      city: string | null;
      ownership: string;
      operationalStatus: string;
      contactInfo: unknown;
      beds: number | null;
      verificationStatus: string;
      defaultLocale: string;
    },
  ): Promise<void> {
    const changes: Record<string, { oldValue: unknown; newValue: null }> = {};

    const fieldsToAudit: Array<[string, unknown]> = [
      ['names', facility.names],
      ['addresses', facility.addresses],
      ['facilityType', facility.facilityType],
      ['country', facility.country],
      ['adminRegion', facility.adminRegion],
      ['city', facility.city],
      ['ownership', facility.ownership],
      ['operationalStatus', facility.operationalStatus],
      ['contactInfo', facility.contactInfo],
      ['beds', facility.beds],
      ['verificationStatus', facility.verificationStatus],
      ['defaultLocale', facility.defaultLocale],
    ];

    for (const [field, value] of fieldsToAudit) {
      changes[field] = { oldValue: value, newValue: null };
    }

    await this.prisma.auditEntry.create({
      data: {
        facilityId,
        userId,
        operationType: 'delete',
        changes: changes as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Retrieve a facility by ID and map it to the response format.
   */
  private async getFacilityById(
    id: string,
    hasEnergyProfile: boolean,
  ): Promise<FacilityResponse> {
    // Get the facility record
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
      energyProfile: hasEnergyProfile
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
