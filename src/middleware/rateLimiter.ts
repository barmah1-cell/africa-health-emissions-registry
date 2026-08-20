/**
 * Rate Limiter Middleware
 *
 * Tracks failed authentication attempts per source IP and blocks
 * sources that exceed the threshold of consecutive failures.
 *
 * - Blocks source for 300 seconds after 10+ consecutive failures within 60 seconds
 * - Returns 429 RATE_LIMITED with remaining block time when blocked
 * - Resets counter on successful authentication
 *
 * Validates: Requirement 16.6
 */

import { Request, Response, NextFunction } from 'express';
import { ErrorResponse, ERROR_CODES, ERROR_HTTP_STATUS } from '../types/api';

/** Configuration constants */
const MAX_FAILED_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 60 * 1000; // 60 seconds
const BLOCK_DURATION_MS = 300 * 1000; // 300 seconds

/** Per-source tracking data */
interface RateLimitEntry {
  /** Timestamps of consecutive failed attempts (within the window) */
  attempts: number[];
  /** Timestamp when the block expires (undefined if not blocked) */
  blockedUntil?: number;
}

/** In-memory store for rate limiting data, keyed by source IP */
const store = new Map<string, RateLimitEntry>();

/**
 * Gets the source identifier from the request (IP address).
 */
function getSource(req: Request): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Checks whether a source is currently rate-limited.
 *
 * @param source - The source IP to check
 * @returns Object with blocked status and remaining seconds if blocked
 */
export function checkRateLimit(source: string): { blocked: boolean; remainingSeconds?: number } {
  const entry = store.get(source);
  if (!entry || !entry.blockedUntil) {
    return { blocked: false };
  }

  const now = Date.now();
  if (now >= entry.blockedUntil) {
    // Block has expired, clean up
    store.delete(source);
    return { blocked: false };
  }

  const remainingSeconds = Math.ceil((entry.blockedUntil - now) / 1000);
  return { blocked: true, remainingSeconds };
}

/**
 * Records a failed authentication attempt for a source.
 * If the source reaches 10+ consecutive failures within the 60-second window,
 * it will be blocked for 300 seconds.
 *
 * @param source - The source IP that failed authentication
 */
export function recordFailedAttempt(source: string): void {
  const now = Date.now();
  let entry = store.get(source);

  if (!entry) {
    entry = { attempts: [] };
    store.set(source, entry);
  }

  // If already blocked, no need to track more attempts
  if (entry.blockedUntil && now < entry.blockedUntil) {
    return;
  }

  // Add the current attempt timestamp
  entry.attempts.push(now);

  // Remove attempts that are outside the 60-second window
  const windowStart = now - ATTEMPT_WINDOW_MS;
  entry.attempts = entry.attempts.filter((ts) => ts > windowStart);

  // Check if threshold is reached
  if (entry.attempts.length >= MAX_FAILED_ATTEMPTS) {
    entry.blockedUntil = now + BLOCK_DURATION_MS;
    entry.attempts = []; // Clear attempts once blocked
  }
}

/**
 * Resets the failed attempt counter for a source.
 * Called on successful authentication.
 *
 * @param source - The source IP that authenticated successfully
 */
export function resetAttempts(source: string): void {
  store.delete(source);
}

/**
 * Clears the entire rate limit store.
 * Useful for testing purposes.
 */
export function clearRateLimitStore(): void {
  store.clear();
}

/**
 * Creates the 429 error response for rate-limited sources.
 */
function createRateLimitError(remainingSeconds: number): ErrorResponse {
  return {
    error: {
      code: ERROR_CODES.RATE_LIMITED as typeof ERROR_CODES.RATE_LIMITED,
      message: `Too many failed authentication attempts. Try again in ${remainingSeconds} seconds.`,
      details: [
        {
          field: 'remainingSeconds',
          message: `Blocked for ${remainingSeconds} more seconds`,
        },
      ],
    },
  };
}

/**
 * Middleware that checks if a source is rate-limited before processing.
 * Should be placed before the authenticate middleware on write endpoints.
 *
 * If the source is blocked, returns 429 RATE_LIMITED immediately.
 * Otherwise, passes through to the next middleware.
 */
export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const source = getSource(req);
  const { blocked, remainingSeconds } = checkRateLimit(source);

  if (blocked) {
    const status = ERROR_HTTP_STATUS.RATE_LIMITED;
    res.status(status).json(createRateLimitError(remainingSeconds!));
    return;
  }

  next();
}
