/**
 * Energy & Emissions Service
 *
 * Handles energy profile management for health facilities including:
 * - Validation of energy profile input (1-10 entries, valid energy_type, optional consumption)
 * - Replace-all strategy for energy sources on profile update
 * - Energy verification date tracking
 * - Audit entry creation for energy profile changes
 * - Marks energy_profile as 'unknown' when no data is provided
 */

import { PrismaClient, Prisma } from '@prisma/client';
import {
  EnergyProfileSchema,
  EnergyProfileInput,
  GhgEmissionsSchema,
  GhgEmissionsInput,
  validateInput,
} from '../validation/schemas';
import { ErrorCode, ERROR_CODES } from '../types/api';
import type { ServiceResponse } from './facility.service';

/** Energy profile response representing the updated profile */
export interface EnergyProfileResponse {
  facilityId: string;
  energySources: Array<{
    id: string;
    energyType: string;
    consumptionKwhYear: number | null;
  }>;
  energyVerificationDate: Date;
}

/** GHG Emission record as returned from the service */
export interface GhgEmissionResponse {
  id: string;
  facilityId: string;
  emissionScope: string;
  valueTonnesCo2e: number;
  reportingYear: number;
  createdAt: Date;
}

/** Emission estimate result returned from the estimation endpoint */
export interface EmissionEstimate {
  facilityId: string;
  energySourceType: string;
  consumptionKwh: number;
  emissionFactorKgCo2ePerKwh: number;
  referenceYear: number;
  estimatedTonnesCo2e: number;
}

