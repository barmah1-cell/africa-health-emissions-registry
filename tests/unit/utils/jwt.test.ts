/**
 * Unit tests for the JWT token generation utility.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { generateToken } from '../../../src/utils/jwt';

const TEST_SECRET = 'test-jwt-secret-for-unit-tests';

describe('generateToken', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
  });

  it('should generate a valid JWT token with correct claims', () => {
    const token = generateToken({ userId: 'user-123', role: 'admin' });

    const decoded = jwt.verify(token, TEST_SECRET) as jwt.JwtPayload;
    expect(decoded.sub).toBe('user-123');
    expect(decoded.role).toBe('admin');
    expect(decoded.iat).toBeDefined();
    expect(decoded.exp).toBeDefined();
  });

  it('should generate a token with user role', () => {
    const token = generateToken({ userId: 'user-456', role: 'user' });

    const decoded = jwt.verify(token, TEST_SECRET) as jwt.JwtPayload;
    expect(decoded.sub).toBe('user-456');
    expect(decoded.role).toBe('user');
  });

  it('should use default 24h expiration when expiresInSeconds is not specified', () => {
    const token = generateToken({ userId: 'user-123', role: 'user' });

    const decoded = jwt.verify(token, TEST_SECRET) as jwt.JwtPayload;
    const expectedExpiry = decoded.iat! + 24 * 60 * 60; // 24 hours in seconds
    expect(decoded.exp).toBe(expectedExpiry);
  });

  it('should use custom expiration when specified', () => {
    const token = generateToken({ userId: 'user-123', role: 'user', expiresInSeconds: 3600 });

    const decoded = jwt.verify(token, TEST_SECRET) as jwt.JwtPayload;
    const expectedExpiry = decoded.iat! + 3600; // 1 hour in seconds
    expect(decoded.exp).toBe(expectedExpiry);
  });

  it('should throw an error when JWT_SECRET is not configured', () => {
    delete process.env.JWT_SECRET;

    expect(() => generateToken({ userId: 'user-123', role: 'user' })).toThrow(
      'JWT_SECRET environment variable is not configured'
    );
  });
});
