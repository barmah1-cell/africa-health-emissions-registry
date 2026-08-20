/**
 * Energy & Emissions Routes
 *
 * Energy profile management and GHG emissions for facilities:
 * - PUT  /facilities/:id/energy-profile       → Update energy profile (authenticated)
 * - POST /facilities/:id/emissions            → Record emissions (authenticated)
 * - GET  /facilities/:id/emissions/estimate   → Estimate emissions (optional auth)
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, optionalAuth } from '../middleware/auth';
import { EnergyEmissionsService } from '../services/energy.service';
import { ERROR_HTTP_STATUS, ErrorCode } from '../types/api';

/**
 * Creates the energy/emissions routes router.
 *
 * @param prisma - Prisma client instance for database access
 * @returns Express Router with energy and emissions endpoints
 */
export function createEnergyRouter(prisma: PrismaClient): Router {
  const router = Router();
  const energyService = new EnergyEmissionsService(prisma);

  /**
   * PUT /facilities/:id/energy-profile
   * Replace the energy profile for a facility.
   */
  router.put(
    '/facilities/:id/energy-profile',
    authenticate,
    async (req: Request, res: Response): Promise<void> => {
      const { id } = req.params;
      const userId = req.user!.id;

      const result = await energyService.updateEnergyProfile(id, req.body, userId);

      if (!result.success) {
        const status = ERROR_HTTP_STATUS[result.error.code as ErrorCode] ?? 500;
        res.status(status).json({ error: result.error });
        return;
      }

      res.status(200).json({ data: result.data });
    },
  );

  /**
   * POST /facilities/:id/emissions
   * Record GHG emissions data for a facility.
   */
  router.post(
    '/facilities/:id/emissions',
    authenticate,
    async (req: Request, res: Response): Promise<void> => {
      const { id } = req.params;

      const result = await energyService.addEmissions(id, req.body);

      if (!result.success) {
        const status = ERROR_HTTP_STATUS[result.error.code as ErrorCode] ?? 500;
        res.status(status).json({ error: result.error });
        return;
      }

      res.status(201).json({ data: result.data });
    },
  );

  /**
   * GET /facilities/:id/emissions
   * Retrieve all recorded GHG emissions for a facility.
   */
  router.get(
    '/facilities/:id/emissions',
    optionalAuth,
    async (req: Request, res: Response): Promise<void> => {
      const { id } = req.params;

      try {
        const emissions = await prisma.ghgEmission.findMany({
          where: { facilityId: id },
          orderBy: [{ reportingYear: 'desc' }, { emissionScope: 'asc' }],
        });

        res.status(200).json({
          data: emissions.map(e => ({
            id: e.id,
            facilityId: e.facilityId,
            emissionScope: e.emissionScope,
            valueTonnesCo2e: Number(e.valueTonnesCo2e),
            reportingYear: e.reportingYear,
          }))
        });
      } catch (err) {
        res.status(500).json({ error: { code: 'VALIDATION_ERROR', message: 'Failed to fetch emissions' } });
      }
    },
  );

  /**
   * GET /facilities/:id/emissions/estimate
   * Estimate emissions for a facility based on energy consumption and factors.
   * Query params: energySourceType, year
   */
  router.get(
    '/facilities/:id/emissions/estimate',
    optionalAuth,
    async (req: Request, res: Response): Promise<void> => {
      const { id } = req.params;
      const { energySourceType, year } = req.query;

      const result = await energyService.estimateEmissions(
        id,
        energySourceType as string,
        year ? Number(year) : NaN,
      );

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
