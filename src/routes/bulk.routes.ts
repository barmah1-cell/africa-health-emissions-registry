/**
 * Bulk Import/Export Routes
 *
 * - POST /facilities/import  → CSV bulk import (admin only)
 * - GET  /facilities/export  → CSV export with filters (optional auth)
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, optionalAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/requireAdmin';
import { ImportService } from '../services/import.service';
import { ExportService } from '../services/export.service';
import { ERROR_HTTP_STATUS, ErrorCode } from '../types/api';

/**
 * Creates the bulk import/export routes router.
 *
 * @param prisma - Prisma client instance for database access
 * @returns Express Router with import/export endpoints
 */
export function createBulkRouter(prisma: PrismaClient): Router {
  const router = Router();
  const importService = new ImportService(prisma);
  const exportService = new ExportService(prisma);

  /**
   * POST /facilities/import
   * Bulk import facilities from a CSV file.
   * Expects raw CSV content in the request body as a Buffer/string.
   * Admin role required.
   */
  router.post(
    '/facilities/import',
    authenticate,
    requireAdmin,
    async (req: Request, res: Response): Promise<void> => {
      const userId = req.user!.id;

      // The CSV content comes as the raw request body
      // Express json parser will have parsed it if Content-Type is application/json,
      // but for CSV we expect it as a buffer or the body might be a string with csv field.
      let fileBuffer: Buffer;

      if (Buffer.isBuffer(req.body)) {
        fileBuffer = req.body;
      } else if (typeof req.body === 'string') {
        fileBuffer = Buffer.from(req.body, 'utf-8');
      } else if (req.body && typeof req.body.csv === 'string') {
        // Support JSON envelope: { "csv": "..." }
        fileBuffer = Buffer.from(req.body.csv, 'utf-8');
      } else if (req.body && Buffer.isBuffer(req.body.file)) {
        fileBuffer = req.body.file;
      } else {
        // Try to use raw body content
        fileBuffer = Buffer.from(JSON.stringify(req.body), 'utf-8');
      }

      const result = await importService.importCsv(fileBuffer, userId);

      if (!result.success) {
        const status = ERROR_HTTP_STATUS[result.error.code as ErrorCode] ?? 500;
        res.status(status).json({ error: result.error });
        return;
      }

      res.status(200).json({ data: result.data });
    },
  );

  /**
   * GET /facilities/export
   * Export facilities matching filters as CSV.
   * Returns CSV content with appropriate Content-Type header.
   */
  router.get(
    '/facilities/export',
    optionalAuth,
    async (req: Request, res: Response): Promise<void> => {
      const { page, pageSize, ...filters } = req.query;

      const result = await exportService.exportCsv(filters);

      if (!result.success) {
        const status = ERROR_HTTP_STATUS[result.error.code as ErrorCode] ?? 500;
        res.status(status).json({ error: result.error });
        return;
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="facilities.csv"');
      res.status(200).send(result.data.csv);
    },
  );

  return router;
}
