/**
 * Tests for Centralized Error Handler Middleware
 *
 * Verifies consistent error response formatting:
 * - Zod validation errors → VALIDATION_ERROR with field details
 * - Prisma P2002 unique constraint → DUPLICATE_RECORD (409)
 * - Prisma P2025 not found → NOT_FOUND (404)
 * - Prisma connection errors → 503
 * - JSON SyntaxError → INVALID_FORMAT (400)
 * - Unknown errors → 500 generic (no internal details leaked)
 *
 * Validates: Requirements 1.3, 3.3, 15.10
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { ZodError, ZodIssue, ZodIssueCode } from 'zod';
import { Prisma } from '@prisma/client';
import { errorHandler } from '../../src/middleware/errorHandler';

// Mock request/response/next for isolated middleware testing
function createMockReqResNext() {
  const req = {} as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

describe('errorHandler middleware', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('Zod validation errors', () => {
    it('should map ZodError to VALIDATION_ERROR with field details', () => {
      const { req, res, next } = createMockReqResNext();

      const issues: ZodIssue[] = [
        {
          code: ZodIssueCode.invalid_type,
          expected: 'string',
          received: 'undefined',
          path: ['name'],
          message: 'Required',
        },
        {
          code: ZodIssueCode.invalid_type,
          expected: 'string',
          received: 'number',
          path: ['country'],
          message: 'Expected string, received number',
        },
      ];

      const zodError = new ZodError(issues);

      errorHandler(zodError, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: [
            { field: 'name', message: 'Required' },
            { field: 'country', message: 'Expected string, received number' },
          ],
        },
      });
    });

    it('should use _root for field path when path is empty', () => {
      const { req, res, next } = createMockReqResNext();

      const issues: ZodIssue[] = [
        {
          code: ZodIssueCode.invalid_type,
          expected: 'object',
          received: 'undefined',
          path: [],
          message: 'Expected object',
        },
      ];

      const zodError = new ZodError(issues);

      errorHandler(zodError, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.error.details[0].field).toBe('_root');
    });
  });

  describe('Prisma unique constraint errors (P2002)', () => {
    it('should map P2002 to DUPLICATE_RECORD (409)', () => {
      const { req, res, next } = createMockReqResNext();

      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`name`, `country`, `location`)',
        { code: 'P2002', clientVersion: '5.0.0', meta: { target: ['name', 'country', 'location'] } },
      );

      errorHandler(prismaError, req, res, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error: {
          code: 'DUPLICATE_RECORD',
          message: 'A record with the same unique values already exists',
          details: [],
        },
      });
    });
  });

  describe('Prisma not found errors (P2025)', () => {
    it('should map P2025 to NOT_FOUND (404)', () => {
      const { req, res, next } = createMockReqResNext();

      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'An operation failed because it depends on one or more records that were required but not found.',
        { code: 'P2025', clientVersion: '5.0.0', meta: {} },
      );

      errorHandler(prismaError, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: {
          code: 'NOT_FOUND',
          message: 'The requested record was not found',
          details: [],
        },
      });
    });
  });

  describe('Prisma connection/timeout errors', () => {
    it('should map P1001 (unreachable DB) to 503', () => {
      const { req, res, next } = createMockReqResNext();

      const prismaError = new Prisma.PrismaClientKnownRequestError(
        "Can't reach database server at `localhost:5432`",
        { code: 'P1001', clientVersion: '5.0.0', meta: {} },
      );

      errorHandler(prismaError, req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Service temporarily unavailable',
          details: [],
        },
      });
    });

    it('should map P2024 (connection pool timeout) to 503', () => {
      const { req, res, next } = createMockReqResNext();

      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Timed out fetching a new connection from the connection pool',
        { code: 'P2024', clientVersion: '5.0.0', meta: {} },
      );

      errorHandler(prismaError, req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('should map PrismaClientInitializationError to 503', () => {
      const { req, res, next } = createMockReqResNext();

      const prismaError = new Prisma.PrismaClientInitializationError(
        'Unable to connect to the database',
        '5.0.0',
      );

      errorHandler(prismaError, req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.error.message).toBe('Service temporarily unavailable');
    });
  });

  describe('JSON SyntaxError', () => {
    it('should map JSON parse SyntaxError to INVALID_FORMAT (400)', () => {
      const { req, res, next } = createMockReqResNext();

      const syntaxError = new SyntaxError('Unexpected token } in JSON at position 42');
      (syntaxError as any).body = '{ invalid json }';

      errorHandler(syntaxError, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: {
          code: 'INVALID_FORMAT',
          message: 'Invalid JSON in request body',
          details: [],
        },
      });
    });

    it('should not treat non-body SyntaxError as INVALID_FORMAT', () => {
      const { req, res, next } = createMockReqResNext();

      const syntaxError = new SyntaxError('Something else went wrong');

      errorHandler(syntaxError, req, res, next);

      // Should fall through to generic 500
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('Unknown/generic errors', () => {
    it('should return 500 with generic message for unknown errors', () => {
      const { req, res, next } = createMockReqResNext();

      const error = new Error('Database connection pool exhausted');

      errorHandler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'An unexpected error occurred',
          details: [],
        },
      });
    });

    it('should not leak stack traces or internal details', () => {
      const { req, res, next } = createMockReqResNext();

      const error = new Error('FATAL: password authentication failed for user "admin"');
      error.stack = 'Error: FATAL: password...\n    at PrismaClient._request (...)';

      errorHandler(error, req, res, next);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];

      // The response should NOT contain the original error message or stack
      expect(response.error.message).toBe('An unexpected error occurred');
      expect(JSON.stringify(response)).not.toContain('password');
      expect(JSON.stringify(response)).not.toContain('stack');
      expect(JSON.stringify(response)).not.toContain('FATAL');
    });

    it('should not leak Prisma query details for unhandled Prisma error codes', () => {
      const { req, res, next } = createMockReqResNext();

      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Foreign key constraint failed on the field: `facility_id`',
        { code: 'P2003', clientVersion: '5.0.0', meta: { field_name: 'facility_id' } },
      );

      errorHandler(prismaError, req, res, next);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.error.message).toBe('An unexpected error occurred');
      expect(JSON.stringify(response)).not.toContain('Foreign key');
      expect(JSON.stringify(response)).not.toContain('facility_id');
    });
  });

  describe('Error response structure', () => {
    it('should always return { error: { code, message, details } } structure', () => {
      const { req, res, next } = createMockReqResNext();

      errorHandler(new Error('anything'), req, res, next);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response).toHaveProperty('error');
      expect(response.error).toHaveProperty('code');
      expect(response.error).toHaveProperty('message');
      expect(response.error).toHaveProperty('details');
      expect(Array.isArray(response.error.details)).toBe(true);
    });
  });
});
