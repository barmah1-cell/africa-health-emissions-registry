import { describe, it, expect, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validateBody, validateQuery, validateParams } from '../../src/middleware/validate';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockRequest(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    query: {},
    params: {},
    ...overrides,
  } as unknown as Request;
}

function mockResponse(): Response & { _status: number; _json: unknown } {
  const res = {
    _status: 0,
    _json: null as unknown,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(data: unknown) {
      res._json = data;
      return res;
    },
  };
  return res as unknown as Response & { _status: number; _json: unknown };
}

// ---------------------------------------------------------------------------
// Test schema
// ---------------------------------------------------------------------------

const TestSchema = z.object({
  name: z.string().min(1, 'Name is required').max(500, 'Name must not exceed 500 characters'),
  country: z.enum(['Kenya', 'Nigeria', 'Ghana']),
  age: z.number().int().min(0).optional(),
});

// ---------------------------------------------------------------------------
// validateBody
// ---------------------------------------------------------------------------

describe('validateBody', () => {
  it('passes valid body through and calls next()', () => {
    const req = mockRequest({ body: { name: 'Hospital', country: 'Kenya' } });
    const res = mockResponse();
    const next = vi.fn();

    validateBody(TestSchema)(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBe(0); // no response sent
    expect(req.body).toEqual({ name: 'Hospital', country: 'Kenya' });
  });

  it('replaces req.body with parsed/coerced data on success', () => {
    const req = mockRequest({ body: { name: 'Clinic', country: 'Ghana', age: 5 } });
    const res = mockResponse();
    const next = vi.fn();

    validateBody(TestSchema)(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.body).toEqual({ name: 'Clinic', country: 'Ghana', age: 5 });
  });

  it('returns 400 with VALIDATION_ERROR for invalid body', () => {
    const req = mockRequest({ body: { name: '', country: 'InvalidCountry' } });
    const res = mockResponse();
    const next = vi.fn();

    validateBody(TestSchema)(req, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    const json = res._json as any;
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.message).toBe('Validation failed');
    expect(json.error.details.length).toBeGreaterThanOrEqual(2);
  });

  it('returns 400 with all errors for empty body (not fail-fast)', () => {
    const req = mockRequest({ body: {} });
    const res = mockResponse();
    const next = vi.fn();

    validateBody(TestSchema)(req, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    const json = res._json as any;
    expect(json.error.code).toBe('VALIDATION_ERROR');
    // Should report errors for both 'name' and 'country' at minimum
    expect(json.error.details.length).toBeGreaterThanOrEqual(2);
    const fields = json.error.details.map((d: any) => d.field);
    expect(fields).toContain('name');
    expect(fields).toContain('country');
  });

  it('aggregates multiple validation errors into single response', () => {
    // Invalid name (too short), invalid country, invalid age (not integer)
    const req = mockRequest({
      body: { name: '', country: 'Mars', age: 3.5 },
    });
    const res = mockResponse();
    const next = vi.fn();

    validateBody(TestSchema)(req, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    const json = res._json as any;
    expect(json.error.code).toBe('VALIDATION_ERROR');
    // At least 3 errors: name empty, country invalid, age not integer
    expect(json.error.details.length).toBeGreaterThanOrEqual(3);
  });

  it('includes field path in error details for nested objects', () => {
    const NestedSchema = z.object({
      geolocation: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      }),
    });

    const req = mockRequest({
      body: { geolocation: { latitude: 200, longitude: -300 } },
    });
    const res = mockResponse();
    const next = vi.fn();

    validateBody(NestedSchema)(req, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    const json = res._json as any;
    const fields = json.error.details.map((d: any) => d.field);
    expect(fields).toContain('geolocation.latitude');
    expect(fields).toContain('geolocation.longitude');
  });
});

// ---------------------------------------------------------------------------
// validateQuery
// ---------------------------------------------------------------------------

describe('validateQuery', () => {
  const QuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    country: z.enum(['Kenya', 'Nigeria']).optional(),
  });

  it('passes valid query params through and calls next()', () => {
    const req = mockRequest({ query: { page: '2', country: 'Kenya' } as any });
    const res = mockResponse();
    const next = vi.fn();

    validateQuery(QuerySchema)(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBe(0);
  });

  it('returns 400 for invalid query params', () => {
    const req = mockRequest({ query: { page: '-1', country: 'Mars' } as any });
    const res = mockResponse();
    const next = vi.fn();

    validateQuery(QuerySchema)(req, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    const json = res._json as any;
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// validateParams
// ---------------------------------------------------------------------------

describe('validateParams', () => {
  const ParamsSchema = z.object({
    id: z.string().uuid('ID must be a valid UUID'),
  });

  it('passes valid URL params through and calls next()', () => {
    const req = mockRequest({ params: { id: '550e8400-e29b-41d4-a716-446655440000' } as any });
    const res = mockResponse();
    const next = vi.fn();

    validateParams(ParamsSchema)(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBe(0);
  });

  it('returns 400 for invalid URL params', () => {
    const req = mockRequest({ params: { id: 'not-a-uuid' } as any });
    const res = mockResponse();
    const next = vi.fn();

    validateParams(ParamsSchema)(req, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    const json = res._json as any;
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.details[0].field).toBe('id');
    expect(json.error.details[0].message).toContain('UUID');
  });
});
