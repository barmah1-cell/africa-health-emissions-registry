/**
 * JWT Authentication Middleware
 *
 * Provides two middleware functions:
 * - authenticate: Validates JWT tokens on write endpoints (returns 401 if missing/invalid/expired)
 * - optionalAuth: For read endpoints - attaches user if token present, passes through otherwise
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ErrorResponse, ERROR_CODES, ERROR_HTTP_STATUS } from '../types/api';
import { UserRole } from '../types/enums';

/** JWT payload claims structure */
export interface JwtPayload {
  sub: string;
  role: 'user' | 'admin';
  iat?: number;
  exp?: number;
}

/** User info attached to the request after authentication */
export interface AuthUser {
  id: string;
  role: UserRole;
}

/**
 * Gets the JWT secret from environment variables.
 * Throws if JWT_SECRET is not configured.
 */
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not configured');
  }
  return secret;
}

/**
 * Extracts the Bearer token from the Authorization header.
 * Returns null if the header is missing or malformed.
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}

/**
 * Verifies a JWT token and returns the decoded payload.
 * Returns null if the token is invalid or expired.
 */
function verifyToken(token: string, secret: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, secret) as JwtPayload;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Creates the 401 error response for authentication failures.
 */
function createAuthError(message: string): ErrorResponse {
  return {
    error: {
      code: ERROR_CODES.AUTHENTICATION_REQUIRED as typeof ERROR_CODES.AUTHENTICATION_REQUIRED,
      message,
      details: [],
    },
  };
}

/**
 * Middleware that requires a valid JWT token.
 * Used on write endpoints (create, update, delete, import).
 *
 * - Checks Authorization header for Bearer token
 * - Validates JWT signature and expiration
 * - Attaches user info (id, role) to request
 * - Returns 401 AUTHENTICATION_REQUIRED if token is missing, invalid, or expired
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    const status = ERROR_HTTP_STATUS.AUTHENTICATION_REQUIRED;
    res.status(status).json(createAuthError('Authentication credentials are required'));
    return;
  }

  let secret: string;
  try {
    secret = getJwtSecret();
  } catch {
    const status = ERROR_HTTP_STATUS.AUTHENTICATION_REQUIRED;
    res.status(status).json(createAuthError('Authentication service is not configured'));
    return;
  }

  const payload = verifyToken(token, secret);

  if (!payload) {
    const status = ERROR_HTTP_STATUS.AUTHENTICATION_REQUIRED;
    res.status(status).json(createAuthError('Authentication credentials are not valid'));
    return;
  }

  req.user = {
    id: payload.sub,
    role: payload.role === 'admin' ? UserRole.Admin : UserRole.User,
  };

  next();
}

/**
 * Middleware for read endpoints.
 * If an Authorization header is present, validates the token and attaches user info.
 * If no Authorization header is present, passes through without error.
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    next();
    return;
  }

  let secret: string;
  try {
    secret = getJwtSecret();
  } catch {
    // If JWT_SECRET is not configured, skip auth silently on read endpoints
    next();
    return;
  }

  const payload = verifyToken(token, secret);

  if (payload) {
    req.user = {
      id: payload.sub,
      role: payload.role === 'admin' ? UserRole.Admin : UserRole.User,
    };
  }

  next();
}
