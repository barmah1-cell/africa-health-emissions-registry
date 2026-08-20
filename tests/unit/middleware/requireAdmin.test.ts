/**
 * Unit tests for role-based authorization middleware (requireAdmin).
 *
 * Tests that Admin-restricted operations are properly guarded:
 * - Admin users are allowed through
 * - Non-admin users receive 403 INSUFFICIENT_PRIVILEGES
 * - Unauthenticated requests (no req.user) receive 403
 *
 * Validates: Requirements 4.3, 4.4, 16.5
 */

import { describe, it, expect, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { requireAdmin } from '../../../src/middleware/requireAdmin';
import { UserRole } from '../../../src/types/enums';

/** Helper to create a mock Express request with optional user */
function createMockRequest(user?: { id: string; role: UserRole }): Partial<Request> {
  const req: Partial<Request> = {
    headers: {},
  };
  if (user) {
    (req as Request).user = user;
  }
  return req;
}

/** Helper to create a mock Express response */
function createMockResponse(): Partial<Response> & { statusCode: number; body: unknown } {
  const res: Partial<Response> & { statusCode: number; body: unknown } = {
    statusCode: 0,
    body: null,
    status(code: number) {
      res.statusCode = code;
      return res as Response;
    },
    json(data: unknown) {
      res.body = data;
      return res as Response;
    },
  };
  return res;
}

describe('requireAdmin middleware', () => {
  it('should call next() when user has Admin role', () => {
    const req = createMockRequest({ id: 'admin-001', role: UserRole.Admin });
    const res = createMockResponse();
    const next = vi.fn();

    requireAdmin(req as Request, res as unknown as Response, next as NextFunction);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(0); // response not touched
  });

  it('should return 403 INSUFFICIENT_PRIVILEGES for User role', () => {
    const req = createMockRequest({ id: 'user-001', role: UserRole.User });
    const res = createMockResponse();
    const next = vi.fn();

    requireAdmin(req as Request, res as unknown as Response, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: {
        code: 'INSUFFICIENT_PRIVILEGES',
        message: 'Admin privileges are required for this operation',
        details: [],
      },
    });
  });

  it('should return 403 INSUFFICIENT_PRIVILEGES when req.user is undefined', () => {
    const req = createMockRequest(undefined);
    const res = createMockResponse();
    const next = vi.fn();

    requireAdmin(req as Request, res as unknown as Response, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: {
        code: 'INSUFFICIENT_PRIVILEGES',
        message: 'Admin privileges are required for this operation',
        details: [],
      },
    });
  });

  it('should not modify the request object', () => {
    const user = { id: 'admin-002', role: UserRole.Admin };
    const req = createMockRequest(user);
    const res = createMockResponse();
    const next = vi.fn();

    requireAdmin(req as Request, res as unknown as Response, next as NextFunction);

    expect((req as Request).user).toEqual(user);
  });

  it('should not call next() when returning 403', () => {
    const req = createMockRequest({ id: 'user-002', role: UserRole.User });
    const res = createMockResponse();
    const next = vi.fn();

    requireAdmin(req as Request, res as unknown as Response, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
  });
});
