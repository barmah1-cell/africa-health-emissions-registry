/**
 * Emission Factor Routes
 *
 * CRUD for emission factor reference data (admin-only for write operations):
 * - POST   /emission-factors      → Create emission factor (admin only)
 * - PUT    /emission-factors/:id  → Update emission factor (admin only)
 * - DELETE /emission-factors/:id  → Delete emission factor (admin only)
 * - GET    /emission-factors      → List emission factors (optional auth)
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, optionalAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/requireAdmin';
import { EmissionFactorService } from '../services/emissionFactor.service';
import { ERROR_HTTP_STATUS, ErrorCode } from '../types/api';

/**
 * Creates the emission factor routes router.
 *
 * @param prisma - Prisma client instance for database access
 * @returns Express Router with emission factor endpoints
 */
export function createEmissionFactorRouter(prisma: PrismaClient): Router {
  const router = Router();
  const emissionFactorService = new EmissionFactorService(prisma);

  /**
   * POST /emission-factors
   * Create a new emission factor record. Admin only.
   */
  router.post(
    '/',
    authenticate,
    requireAdmin,
    async (req: Request, res: Response): Promise<void> => {
      const userId = req.user!.id;

      const result = await emissionFactorService.create(req.body, userId);

      if (!result.success) {
        const status = ERROR_HTTP_STATUS[result.error.code as ErrorCode] ?? 500;
        res.status(status).json({ error: result.error });
        return;
      }

      res.status(201).json({ data: result.data });
    },
  );

  /**
   * GET /emission-factors
   * List emission factors with optional country/energySourceType filtering.
   */
  router.get(
    '/',
    optionalAuth,
    async (req: Request, res: Response): Promise<void> => {
      const { country, energySourceType } = req.query;

      const filters: { country?: string; energySourceType?: string } = {};
      if (country) filters.country = country as string;
      if (energySourceType) filters.energySourceType = energySourceType as string;

      const result = await emissionFactorService.list(
        Object.keys(filters).length > 0 ? filters : undefined,
      );

      if (!result.success) {
        const status = ERROR_HTTP_STATUS[result.error.code as ErrorCode] ?? 500;
        res.status(status).json({ error: result.error });
        return;
      }

      res.status(200).json({ data: result.data });
    },
  );

  /**
   * PUT /emission-factors/:id
   * Update an existing emission factor. Admin only.
   */
  router.put(
    '/:id',
    authenticate,
    requireAdmin,
    async (req: Request, res: Response): Promise<void> => {
      const { id } = req.params;
      const userId = req.user!.id;

      const result = await emissionFactorService.update(id, req.body, userId);

      if (!result.success) {
        const status = ERROR_HTTP_STATUS[result.error.code as ErrorCode] ?? 500;
        res.status(status).json({ error: result.error });
        return;
      }

      res.status(200).json({ data: result.data });
    },
  );

  /**
   * DELETE /emission-factors/:id
   * Delete an emission factor record. Admin only.
   */
  router.delete(
    '/:id',
    authenticate,
    requireAdmin,
    async (req: Request, res: Response): Promise<void> => {
      const { id } = req.params;
      const userId = req.user!.id;

      const result = await emissionFactorService.delete(id, userId);

      if (!result.success) {
        const status = ERROR_HTTP_STATUS[result.error.code as ErrorCode] ?? 500;
        res.status(status).json({ error: result.error });
        return;
      }

      res.status(200).json({ data: result.data });
    },
  );

  return router;
}
