/**
 * Emission Factor Service
 *
 * Handles CRUD operations for emission factor records:
 * - Create: validates input, checks unique constraint (country, energySourceType, referenceYear)
 * - Update: validates UUID and input, checks existence, checks uniqueness conflicts
 * - Delete: validates UUID, checks existence, removes record
 *
 * Admin role enforcement is handled at the route/middleware level.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import {
  EmissionFactorSchema,
  EmissionFactorInput,
  validateInput,
} from '../validation/schemas';
import { ErrorCode, ERROR_CODES } from '../types/api';
import { ServiceResponse } from './facility.service';

/** Emission factor record as returned from the service */
export interface EmissionFactorResponse {
  id: string;
  country: string;
  energySourceType: string;
  factorKgCo2ePerKwh: number;
  referenceYear: number;
  createdAt: Date;
  updatedAt: Date;
}

/** UUID format regex pattern */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Maps a Prisma EmissionFactor record to the service response format.
 */
function toResponse(record: {
  id: string;
  country: string;
  energySourceType: string;
  factorKgCo2ePerKwh: Prisma.Decimal | number;
  referenceYear: number;
  createdAt: Date;
  updatedAt: Date;
}): EmissionFactorResponse {
  return {
    id: record.id,
    country: record.country,
    energySourceType: record.energySourceType,
    factorKgCo2ePerKwh: Number(record.factorKgCo2ePerKwh),
    referenceYear: record.referenceYear,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export class EmissionFactorService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Creates a new emission factor record.
   *
   * @param input - Raw input data to validate and persist
   * @param userId - ID of the authenticated admin user performing the operation
   * @returns ServiceResponse with the created emission factor or error details
   */
  async create(
    input: unknown,
    userId: string,
  ): Promise<ServiceResponse<EmissionFactorResponse>> {
    // 1. Validate input using EmissionFactorSchema
    const validation = validateInput(EmissionFactorSchema, input);

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

    const data: EmissionFactorInput = validation.data;

    // 2. Create the emission factor record
    try {
      const record = await this.prisma.emissionFactor.create({
        data: {
          country: data.country,
          energySourceType: data.energySourceType,
          factorKgCo2ePerKwh: data.factorKgCo2ePerKwh,
          referenceYear: data.referenceYear,
        },
      });

      return {
        success: true,
        data: toResponse(record),
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
            message:
              'An emission factor with the same country, energy source type, and reference year already exists',
          },
        };
      }
      throw error;
    }
  }

  /**
   * Updates an existing emission factor record.
   *
   * @param id - UUID of the emission factor to update
   * @param input - Raw input data to validate and apply
   * @param userId - ID of the authenticated admin user performing the operation
   * @returns ServiceResponse with the updated emission factor or error details
   */
  async update(
    id: string,
    input: unknown,
    userId: string,
  ): Promise<ServiceResponse<EmissionFactorResponse>> {
    // 1. Validate UUID format
    if (!UUID_REGEX.test(id)) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.INVALID_FORMAT as ErrorCode,
          message: 'Invalid emission factor ID format. Expected a valid UUID.',
        },
      };
    }

    // 2. Validate input using EmissionFactorSchema
    const validation = validateInput(EmissionFactorSchema, input);

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

    const data: EmissionFactorInput = validation.data;

    // 3. Check that the emission factor exists
    const existing = await this.prisma.emissionFactor.findUnique({
      where: { id },
    });

    if (!existing) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND as ErrorCode,
          message: `Emission factor with ID '${id}' not found`,
        },
      };
    }

    // 4. Check for uniqueness conflicts (excluding the current record)
    const conflict = await this.prisma.emissionFactor.findFirst({
      where: {
        country: data.country,
        energySourceType: data.energySourceType,
        referenceYear: data.referenceYear,
        id: { not: id },
      },
    });

    if (conflict) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.DUPLICATE_RECORD as ErrorCode,
          message:
            'An emission factor with the same country, energy source type, and reference year already exists',
        },
      };
    }

    // 5. Apply the update
    try {
      const updated = await this.prisma.emissionFactor.update({
        where: { id },
        data: {
          country: data.country,
          energySourceType: data.energySourceType,
          factorKgCo2ePerKwh: data.factorKgCo2ePerKwh,
          referenceYear: data.referenceYear,
        },
      });

      return {
        success: true,
        data: toResponse(updated),
      };
    } catch (error) {
      // Handle race condition where unique constraint is violated between check and update
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return {
          success: false,
          error: {
            code: ERROR_CODES.DUPLICATE_RECORD as ErrorCode,
            message:
              'An emission factor with the same country, energy source type, and reference year already exists',
          },
        };
      }
      throw error;
    }
  }

  /**
   * Lists emission factors with optional filtering by country and/or energy source type.
   *
   * @param filters - Optional filters for country and energySourceType
   * @returns ServiceResponse with an array of emission factors
   */
  async list(
    filters?: { country?: string; energySourceType?: string },
  ): Promise<ServiceResponse<EmissionFactorResponse[]>> {
    const where: Prisma.EmissionFactorWhereInput = {};

    if (filters?.country) {
      where.country = filters.country;
    }
    if (filters?.energySourceType) {
      where.energySourceType = filters.energySourceType;
    }

    const records = await this.prisma.emissionFactor.findMany({
      where,
      orderBy: [
        { country: 'asc' },
        { energySourceType: 'asc' },
        { referenceYear: 'desc' },
      ],
    });

    return {
      success: true,
      data: records.map(toResponse),
    };
  }

  /**
   * Temporal lookup: finds the most recent emission factor for a given country +
   * energy source type where reference_year <= maxYear.
   *
   * @param country - Country to match
   * @param sourceType - Energy source type to match
   * @param maxYear - Maximum reference year (inclusive)
   * @returns The most recent matching emission factor, or null if none found
   */
  async findByCountryAndSource(
    country: string,
    sourceType: string,
    maxYear: number,
  ): Promise<EmissionFactorResponse | null> {
    const record = await this.prisma.emissionFactor.findFirst({
      where: {
        country,
        energySourceType: sourceType,
        referenceYear: { lte: maxYear },
      },
      orderBy: { referenceYear: 'desc' },
    });

    if (!record) {
      return null;
    }

    return toResponse(record);
  }

  /**
   * Deletes an emission factor record.
   *
   * @param id - UUID of the emission factor to delete
   * @param userId - ID of the authenticated admin user performing the operation
   * @returns ServiceResponse with the deleted emission factor or error details
   */
  async delete(
    id: string,
    userId: string,
  ): Promise<ServiceResponse<EmissionFactorResponse>> {
    // 1. Validate UUID format
    if (!UUID_REGEX.test(id)) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.INVALID_FORMAT as ErrorCode,
          message: 'Invalid emission factor ID format. Expected a valid UUID.',
        },
      };
    }

    // 2. Check that the emission factor exists
    const existing = await this.prisma.emissionFactor.findUnique({
      where: { id },
    });

    if (!existing) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND as ErrorCode,
          message: `Emission factor with ID '${id}' not found`,
        },
      };
    }

    // 3. Delete the record
    const deleted = await this.prisma.emissionFactor.delete({
      where: { id },
    });

    return {
      success: true,
      data: toResponse(deleted),
    };
  }
}
