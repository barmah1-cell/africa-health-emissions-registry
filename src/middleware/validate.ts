/**
 * Generic validation middleware using Zod schemas.
 *
 * Provides middleware factories for validating request body, query params,
 * and URL params. All validation errors are aggregated into a single response
 * (not fail-fast) via Zod's safeParse method.
 *
 * Validates: Requirements 15.1-15.10
 */

import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { ErrorResponse, ERROR_CODES, ERROR_HTTP_STATUS, ErrorDetail } from '../types/api';

/**
 * Creates middleware that validates req.body against the given Zod schema.
 *
 * - Uses safeParse to collect ALL validation errors (not fail-fast).
 * - On success, replaces req.body with the parsed/coerced data and calls next().
 * - On failure, returns a 400 response with VALIDATION_ERROR code and all error details.
 */
export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (result.success) {
      req.body = result.data;
      next();
      return;
    }

    const details: ErrorDetail[] = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || '_root',
      message: issue.message,
    }));

    const errorResponse: ErrorResponse = {
      error: {
        code: ERROR_CODES.VALIDATION_ERROR as typeof ERROR_CODES.VALIDATION_ERROR,
        message: 'Validation failed',
        details,
      },
    };

    const status = ERROR_HTTP_STATUS.VALIDATION_ERROR;
    res.status(status).json(errorResponse);
  };
}

/**
 * Creates middleware that validates req.query against the given Zod schema.
 *
 * - Uses safeParse to collect ALL validation errors (not fail-fast).
 * - On success, replaces req.query with the parsed/coerced data and calls next().
 * - On failure, returns a 400 response with VALIDATION_ERROR code and all error details.
 */
export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);

    if (result.success) {
      (req as any).query = result.data;
      next();
      return;
    }

    const details: ErrorDetail[] = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || '_root',
      message: issue.message,
    }));

    const errorResponse: ErrorResponse = {
      error: {
        code: ERROR_CODES.VALIDATION_ERROR as typeof ERROR_CODES.VALIDATION_ERROR,
        message: 'Validation failed',
        details,
      },
    };

    const status = ERROR_HTTP_STATUS.VALIDATION_ERROR;
    res.status(status).json(errorResponse);
  };
}

/**
 * Creates middleware that validates req.params against the given Zod schema.
 *
 * - Uses safeParse to collect ALL validation errors (not fail-fast).
 * - On success, attaches parsed params to req.params and calls next().
 * - On failure, returns a 400 response with VALIDATION_ERROR code and all error details.
 */
export function validateParams(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);

    if (result.success) {
      (req as any).params = result.data;
      next();
      return;
    }

    const details: ErrorDetail[] = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || '_root',
      message: issue.message,
    }));

    const errorResponse: ErrorResponse = {
      error: {
        code: ERROR_CODES.VALIDATION_ERROR as typeof ERROR_CODES.VALIDATION_ERROR,
        message: 'Validation failed',
        details,
      },
    };

    const status = ERROR_HTTP_STATUS.VALIDATION_ERROR;
    res.status(status).json(errorResponse);
  };
}
