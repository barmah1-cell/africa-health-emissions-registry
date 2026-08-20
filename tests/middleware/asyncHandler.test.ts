/**
 * Tests for Async Route Handler Wrapper
 *
 * Verifies that async route handlers have their rejections caught
 * and forwarded to Express error middleware via next(err).
 */

import { describe, it, expect, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../../src/middleware/asyncHandler';

function createMockReqResNext() {
  const req = {} as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

describe('asyncHandler', () => {
  it('should call the wrapped handler normally when it resolves', async () => {
    const { req, res, next } = createMockReqResNext();
    const handler = vi.fn().mockResolvedValue(undefined);

    const wrapped = asyncHandler(handler);
    wrapped(req, res, next);

    // Allow microtask to complete
    await new Promise((r) => setTimeout(r, 0));

    expect(handler).toHaveBeenCalledWith(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('should call next(err) when the handler rejects', async () => {
    const { req, res, next } = createMockReqResNext();
    const error = new Error('Something broke');
    const handler = vi.fn().mockRejectedValue(error);

    const wrapped = asyncHandler(handler);
    wrapped(req, res, next);

    // Allow microtask to complete
    await new Promise((r) => setTimeout(r, 0));

    expect(next).toHaveBeenCalledWith(error);
  });

  it('should call next(err) when the handler throws synchronously', async () => {
    const { req, res, next } = createMockReqResNext();
    const error = new Error('Sync throw');
    const handler = vi.fn().mockImplementation(async () => {
      throw error;
    });

    const wrapped = asyncHandler(handler);
    wrapped(req, res, next);

    // Allow microtask to complete
    await new Promise((r) => setTimeout(r, 0));

    expect(next).toHaveBeenCalledWith(error);
  });
});
