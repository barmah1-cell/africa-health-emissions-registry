/**
 * JWT token generation utility.
 *
 * Used for generating tokens during user login and for testing purposes.
 */

import jwt, { SignOptions } from 'jsonwebtoken';
import { JwtPayload } from '../middleware/auth';

/** Options for generating a JWT token */
export interface GenerateTokenOptions {
  /** User ID (becomes the 'sub' claim) */
  userId: string;
  /** User role */
  role: 'user' | 'admin';
  /** Token expiration time in seconds (default: 86400 = 24 hours) */
  expiresInSeconds?: number;
}

/**
 * Generates a signed JWT token with the given payload.
 *
 * @param options - Token generation options including userId, role, and optional expiration
 * @returns Signed JWT token string
 * @throws Error if JWT_SECRET is not configured
 */
export function generateToken(options: GenerateTokenOptions): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not configured');
  }

  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub: options.userId,
    role: options.role,
  };

  const signOptions: SignOptions = {
    expiresIn: options.expiresInSeconds ?? 86400, // 24 hours default
  };

  return jwt.sign(payload, secret, signOptions);
}
