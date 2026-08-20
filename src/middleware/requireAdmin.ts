/**
 * Role-based authorization middleware.
 *
 * Checks that the authenticated user has Admin role.
 * Must be used after the `authenticate` middleware which attaches `req.user`.
 *
 * Returns 403 INSUFFICIENT_PRIVILEGES if the user is not an Admin.
 */

import { Request, Response, NextFunction } from 'express';
import { ErrorResponse, ERROR_CODES, ERROR_HTTP_STATUS } from '../types/api';
import { UserRole } from '../types/enums';

/**
 * Middleware that requires the authenticated user to have Admin role.
 * Should be placed after `authenticate` in the middleware chain.
 *
 * - Checks that req.user exists (authenticate should have set it)
 * - Checks that req.user.role is Admin
 * - Returns 403 INSUFFICIENT_PRIVILEGES if conditions are not met
 * - Calls next() if user is an Admin
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== UserRole.Admin) {
    const status = ERROR_HTTP_STATUS.INSUFFICIENT_PRIVILEGES;
    const errorResponse: ErrorResponse = {
      error: {
        code: ERROR_CODES.INSUFFICIENT_PRIVILEGES as typeof ERROR_CODES.INSUFFICIENT_PRIVILEGES,
        message: 'Admin privileges are required for this operation',
        details: [],
      },
    };
    res.status(status).json(errorResponse);
    return;
  }

  next();
}
