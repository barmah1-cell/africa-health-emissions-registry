/**
 * Audit History Route Handler
 *
 * GET /api/v1/facilities/:id/audit
 *
 * Retrieves the audit trail for a facility record.
 * - Requires Admin role (authenticate + requireAdmin middleware)
 * - Returns chronological list of audit entries (oldest to newest)
 * - Supports retrieval by original facility ID even for deleted facilities
 *
 * Requirements: 11.2, 11.5, 11.6
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/requireAdmin';
import { AuditService } from '../services/audit.service';
import { PrismaClient } from '@prisma/client';

/**
 * Creates the audit routes router.
 *
 * @param prisma - Prisma client instance for database access
 * @returns Express Router with audit history endpoint
 */
export function createAuditRouter(prisma: PrismaClient): Router {
  const router = Router();
  const auditService = new AuditService(prisma);

  /**
   * GET /api/v1/facilities/:id/audit
   *
   * Retrieves all audit entries for a facility, sorted oldest to newest.
   * Admin role required.
   * Works for deleted facilities (audit entries are preserved).
   */
  router.get(
    '/facilities/:id/audit',
    authenticate,
    requireAdmin,
    async (req: Request, res: Response): Promise<void> => {
      const { id } = req.params;

      const result = await auditService.getAuditHistory(id);

      if (!result.success) {
        const statusCode = result.error.code === 'INVALID_FORMAT' ? 400 : 500;
        res.status(statusCode).json({ error: result.error });
        return;
      }

      res.status(200).json({ data: result.data });
    },
  );

  return router;
}
