/**
 * Geospatial Routes
 *
 * Proximity and bounding box search for health facilities:
 * - GET /facilities/nearby  → Find facilities within radius of a point
 * - GET /facilities/bbox    → Find facilities within a bounding box
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { optionalAuth } from '../middleware/auth';
import { GeospatialService } from '../services/geospatial.service';
import { ERROR_HTTP_STATUS, ErrorCode } from '../types/api';

/**
 * Creates the geospatial routes router.
 *
 * @param prisma - Prisma client instance for database access
 * @returns Express Router with geospatial endpoints
 */
export function createGeospatialRouter(prisma: PrismaClient): Router {
  const router = Router();
  const geospatialService = new GeospatialService(prisma);

  /**
   * GET /facilities/nearby
   * Find facilities within a given radius of a point.
   * Query params: latitude, longitude, radiusKm, page, pageSize
   */
  router.get(
    '/facilities/nearby',
    optionalAuth,
    async (req: Request, res: Response): Promise<void> => {
      const { latitude, longitude, radiusKm, page, pageSize } = req.query;

      const query = {
        latitude: latitude ? Number(latitude) : undefined,
        longitude: longitude ? Number(longitude) : undefined,
        radiusKm: radiusKm ? Number(radiusKm) : undefined,
      };

      const pagination =
        page !== undefined || pageSize !== undefined
          ? {
              page: page ? Number(page) : undefined,
              pageSize: pageSize ? Number(pageSize) : undefined,
            }
          : undefined;

      const result = await geospatialService.findNearby(query, pagination);

      if (!result.success) {
        const status = ERROR_HTTP_STATUS[result.error.code as ErrorCode] ?? 500;
        res.status(status).json({ error: result.error });
        return;
      }

      res.status(200).json(result.data);
    },
  );

  /**
   * GET /facilities/bbox
   * Find facilities within a bounding box.
   * Query params: swLatitude, swLongitude, neLatitude, neLongitude, page, pageSize
   */
  router.get(
    '/facilities/bbox',
    optionalAuth,
    async (req: Request, res: Response): Promise<void> => {
      const { swLatitude, swLongitude, neLatitude, neLongitude, page, pageSize } = req.query;

      const params = {
        swLatitude: swLatitude ? Number(swLatitude) : undefined,
        swLongitude: swLongitude ? Number(swLongitude) : undefined,
        neLatitude: neLatitude ? Number(neLatitude) : undefined,
        neLongitude: neLongitude ? Number(neLongitude) : undefined,
      };

      const pagination =
        page !== undefined || pageSize !== undefined
          ? {
              page: page ? Number(page) : undefined,
              pageSize: pageSize ? Number(pageSize) : undefined,
            }
          : undefined;

      const result = await geospatialService.findInBoundingBox(params, pagination);

      if (!result.success) {
        const status = ERROR_HTTP_STATUS[result.error.code as ErrorCode] ?? 500;
        res.status(status).json({ error: result.error });
        return;
      }

      res.status(200).json(result.data);
    },
  );

  return router;
}
