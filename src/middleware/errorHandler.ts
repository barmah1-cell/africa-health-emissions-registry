/**
 * Centralized Error Handler Middleware
 *
 * Catches all unhandled errors and returns consistent error responses.
 * Maps known error types to their appropriate error codes:
 * - Zod validation errors → VALIDATION_ERROR with field details
 * - Prisma P2002 (unique constraint) → DUPLICATE_RECORD
 * - Prisma connection/timeout errors → 503 Service Unavailable
 * - SyntaxError from JSON parsing → INVALID_FORMAT
 * - All other errors → 500 with generic message (no internal details leaked)
 *
 * Validates: Requirements 1.3, 3.3, 15.10
 */

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { ErrorResponse, ERROR_CODES, ERROR_HTTP_STATUS, ErrorDetail } from '../types/api';

/**
 * Express error-handling middleware.
 * Must be registered LAST in the middleware chain (after all routes).
 *
 * Handles:
 * 1. Zod validation errors → 400 VALIDATION_ERROR with field-level details
 * 2. Prisma unique constraint violations (P2002) → 409 DUPLICATE_RECORD
 * 3. Prisma connection/unavailable errors (P1001, P1002, P1008, P1017, P2024) → 503
 * 4. JSON SyntaxError → 400 INVALID_FORMAT
 * 5. Unknown errors → 500 with generic message
 *
 * Internal details (stack traces, query content, Prisma metadata) are never
 * exposed to clients. All errors are logged server-side for debugging.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Log the error server-side for debugging (never sent to client)
  console.error('Unhandled error:', err.message);

  // 1. Zod validation errors
  if (err instanceof ZodError) {
    const details: ErrorDetail[] = err.issues.map((issue) => ({
      field: issue.path.join('.') || '_root',
      message: issue.message,
    }));

    const errorResponse: ErrorResponse = {
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Validation failed',
        details,
      },
    };

    res.status(ERROR_HTTP_STATUS.VALIDATION_ERROR).json(errorResponse);
    return;
  }

  // 2. Prisma known request errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    handlePrismaKnownError(err, res);
    return;
  }

  // 3. Prisma initialization/connection errors → 503
  if (
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError
  ) {
    const errorResponse: ErrorResponse = {
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Service temporarily unavailable',
        details: [],
      },
    };

    res.status(503).json(errorResponse);
    return;
  }

  // 4. JSON parsing SyntaxError
  if (err instanceof SyntaxError && 'body' in err) {
    const errorResponse: ErrorResponse = {
      error: {
        code: ERROR_CODES.INVALID_FORMAT,
        message: 'Invalid JSON in request body',
        details: [],
      },
    };

    res.status(ERROR_HTTP_STATUS.INVALID_FORMAT).json(errorResponse);
    return;
  }

  // 5. Generic fallback — never leak internal details
  const errorResponse: ErrorResponse = {
    error: {
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'An unexpected error occurred',
      details: [],
    },
  };

  res.status(500).json(errorResponse);
}

/**
 * Handles Prisma known request errors by error code.
 * Maps specific Prisma error codes to appropriate API error responses.
 */
function handlePrismaKnownError(
  err: Prisma.PrismaClientKnownRequestError,
  res: Response,
): void {
  switch (err.code) {
    // Unique constraint violation
    case 'P2002': {
      const errorResponse: ErrorResponse = {
        error: {
          code: ERROR_CODES.DUPLICATE_RECORD,
          message: 'A record with the same unique values already exists',
          details: [],
        },
      };
      res.status(ERROR_HTTP_STATUS.DUPLICATE_RECORD).json(errorResponse);
      return;
    }

    // Record not found (for update/delete operations)
    case 'P2025': {
      const errorResponse: ErrorResponse = {
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'The requested record was not found',
          details: [],
        },
      };
      res.status(ERROR_HTTP_STATUS.NOT_FOUND).json(errorResponse);
      return;
    }

    // Connection-related errors → 503
    case 'P1001': // Can't reach database server
    case 'P1002': // Database server timeout
    case 'P1008': // Operations timed out
    case 'P1017': // Server has closed the connection
    case 'P2024': // Timed out fetching a new connection from the pool
    {
      const errorResponse: ErrorResponse = {
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Service temporarily unavailable',
          details: [],
        },
      };
      res.status(503).json(errorResponse);
      return;
    }

    // All other Prisma errors → 500 generic
    default: {
      const errorResponse: ErrorResponse = {
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'An unexpected error occurred',
          details: [],
        },
      };
      res.status(500).json(errorResponse);
      return;
    }
  }
}