/** UUID format regex pattern */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class EnergyEmissionsService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Updates the energy profile for a facility.
   *
   * Steps:
   * 1. Validate facility ID (UUID format)
   * 2. Check facility exists and is not soft-deleted
   * 3. Validate energy profile input (1-10 entries, valid energy_type, optional consumption 0.01-999,999,999.99)
   * 4. Delete all existing energy sources for the facility
   * 5. Create new energy source entries
   * 6. Update the facility's energy_verification_date to NOW()
   * 7. Create audit entry for the energy profile update
   * 8. Return the updated energy profile
   *
   * @param facilityId - UUID of the facility to update
   * @param input - Raw energy profile input to validate
   * @param userId - ID of the authenticated user performing the operation
   * @returns ServiceResponse with the updated energy profile or error details
   */
  async updateEnergyProfile(
    facilityId: string,
    input: unknown,
    userId: string,
  ): Promise<ServiceResponse<EnergyProfileResponse>> {
    // 1. Validate UUID format
    if (!UUID_REGEX.test(facilityId)) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.INVALID_FORMAT as ErrorCode,
          message: 'Invalid facility ID format. Expected a valid UUID.',
        },
      };
    }

    // 2. Check facility exists and is not soft-deleted
    const facility = await this.prisma.facility.findFirst({
      where: {
        id: facilityId,
        deletedAt: null,
      },
    });

    if (!facility) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND as ErrorCode,
          message: `Facility with ID '${facilityId}' not found`,
        },
      };
    }

    // 3. Validate energy profile input using EnergyProfileSchema
    const validation = validateInput(EnergyProfileSchema, input);

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

    const energyProfile: EnergyProfileInput = validation.data;

    // 4. Get existing energy sources for audit trail
    const existingEnergySources = await this.prisma.energySource.findMany({
      where: { facilityId },
    });

    // 5. Delete all existing energy sources for the facility
    await this.prisma.energySource.deleteMany({
      where: { facilityId },
    });

    // 6. Create new energy source entries
    const createdSources: Array<{
      id: string;
      energyType: string;
      consumptionKwhYear: number | null;
    }> = [];

    for (const source of energyProfile) {
      const created = await this.prisma.energySource.create({
        data: {
          facilityId,
          energyType: source.energyType,
          consumptionKwhYear: source.consumptionKwhYear ?? null,
        },
      });
      createdSources.push({
        id: created.id,
        energyType: created.energyType,
        consumptionKwhYear: created.consumptionKwhYear
          ? Number(created.consumptionKwhYear)
          : null,
      });
    }

    // 7. Update the facility's energy_verification_date to NOW()
    const updatedFacility = await this.prisma.facility.update({
      where: { id: facilityId },
      data: {
        energyVerificationDate: new Date(),
        energyVerificationStatus: 'self_reported',
      },
    });

    // 8. Create audit entry for the energy profile update
    const oldProfile = existingEnergySources.length > 0
      ? existingEnergySources.map((es) => ({
          energyType: es.energyType,
          consumptionKwhYear: es.consumptionKwhYear
            ? Number(es.consumptionKwhYear)
            : null,
        }))
      : 'unknown';

    const newProfile = energyProfile.map((entry) => ({
      energyType: entry.energyType,
      consumptionKwhYear: entry.consumptionKwhYear ?? null,
    }));

    await this.prisma.auditEntry.create({
      data: {
        facilityId,
        userId,
        operationType: 'update',
        changes: {
          energyProfile: { oldValue: oldProfile, newValue: newProfile },
          energyVerificationDate: {
            oldValue: facility.energyVerificationDate?.toISOString() ?? null,
            newValue: updatedFacility.energyVerificationDate!.toISOString(),
          },
        } as unknown as Prisma.InputJsonValue,
      },
    });

    // 9. Return the updated energy profile
    return {
      success: true,
      data: {
        facilityId,
        energySources: createdSources,
        energyVerificationDate: updatedFacility.energyVerificationDate!,
      },
    };
  }

  /**
   * Records GHG emissions data for a facility.
   *
   * Steps:
   * 1. Validate facility ID (UUID format)
   * 2. Check facility exists and is not soft-deleted
   * 3. Validate emissions input using GhgEmissionsSchema (returns all errors)
   * 4. Create the emission record via Prisma
   * 5. Handle unique constraint violation (P2002) as DUPLICATE_RECORD
   *
   * @param facilityId - UUID of the facility
   * @param input - Raw emissions input data to validate and persist
   * @returns ServiceResponse with the created emission record or error details
   */
  async addEmissions(
    facilityId: string,
    input: unknown,
  ): Promise<ServiceResponse<GhgEmissionResponse>> {
    // 1. Validate facility ID format (UUID)
    if (!UUID_REGEX.test(facilityId)) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.INVALID_FORMAT as ErrorCode,
          message: 'Invalid facility ID format. Expected a valid UUID.',
        },
      };
    }

    // 2. Check facility exists and is not soft-deleted
    const facility = await this.prisma.facility.findFirst({
      where: {
        id: facilityId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!facility) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND as ErrorCode,
          message: `Facility with ID '${facilityId}' not found`,
        },
      };
    }

    // 3. Validate emissions input using GhgEmissionsSchema (returns all errors)
    const validation = validateInput(GhgEmissionsSchema, input);

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

    const data: GhgEmissionsInput = validation.data;

    // 4. Create the emission record via Prisma
    try {
      const emission = await this.prisma.ghgEmission.create({
        data: {
          facilityId,
          emissionScope: data.emissionScope,
          valueTonnesCo2e: data.valueTonnesCo2e,
          reportingYear: data.reportingYear,
        },
      });

      // 5. Return the created emission record
      return {
        success: true,
        data: {
          id: emission.id,
          facilityId: emission.facilityId,
          emissionScope: emission.emissionScope,
          valueTonnesCo2e: Number(emission.valueTonnesCo2e),
          reportingYear: emission.reportingYear,
          createdAt: emission.createdAt,
        },
      };
    } catch (error) {
      // 6. Handle unique constraint violation (Prisma P2002)
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return {
          success: false,
          error: {
            code: ERROR_CODES.DUPLICATE_RECORD as ErrorCode,
            message: 'An emission record for this facility, scope, and reporting year already exists',
          },
        };
      }
      throw error;
    }
  }

  /**
   * Estimates GHG emissions for a facility based on energy consumption and emission factors.
   *
   * Steps:
   * 1. Validate facility ID (UUID format)
   * 2. Check facility exists and is not soft-deleted
   * 3. Look up facility's energy sources to find consumption data for the given energySourceType
   * 4. If no consumption data → return ESTIMATION_UNAVAILABLE
   * 5. Find matching emission factor: country + energy_source_type + most recent reference_year <= year
   * 6. If no emission factor found → return ESTIMATION_UNAVAILABLE
   * 7. Calculate: estimatedTonnesCo2e = (consumptionKwh * factorKgCo2ePerKwh) / 1000
   * 8. Return the EmissionEstimate object
   *
   * @param facilityId - UUID of the facility
   * @param energySourceType - The energy source type to estimate emissions for
   * @param year - The reporting year to estimate for
   * @returns ServiceResponse with the emission estimate or error details
   */
  async estimateEmissions(
    facilityId: string,
    energySourceType: string,
    year: number,
  ): Promise<ServiceResponse<EmissionEstimate>> {
    // 1. Validate facility ID format (UUID)
    if (!UUID_REGEX.test(facilityId)) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.INVALID_FORMAT as ErrorCode,
          message: 'Invalid facility ID format. Expected a valid UUID.',
        },
      };
    }

    // 2. Check facility exists and is not soft-deleted
    const facility = await this.prisma.facility.findFirst({
      where: {
        id: facilityId,
        deletedAt: null,
      },
      select: { id: true, country: true },
    });

    if (!facility) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND as ErrorCode,
          message: `Facility with ID '${facilityId}' not found`,
        },
      };
    }

    // 3. Look up facility's energy sources to find consumption data for the given energySourceType
    const energySource = await this.prisma.energySource.findFirst({
      where: {
        facilityId,
        energyType: energySourceType,
        consumptionKwhYear: { not: null },
      },
    });

    // 4. If no consumption data for that energy source type → return ESTIMATION_UNAVAILABLE
    if (!energySource || energySource.consumptionKwhYear === null) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.ESTIMATION_UNAVAILABLE as ErrorCode,
          message: `No energy consumption data available for energy source type '${energySourceType}' at facility '${facilityId}'`,
        },
      };
    }

    // 5. Find matching emission factor: country + energy_source_type + most recent reference_year <= year
    const emissionFactor = await this.prisma.emissionFactor.findFirst({
      where: {
        country: facility.country,
        energySourceType: energySourceType,
        referenceYear: { lte: year },
      },
      orderBy: { referenceYear: 'desc' },
    });

    // 6. If no emission factor found → return ESTIMATION_UNAVAILABLE
    if (!emissionFactor) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.ESTIMATION_UNAVAILABLE as ErrorCode,
          message: `No emission factor available for country '${facility.country}' and energy source type '${energySourceType}'`,
        },
      };
    }

    // 7. Calculate: estimatedTonnesCo2e = (consumptionKwh * factorKgCo2ePerKwh) / 1000
    const consumptionKwh = Number(energySource.consumptionKwhYear);
    const factorKgCo2ePerKwh = Number(emissionFactor.factorKgCo2ePerKwh);
    const estimatedTonnesCo2e = (consumptionKwh * factorKgCo2ePerKwh) / 1000;

    // 8. Return the EmissionEstimate object
    return {
      success: true,
      data: {
        facilityId,
        energySourceType,
        consumptionKwh,
        emissionFactorKgCo2ePerKwh: factorKgCo2ePerKwh,
        referenceYear: emissionFactor.referenceYear,
        estimatedTonnesCo2e,
      },
    };
  }
}
