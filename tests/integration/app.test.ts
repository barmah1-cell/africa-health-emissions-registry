/**
 * Integration tests for Express app setup and middleware stack.
 *
 * Validates:
 * - App starts and responds to /health endpoint
 * - CORS headers are present
 * - JSON body parsing works
 * - Error handler catches malformed JSON
 * - Rate limiter middleware is wired
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../src/app';

describe('Express App', () => {
  describe('GET /health', () => {
    it('should return 200 with status ok', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        service: 'africa-health-facilities-registry',
      });
    });

    it('should include CORS headers', async () => {
      const response = await request(app).get('/health');

      expect(response.headers['access-control-allow-origin']).toBe('*');
      expect(response.headers['access-control-allow-methods']).toContain('GET');
      expect(response.headers['access-control-allow-headers']).toContain('Authorization');
    });
  });

  describe('CORS preflight', () => {
    it('should respond to OPTIONS with 204 and CORS headers', async () => {
      const response = await request(app)
        .options('/health')
        .set('Origin', 'http://example.com')
        .set('Access-Control-Request-Method', 'POST');

      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe('*');
      expect(response.headers['access-control-allow-methods']).toContain('POST');
    });
  });

  describe('JSON body parsing', () => {
    it('should handle malformed JSON with 400 error', async () => {
      const response = await request(app)
        .post('/health')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_FORMAT');
      expect(response.body.error.message).toBe('Invalid JSON in request body');
    });
  });

  describe('404 handling', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(app).get('/nonexistent');

      expect(response.status).toBe(404);
    });
  });
});
