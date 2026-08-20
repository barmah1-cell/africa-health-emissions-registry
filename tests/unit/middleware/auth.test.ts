/**
 * Unit tests for JWT authentication middleware.
 *
 * Tests the authenticate and optionalAuth middleware functions,
 * verifying correct behavior for valid tokens, missing tokens,
 * invalid tokens, and expired tokens.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authenticate, optionalAuth } from '../../../src/middleware/auth';
import { UserRole } from '../../../src/types/enums';

const TEST_SECRET = 'test-jwt-secret-for-unit-tests';

/** Helper to create a mock Express request */
function createMockRequest(authHeader?: string): Partial<Request> {
  return {
    headers: {
      ...(authHeader !== undefined ? { authorization: authHeader } : {}),
    },
  } as Partial<Request>;
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

/** Helper to generate a valid test token */
function createTestToken(payload: { sub: string; role: 'user' | 'admin' }, expiresIn: string = '1h'): string {
  return jwt.sign(payload, TEST_SECRET, { expiresIn });
}

describe('authenticate middleware', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
  });

  it('should attach user to request and call next for a valid token', () => {
    const token = createTestToken({ sub: 'user-123', role: 'admin' });
    const req = createMockRequest(`Bearer ${token}`);
    const res = createMockResponse();
    const next = vi.fn();

    authenticate(req as Request, res as unknown as Response, next as NextFunction);

    expect(next).toHaveBeenCalled();
    expect((req as Request).user).toEqual({
      id: 'user-123',
      role: UserRole.Admin,
    });
  });

  it('should attach user role as User for non-admin tokens', () => {
    const token = createTestToken({ sub: 'user-456', role: 'user' });
    const req = createMockRequest(`Bearer ${token}`);
    const res = createMockResponse();
    const next = vi.fn();

    authenticate(req as Request, res as unknown as Response, next as NextFunction);

    expect(next).toHaveBeenCalled();
    expect((req as Request).user).toEqual({
      id: 'user-456',
      role: UserRole.User,
    });
  });

  it('should return 401 AUTHENTICATION_REQUIRED when no Authorization header is present', () => {
    const req = createMockRequest(undefined);
    const res = createMockResponse();
    const next = vi.fn();

    authenticate(req as Request, res as unknown as Response, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication credentials are required',
        details: [],
      },
    });
  });

  it('should return 401 when Authorization header has no Bearer prefix', () => {
    const token = createTestToken({ sub: 'user-123', role: 'user' });
    const req = createMockRequest(`Basic ${token}`);
    const res = createMockResponse();
    const next = vi.fn();

    authenticate(req as Request, res as unknown as Response, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication credentials are required',
        details: [],
      },
    });
  });

  it('should return 401 for an invalid (malformed) token', () => {
    const req = createMockRequest('Bearer not-a-valid-jwt-token');
    const res = createMockResponse();
    const next = vi.fn();

    authenticate(req as Request, res as unknown as Response, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication credentials are not valid',
        details: [],
      },
    });
  });

  it('should return 401 for an expired token', () => {
    // Create a token that's already expired
    const token = jwt.sign({ sub: 'user-123', role: 'user' }, TEST_SECRET, { expiresIn: '-1s' });
    const req = createMockRequest(`Bearer ${token}`);
    const res = createMockResponse();
    const next = vi.fn();

    authenticate(req as Request, res as unknown as Response, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication credentials are not valid',
        details: [],
      },
    });
  });

  it('should return 401 for a token signed with a different secret', () => {
    const token = jwt.sign({ sub: 'user-123', role: 'user' }, 'wrong-secret', { expiresIn: '1h' });
    const req = createMockRequest(`Bearer ${token}`);
    const res = createMockResponse();
    const next = vi.fn();

    authenticate(req as Request, res as unknown as Response, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication credentials are not valid',
        details: [],
      },
    });
  });

  it('should return 401 when JWT_SECRET is not configured', () => {
    delete process.env.JWT_SECRET;
    const token = createTestToken({ sub: 'user-123', role: 'user' });
    const req = createMockRequest(`Bearer ${token}`);
    const res = createMockResponse();
    const next = vi.fn();

    authenticate(req as Request, res as unknown as Response, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});

describe('optionalAuth middleware', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
  });

  it('should call next without attaching user when no Authorization header is present', () => {
    const req = createMockRequest(undefined);
    const res = createMockResponse();
    const next = vi.fn();

    optionalAuth(req as Request, res as unknown as Response, next as NextFunction);

    expect(next).toHaveBeenCalled();
    expect((req as Request).user).toBeUndefined();
  });

  it('should attach user and call next for a valid token', () => {
    const token = createTestToken({ sub: 'user-789', role: 'admin' });
    const req = createMockRequest(`Bearer ${token}`);
    const res = createMockResponse();
    const next = vi.fn();

    optionalAuth(req as Request, res as unknown as Response, next as NextFunction);

    expect(next).toHaveBeenCalled();
    expect((req as Request).user).toEqual({
      id: 'user-789',
      role: UserRole.Admin,
    });
  });

  it('should call next without attaching user for an invalid token (pass through)', () => {
    const req = createMockRequest('Bearer invalid-token');
    const res = createMockResponse();
    const next = vi.fn();

    optionalAuth(req as Request, res as unknown as Response, next as NextFunction);

    expect(next).toHaveBeenCalled();
    expect((req as Request).user).toBeUndefined();
  });

  it('should call next without attaching user for an expired token', () => {
    const token = jwt.sign({ sub: 'user-123', role: 'user' }, TEST_SECRET, { expiresIn: '-1s' });
    const req = createMockRequest(`Bearer ${token}`);
    const res = createMockResponse();
    const next = vi.fn();

    optionalAuth(req as Request, res as unknown as Response, next as NextFunction);

    expect(next).toHaveBeenCalled();
    expect((req as Request).user).toBeUndefined();
  });

  it('should call next without user when Authorization header is malformed', () => {
    const req = createMockRequest('NotBearer something');
    const res = createMockResponse();
    const next = vi.fn();

    optionalAuth(req as Request, res as unknown as Response, next as NextFunction);

    expect(next).toHaveBeenCalled();
    expect((req as Request).user).toBeUndefined();
  });

  it('should pass through when JWT_SECRET is not configured', () => {
    delete process.env.JWT_SECRET;
    const req = createMockRequest('Bearer some-token');
    const res = createMockResponse();
    const next = vi.fn();

    optionalAuth(req as Request, res as unknown as Response, next as NextFunction);

    expect(next).toHaveBeenCalled();
    expect((req as Request).user).toBeUndefined();
  });
});
