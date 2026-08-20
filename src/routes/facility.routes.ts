/**
 * Facility Routes
 *
 * CRUD operations for health facility records:
 * - POST   /              → Create a new facility (authenticated)
 * - GET    /              → Search/list facilities (optional auth)
 * - GET    /:id           → Get a single facility by ID (optional auth)
 * - PATCH  /:id           → Update a facility (authenticated)
 * - DELETE /:id           → Soft-delete a facility (admin only)
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, optionalAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/requireAdmin';
import { FacilityService } from '../services/facility.service';
import { ERROR_HTTP_STATUS, ErrorCode } from '../types/api';

/**
 * Creates the facility CRUD routes router.
 *
 * @param prisma - Prisma client instance for database access
 * @returns Express Router with facility endpoints
 */
export function createFacilityRouter(prisma: PrismaClient): Router {
  const router = Router();
  const facilityService = new FacilityService(prisma);

  /**
   * POST /
   * Create a new health facility record.
   */
  router.post(
    '/',
    authenticate,
    async (req: Request, res: Response): Promise<void> => {
      const userId = req.user!.id;
      const result = await facilityService.create(req.body, userId);

      if (!result.success) {
        const status = ERROR_HTTP_STATUS[result.error.code as ErrorCode] ?? 500;
        res.status(status).json({ error: result.error });
        return;
      }

      res.status(201).json({ data: result.data });
    },
  );

  /**
   * GET /
   * Search and filter facilities with pagination.
   */
  router.get(
    '/',
    optionalAuth,
    async (req: Request, res: Response): Promise<void> => {
      const { page, pageSize, ...filters } = req.query;

      const pagination =
        page !== undefined || pageSize !== undefined
          ? {
              page: page ? Number(page) : 1,
              pageSize: pageSize ? Number(pageSize) : 100,
            }
          : undefined;

      const result = await facilityService.search(filters, pagination);

      if (!result.success) {
        const status = ERROR_HTTP_STATUS[result.error.code as ErrorCode] ?? 500;
        res.status(status).json({ error: result.error });
        return;
      }

      res.status(200).json(result.data);
    },
  );

  /**
   * GET /:id
   * Retrieve a single facility by its UUID.
   */
  router.get(
    '/:id',
    optionalAuth,
    async (req: Request, res: Response): Promise<void> => {
      const { id } = req.params;
      const locale = req.query.locale as string | undefined;

      const result = await facilityService.getById(id, locale);

      if (!result.success) {
        const status = ERROR_HTTP_STATUS[result.error.code as ErrorCode] ?? 500;
        res.status(status).json({ error: result.error });
        return;
      }

      res.status(200).json({ data: result.data });
    },
  );

  /**
   * PATCH /:id
   * Update an existing facility with partial data.
   */
  router.patch(
    '/:id',
    authenticate,
    async (req: Request, res: Response): Promise<void> => {
      const { id } = req.params;
      const userId = req.user!.id;

      const result = await facilityService.update(id, req.body, userId);

      if (!result.success) {
        const status = ERROR_HTTP_STATUS[result.error.code as ErrorCode] ?? 500;
        res.status(status).json({ error: result.error });
        return;
      }

      res.status(200).json({ data: result.data });
    },
  );

  /**
   * DELETE /:id
   * Soft-delete a facility (admin only).
   */
  router.delete(
    '/:id',
    authenticate,
    requireAdmin,
    async (req: Request, res: Response): Promise<void> => {
      const { id } = req.params;
      const userId = req.user!.id;

      const result = await facilityService.delete(id, userId);

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
