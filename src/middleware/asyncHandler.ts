/**
 * Async Route Handler Wrapper
 *
 * Wraps async Express route handlers to ensure that rejected promises
 * are forwarded to the Express error handler middleware.
 *
 * Express 4 does not automatically catch errors from async handlers;
 * without this wrapper, unhandled rejections would crash the process
 * instead of returning a proper error response.
 *
 * Usage:
 *   router.get('/path', asyncHandler(async (req, res) => { ... }));
 */

import { Request, Response, NextFunction } from 'express';

type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>;

/**
 * Wraps an async route handler so that any thrown error or rejected promise
 * is automatically forwarded to Express's next(err) error handler.
 *
 * @param fn - An async Express route handler
 * @returns A synchronous handler that catches promise rejections
 */
export function asyncHandler(fn: AsyncRouteHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
