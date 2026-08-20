/**
 * Express Application Setup
 *
 * Configures the Express app with the full middleware stack:
 * - JSON body parser (10mb limit for import support)
 * - CORS headers
 * - Rate limiter
 * - Health endpoint
 * - Error handling middleware
 *
 * Separated from server start (index.ts) for testability.
 *
 * Validates: Requirements 16.1-16.6
 */

import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { rateLimitMiddleware } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';
import { registerRoutes } from './routes';

const app = express();
const prisma = new PrismaClient();

// --- JSON Body Parser ---
// 10mb limit to support bulk CSV import payloads
app.use(express.json({ limit: '10mb' }));

// --- CORS Headers ---
// Simple setup allowing all origins for now
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Handle preflight requests
  if (_req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
});

// --- Rate Limiter ---
// Applied globally - checks if source IP is blocked due to excessive auth failures
app.use(rateLimitMiddleware);

// --- Health Endpoint ---
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'africa-health-facilities-registry' });
});

// --- Routes ---
registerRoutes(app, prisma);

// --- Static Frontend ---
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- Centralized Error Handler ---
// Must be the last middleware - catches unhandled errors from all routes
// Maps known error types (Zod, Prisma, SyntaxError) to consistent API error responses
// Ensures no internal details (stack traces, query content) leak to clients
app.use(errorHandler);

export default app;
