/**
 * Audit Service
 *
 * Provides append-only audit trail recording for all facility operations.
 * Encapsulates audit entry creation logic for reuse across services.
 *
 * Key properties:
 * - Append-only: no update or delete methods are exposed
 * - Records old/new values per field for every create, update, delete operation
 * - Audit entries are preserved even when facilities are deleted (soft-delete)
 */

import { PrismaClient, Prisma } from '@prisma/client';
import type { OperationType } from '../types/enums';
import type { ServiceResponse } from './facility.service';
import { ERROR_CODES } from '../types/api';

/** Input for recording an audit entry */
export interface AuditInput {
  facilityId: string;
  userId: string;
  operationType: OperationType;
  changes: Record<string, { oldValue: unknown; newValue: unknown }>;
}

/** Audit entry as returned from the service */
export interface AuditEntry {
  id: string;
  facilityId: string | null;
  userId: string;
  operationType: string;
  changes: Record<string, { oldValue: unknown; newValue: unknown }>;
  createdAt: Date;
}

export class AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Records an audit entry for a facility operation.
   *
   * - For creates: old values should be null for each field
   * - For updates: both old and new values are recorded per changed field
   * - For deletes: new values should be null for each field
   *
   * Audit entries are append-only and cannot be modified or deleted.
   */
  async record(entry: AuditInput): Promise<void> {
    await this.prisma.auditEntry.create({
      data: {
        facilityId: entry.facilityId,
        userId: entry.userId,
        operationType: entry.operationType,
        changes: entry.changes as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Retrieves the full audit history for a facility, sorted oldest to newest.
   *
   * Returns all audit entries including those for deleted facilities.
   */
  async getHistory(facilityId: string): Promise<AuditEntry[]> {
    const entries = await this.prisma.auditEntry.findMany({
      where: { facilityId },
      orderBy: { createdAt: 'asc' },
    });

    return entries.map((entry) => ({
      id: entry.id,
      facilityId: entry.facilityId,
      userId: entry.userId,
      operationType: entry.operationType,
      changes: entry.changes as Record<string, { oldValue: unknown; newValue: unknown }>,
      createdAt: entry.createdAt,
    }));
  }

  /**
   * Retrieves audit history for a facility with UUID validation and ServiceResponse wrapping.
   *
   * - Validates that the facility ID is a valid UUID format
   * - Returns the audit history sorted chronologically (oldest to newest)
   * - Does NOT check if the facility exists — audit entries are accessible even for deleted facilities
   * - Returns an empty array if no audit entries exist for the given ID
   *
   * Admin role check is enforced at the route/middleware level.
   */
  async getAuditHistory(facilityId: string): Promise<ServiceResponse<AuditEntry[]>> {
    // 1. Validate UUID format
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(facilityId)) {
      return {
        success: false,
        error: {
          code: ERROR_CODES.INVALID_FORMAT,
          message: 'The facility identifier format is invalid. Expected a UUID.',
          details: [
            {
              field: 'id',
              message: 'Must be a valid UUID format',
              value: facilityId,
            },
          ],
        },
      };
    }

    // 2. Retrieve audit history (works for deleted facilities too)
    const entries = await this.getHistory(facilityId);

    return {
      success: true,
      data: entries,
    };
  }
}
