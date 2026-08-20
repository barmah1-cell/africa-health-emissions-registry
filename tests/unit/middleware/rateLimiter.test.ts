/**
 * Unit tests for rate limiter middleware.
 *
 * Tests tracking of failed authentication attempts per source IP,
 * blocking after threshold, 429 response format, and reset on success.
 *
 * Validates: Requirement 16.6
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import {
  rateLimitMiddleware,
  checkRateLimit,
  recordFailedAttempt,
  resetAttempts,
  clearRateLimitStore,
} from '../../../src/middleware/rateLimiter';

/** Helper to create a mock Express request with a given IP */
function createMockRequest(ip: string = '192.168.1.1'): Partial<Request> {
  return {
    ip,
    socket: { remoteAddress: ip } as any,
    headers: {},
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

describe('Rate Limiter', () => {
  beforeEach(() => {
    clearRateLimitStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('checkRateLimit', () => {
    it('should return not blocked for an unknown source', () => {
      const result = checkRateLimit('10.0.0.1');
      expect(result).toEqual({ blocked: false });
    });

    it('should return not blocked when fewer than 10 attempts recorded', () => {
      for (let i = 0; i < 9; i++) {
        recordFailedAttempt('10.0.0.1');
      }
      const result = checkRateLimit('10.0.0.1');
      expect(result).toEqual({ blocked: false });
    });

    it('should return blocked with remaining seconds after 10 failures', () => {
      for (let i = 0; i < 10; i++) {
        recordFailedAttempt('10.0.0.1');
      }
      const result = checkRateLimit('10.0.0.1');
      expect(result.blocked).toBe(true);
      expect(result.remainingSeconds).toBe(300);
    });

    it('should return not blocked after block duration expires', () => {
      for (let i = 0; i < 10; i++) {
        recordFailedAttempt('10.0.0.1');
      }

      // Advance time past the block duration (300 seconds)
      vi.advanceTimersByTime(300 * 1000);

      const result = checkRateLimit('10.0.0.1');
      expect(result).toEqual({ blocked: false });
    });

    it('should return decreasing remaining seconds as time passes', () => {
      for (let i = 0; i < 10; i++) {
        recordFailedAttempt('10.0.0.1');
      }

      vi.advanceTimersByTime(100 * 1000); // 100 seconds pass

      const result = checkRateLimit('10.0.0.1');
      expect(result.blocked).toBe(true);
      expect(result.remainingSeconds).toBe(200);
    });
  });

  describe('recordFailedAttempt', () => {
    it('should track attempts and block after 10 consecutive failures within 60s', () => {
      for (let i = 0; i < 10; i++) {
        recordFailedAttempt('10.0.0.2');
      }
      const result = checkRateLimit('10.0.0.2');
      expect(result.blocked).toBe(true);
    });

    it('should not block if attempts span more than 60 seconds', () => {
      // Record 5 attempts at time 0
      for (let i = 0; i < 5; i++) {
        recordFailedAttempt('10.0.0.3');
      }

      // Advance 61 seconds (outside the window)
      vi.advanceTimersByTime(61 * 1000);

      // Record 5 more attempts
      for (let i = 0; i < 5; i++) {
        recordFailedAttempt('10.0.0.3');
      }

      // Only 5 attempts within the current window, should not be blocked
      const result = checkRateLimit('10.0.0.3');
      expect(result).toEqual({ blocked: false });
    });

    it('should block when all 10 attempts happen within 60 seconds', () => {
      // Record 10 attempts with small time gaps (all within 60s window)
      for (let i = 0; i < 10; i++) {
        recordFailedAttempt('10.0.0.4');
        vi.advanceTimersByTime(5 * 1000); // 5 seconds between each
      }
      const result = checkRateLimit('10.0.0.4');
      expect(result.blocked).toBe(true);
    });

    it('should not record additional attempts while already blocked', () => {
      // Block the source
      for (let i = 0; i < 10; i++) {
        recordFailedAttempt('10.0.0.5');
      }

      expect(checkRateLimit('10.0.0.5').blocked).toBe(true);

      // Additional attempts should not change anything
      recordFailedAttempt('10.0.0.5');

      // Should still be blocked with same timing
      const result = checkRateLimit('10.0.0.5');
      expect(result.blocked).toBe(true);
      expect(result.remainingSeconds).toBe(300);
    });
  });

  describe('resetAttempts', () => {
    it('should clear all tracking for a source', () => {
      for (let i = 0; i < 9; i++) {
        recordFailedAttempt('10.0.0.6');
      }

      resetAttempts('10.0.0.6');

      // After reset, should need 10 fresh attempts to block
      const result = checkRateLimit('10.0.0.6');
      expect(result).toEqual({ blocked: false });
    });

    it('should clear a blocked source', () => {
      for (let i = 0; i < 10; i++) {
        recordFailedAttempt('10.0.0.7');
      }
      expect(checkRateLimit('10.0.0.7').blocked).toBe(true);

      resetAttempts('10.0.0.7');

      expect(checkRateLimit('10.0.0.7')).toEqual({ blocked: false });
    });

    it('should not affect other sources', () => {
      for (let i = 0; i < 10; i++) {
        recordFailedAttempt('10.0.0.8');
        recordFailedAttempt('10.0.0.9');
      }

      resetAttempts('10.0.0.8');

      expect(checkRateLimit('10.0.0.8')).toEqual({ blocked: false });
      expect(checkRateLimit('10.0.0.9').blocked).toBe(true);
    });
  });

  describe('rateLimitMiddleware', () => {
    it('should call next() when source is not blocked', () => {
      const req = createMockRequest('192.168.1.1');
      const res = createMockResponse();
      const next = vi.fn();

      rateLimitMiddleware(req as Request, res as unknown as Response, next as NextFunction);

      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBe(0);
    });

    it('should return 429 with RATE_LIMITED error when source is blocked', () => {
      const source = '192.168.1.2';
      for (let i = 0; i < 10; i++) {
        recordFailedAttempt(source);
      }

      const req = createMockRequest(source);
      const res = createMockResponse();
      const next = vi.fn();

      rateLimitMiddleware(req as Request, res as unknown as Response, next as NextFunction);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(429);
      expect(res.body).toEqual({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many failed authentication attempts. Try again in 300 seconds.',
          details: [
            {
              field: 'remainingSeconds',
              message: 'Blocked for 300 more seconds',
            },
          ],
        },
      });
    });

    it('should include correct remaining seconds in the error response', () => {
      const source = '192.168.1.3';
      for (let i = 0; i < 10; i++) {
        recordFailedAttempt(source);
      }

      // Advance 150 seconds
      vi.advanceTimersByTime(150 * 1000);

      const req = createMockRequest(source);
      const res = createMockResponse();
      const next = vi.fn();

      rateLimitMiddleware(req as Request, res as unknown as Response, next as NextFunction);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(429);
      expect((res.body as any).error.message).toBe(
        'Too many failed authentication attempts. Try again in 150 seconds.'
      );
      expect((res.body as any).error.details[0].message).toBe('Blocked for 150 more seconds');
    });

    it('should allow requests after block duration expires', () => {
      const source = '192.168.1.4';
      for (let i = 0; i < 10; i++) {
        recordFailedAttempt(source);
      }

      // Advance past block duration
      vi.advanceTimersByTime(301 * 1000);

      const req = createMockRequest(source);
      const res = createMockResponse();
      const next = vi.fn();

      rateLimitMiddleware(req as Request, res as unknown as Response, next as NextFunction);

      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBe(0);
    });

    it('should use req.ip as the source identifier', () => {
      const source = '10.1.1.1';
      for (let i = 0; i < 10; i++) {
        recordFailedAttempt(source);
      }

      const req = createMockRequest(source);
      const res = createMockResponse();
      const next = vi.fn();

      rateLimitMiddleware(req as Request, res as unknown as Response, next as NextFunction);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(429);
    });

    it('should isolate rate limits per source IP', () => {
      // Block one source
      for (let i = 0; i < 10; i++) {
        recordFailedAttempt('blocked-ip');
      }

      // Other source should not be affected
      const req = createMockRequest('clean-ip');
      const res = createMockResponse();
      const next = vi.fn();

      rateLimitMiddleware(req as Request, res as unknown as Response, next as NextFunction);

      expect(next).toHaveBeenCalled();
    });
  });
});
