/**
 * Route Registry
 *
 * Creates and mounts all API routers onto the Express application.
 * All routes are prefixed with /api/v1.
 *
 * Route registration order matters for Express path matching:
 * 1. Geospatial routes (specific paths like /facilities/nearby, /facilities/bbox)
 * 2. Bulk routes (specific paths like /facilities/import, /facilities/export)
 * 3. Energy routes (parameterized paths like /facilities/:id/energy-profile)
 * 4. Audit routes (parameterized path /facilities/:id/audit)
 * 5. Facility CRUD routes (base /facilities with :id params last)
 * 6. Emission factor routes (separate /emission-factors namespace)
 */

import { Express } from 'express';
import { PrismaClient } from '@prisma/client';
import { createFacilityRouter } from './facility.routes';
import { createGeospatialRouter } from './geospatial.routes';
import { createBulkRouter } from './bulk.routes';
import { createEnergyRouter } from './energy.routes';
import { createEmissionFactorRouter } from './emissionFactor.routes';
import { createAuditRouter } from './audit.routes';

const API_PREFIX = '/api/v1';

/**
 * Registers all API routes on the Express app.
 *
 * @param app - The Express application instance
 * @param prisma - Prisma client instance shared across services
 */
export function registerRoutes(app: Express, prisma: PrismaClient): void {
  // Geospatial routes: /api/v1/facilities/nearby, /api/v1/facilities/bbox
  // Mounted at prefix level since paths include /facilities/
  app.use(API_PREFIX, createGeospatialRouter(prisma));

  // Bulk routes: /api/v1/facilities/import, /api/v1/facilities/export
  app.use(API_PREFIX, createBulkRouter(prisma));

  // Energy routes: /api/v1/facilities/:id/energy-profile, emissions
  app.use(API_PREFIX, createEnergyRouter(prisma));

  // Audit routes: /api/v1/facilities/:id/audit
  app.use(API_PREFIX, createAuditRouter(prisma));

  // Facility CRUD: /api/v1/facilities, /api/v1/facilities/:id
  app.use(`${API_PREFIX}/facilities`, createFacilityRouter(prisma));

  // Emission factor routes: /api/v1/emission-factors
  app.use(`${API_PREFIX}/emission-factors`, createEmissionFactorRouter(prisma));
}
