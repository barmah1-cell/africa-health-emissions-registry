/**
 * Map Routes
 *
 * Lightweight slim-marker endpoint for the Leaflet map:
 * - GET /facilities/map → Return minimal marker fields with optional bbox/filters
 *
 * Reuses the geospatial router factory pattern, optionalAuth for public reads,
 * and ERROR_HTTP_STATUS mapping. Adds HTTP caching (ETag / Cache-Control / 304).
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { optionalAuth } from '../middleware/auth';
import { MapService } from '../services/map.service';
import { ERROR_HTTP_STATUS, ErrorCode } from '../types/api';

/**
 * Creates the map routes router.
 *
 * @param prisma - Prisma client instance for database access
 * @returns Express Router with the slim map endpoint
 */
export function createMapRouter(prisma: PrismaClient): Router {
  const router = Router();
  const mapService = new MapService(prisma);

  /**
   * GET /facilities/map
   * Return slim marker projections, optionally constrained to a bounding box
   * (all-or-nothing) and/or attribute filters. Public read via optionalAuth.
   * Query params: sw_lat, sw_lon, ne_lat, ne_lon, country, facilityType, operationalStatus
   */
  router.get(
    '/facilities/map',
    optionalAuth,
    async (req: Request, res: Response): Promise<void> => {
      const { sw_lat, sw_lon, ne_lat, ne_lon, country, facilityType, operationalStatus, limit } =
        req.query;

      const result = await mapService.getMapMarkers({
        swLatitude: sw_lat !== undefined ? Number(sw_lat) : undefined,
        swLongitude: sw_lon !== undefined ? Number(sw_lon) : undefined,
        neLatitude: ne_lat !== undefined ? Number(ne_lat) : undefined,
        neLongitude: ne_lon !== undefined ? Number(ne_lon) : undefined,
        country,
        facilityType,
        operationalStatus,
        limit: limit !== undefined ? Number(limit) : undefined,
      });

      if (!result.success) {
        const status = ERROR_HTTP_STATUS[result.error.code as ErrorCode] ?? 500;
        res.status(status).json({ error: result.error });
        return;
      }

      // Serialize once and derive a stable ETag from the body. Deterministic
      // ordering (name_text ASC) keeps the ETag stable across identical requests.
      const body = JSON.stringify(result.data);
      const etag = `"${createHash('sha1').update(body).digest('hex')}"`;

      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'public, max-age=60');

      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }

      res.status(200).type('application/json').send(body);
    },
  );

  return router;
}
