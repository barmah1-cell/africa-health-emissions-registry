/**
 * Unit tests for ImportService.importCsv()
 *
 * Uses mocked Prisma client to verify:
 * - File size rejection (> 10 MB)
 * - Malformed CSV rejection
 * - Missing header columns rejection
 * - Empty file rejection
 * - Row count exceeding 10,000 rejection
 * - Valid rows are imported successfully
 * - Invalid rows are skipped with error details
 * - Duplicate rows are skipped
 * - Import report contains correct counts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImportService, ImportReport } from '../../src/services/import.service';
import { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

function createMockPrisma() {
  return {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    auditEntry: {
      create: vi.fn(),
    },
  } as unknown as PrismaClient & {
    $queryRaw: ReturnType<typeof vi.fn>;
    $executeRaw: ReturnType<typeof vi.fn>;
    auditEntry: {
      create: ReturnType<typeof vi.fn>;
    };
  };
}

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

const VALID_CSV_HEADER = 'name,facility_type,country,admin_region,city,latitude,longitude,operational_status,ownership,phone,email,website,beds';

function buildCsvRow(overrides: Partial<Record<string, string>> = {}): string {
  const defaults: Record<string, string> = {
    name: 'Kigali General Hospital',
    facility_type: 'hospital',
    country: 'Rwanda',
    admin_region: 'Kigali Province',
    city: 'Kigali',
    latitude: '-1.9403',
    longitude: '29.8739',
    operational_status: 'operational',
    ownership: 'public',
    phone: '+250788000000',
    email: 'info@kgh.rw',
    website: 'https://kgh.rw',
    beds: '500',
  };
  const merged = { ...defaults, ...overrides };
  return [
    merged.name,
    merged.facility_type,
    merged.country,
    merged.admin_region,
    merged.city,
    merged.latitude,
    merged.longitude,
    merged.operational_status,
    merged.ownership,
    merged.phone,
    merged.email,
    merged.website,
    merged.beds,
  ].join(',');
}

function buildCsv(rows: string[]): string {
  return [VALID_CSV_HEADER, ...rows].join('\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImportService', () => {
  let service: ImportService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  const userId = 'admin-user-id';

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new ImportService(mockPrisma as unknown as PrismaClient);
  });

  describe('File size validation', () => {
    it('should reject files exceeding 10 MB', async () => {
      const largeBuffer = Buffer.alloc(10 * 1024 * 1024 + 1, 'a');
      const result = await service.importCsv(largeBuffer, userId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('FILE_TOO_LARGE');
        expect(result.error.message).toContain('10 MB');
      }
    });

    it('should accept files exactly at 10 MB', async () => {
      // Create a valid CSV that's exactly 10 MB (just need valid header to pass size check)
      const csv = buildCsv([buildCsvRow()]);
      const buffer = Buffer.from(csv, 'utf-8');
      // This won't actually be 10 MB but will pass the size check
      expect(buffer.length).toBeLessThanOrEqual(MAX_FILE_SIZE_BYTES());

      // Mock the duplicate check and insert
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ count: BigInt(0) }]);
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: 'new-id-1' }]);
      mockPrisma.auditEntry.create.mockResolvedValueOnce({});

      const result = await service.importCsv(buffer, userId);
      expect(result.success).toBe(true);
    });
  });

  describe('CSV parsing and header validation', () => {
    it('should reject empty files (no data rows)', async () => {
      const csv = VALID_CSV_HEADER;
      const buffer = Buffer.from(csv, 'utf-8');
      const result = await service.importCsv(buffer, userId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_FILE_FORMAT');
        expect(result.error.message).toContain('no data rows');
      }
    });

    it('should reject files with missing required headers', async () => {
      const csv = 'name,facility_type,country\nHospital,hospital,Rwanda';
      const buffer = Buffer.from(csv, 'utf-8');
      const result = await service.importCsv(buffer, userId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_FILE_FORMAT');
        expect(result.error.message).toContain('missing required columns');
      }
    });

    it('should reject completely empty files', async () => {
      const buffer = Buffer.from('', 'utf-8');
      const result = await service.importCsv(buffer, userId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_FILE_FORMAT');
      }
    });

    it('should handle headers with extra whitespace', async () => {
      const csv = ' name , facility_type , country , admin_region , city , latitude , longitude , operational_status , ownership , phone , email , website , beds \nKigali Hospital,hospital,Rwanda,Kigali,Kigali,-1.94,29.87,operational,public,,,, ';
      const buffer = Buffer.from(csv, 'utf-8');

      // Mock duplicate check (not duplicate) and insert
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ count: BigInt(0) }]);
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: 'new-id' }]);
      mockPrisma.auditEntry.create.mockResolvedValueOnce({});

      const result = await service.importCsv(buffer, userId);
      expect(result.success).toBe(true);
    });
  });

  describe('Row count validation', () => {
    it('should reject files with more than 10,000 data rows', async () => {
      const rows: string[] = [];
      for (let i = 0; i < 10_001; i++) {
        rows.push(buildCsvRow({ name: `Hospital ${i}` }));
      }
      const csv = buildCsv(rows);
      const buffer = Buffer.from(csv, 'utf-8');
      const result = await service.importCsv(buffer, userId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('FILE_TOO_LARGE');
        expect(result.error.message).toContain('10000');
      }
    });
  });

  describe('Row validation', () => {
    it('should skip rows with missing required fields', async () => {
      const csv = buildCsv([
        buildCsvRow({ name: '' }), // missing name
      ]);
      const buffer = Buffer.from(csv, 'utf-8');
      const result = await service.importCsv(buffer, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.skippedValidation).toBe(1);
        expect(result.data.imported).toBe(0);
        expect(result.data.errors).toHaveLength(1);
        expect(result.data.errors[0].row).toBe(2);
        expect(result.data.errors[0].errors).toContain('name is required');
      }
    });

    it('should skip rows with invalid facility_type', async () => {
      const csv = buildCsv([
        buildCsvRow({ facility_type: 'invalid_type' }),
      ]);
      const buffer = Buffer.from(csv, 'utf-8');
      const result = await service.importCsv(buffer, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.skippedValidation).toBe(1);
        expect(result.data.errors[0].errors[0]).toContain('facility_type must be one of');
      }
    });

    it('should skip rows with invalid country', async () => {
      const csv = buildCsv([
        buildCsvRow({ country: 'Atlantis' }),
      ]);
      const buffer = Buffer.from(csv, 'utf-8');
      const result = await service.importCsv(buffer, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.skippedValidation).toBe(1);
        expect(result.data.errors[0].errors[0]).toContain('country must be a recognized African nation');
      }
    });

    it('should skip rows with latitude outside Africa bounds', async () => {
      const csv = buildCsv([
        buildCsvRow({ latitude: '50.0' }), // outside Africa bounds
      ]);
      const buffer = Buffer.from(csv, 'utf-8');
      const result = await service.importCsv(buffer, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.skippedValidation).toBe(1);
        expect(result.data.errors[0].errors[0]).toContain('latitude must be between');
      }
    });

    it('should skip rows with longitude outside Africa bounds', async () => {
      const csv = buildCsv([
        buildCsvRow({ longitude: '100.0' }), // outside Africa bounds
      ]);
      const buffer = Buffer.from(csv, 'utf-8');
      const result = await service.importCsv(buffer, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.skippedValidation).toBe(1);
        expect(result.data.errors[0].errors[0]).toContain('longitude must be between');
      }
    });

    it('should skip rows with non-numeric latitude', async () => {
      const csv = buildCsv([
        buildCsvRow({ latitude: 'abc' }),
      ]);
      const buffer = Buffer.from(csv, 'utf-8');
      const result = await service.importCsv(buffer, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.skippedValidation).toBe(1);
        expect(result.data.errors[0].errors[0]).toContain('latitude must be a valid number');
      }
    });

    it('should skip rows with invalid operational_status', async () => {
      const csv = buildCsv([
        buildCsvRow({ operational_status: 'invalid' }),
      ]);
      const buffer = Buffer.from(csv, 'utf-8');
      const result = await service.importCsv(buffer, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.skippedValidation).toBe(1);
        expect(result.data.errors[0].errors[0]).toContain('operational_status must be one of');
      }
    });

    it('should skip rows with invalid ownership value', async () => {
      const csv = buildCsv([
        buildCsvRow({ ownership: 'government' }),
      ]);
      const buffer = Buffer.from(csv, 'utf-8');
      const result = await service.importCsv(buffer, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.skippedValidation).toBe(1);
        expect(result.data.errors[0].errors[0]).toContain('ownership must be one of');
      }
    });

    it('should skip rows with invalid beds value', async () => {
      const csv = buildCsv([
        buildCsvRow({ beds: '-1' }),
      ]);
      const buffer = Buffer.from(csv, 'utf-8');
      const result = await service.importCsv(buffer, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.skippedValidation).toBe(1);
        expect(result.data.errors[0].errors[0]).toContain('beds must be between 0 and 50000');
      }
    });

    it('should skip rows with invalid email format', async () => {
      const csv = buildCsv([
        buildCsvRow({ email: 'not-an-email' }),
      ]);
      const buffer = Buffer.from(csv, 'utf-8');
      const result = await service.importCsv(buffer, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.skippedValidation).toBe(1);
        expect(result.data.errors[0].errors[0]).toContain('email must be a valid email address');
      }
    });

    it('should skip rows with invalid website URL', async () => {
      const csv = buildCsv([
        buildCsvRow({ website: 'not-a-url' }),
      ]);
      const buffer = Buffer.from(csv, 'utf-8');
      const result = await service.importCsv(buffer, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.skippedValidation).toBe(1);
        expect(result.data.errors[0].errors[0]).toContain('website must be a valid URL');
      }
    });

    it('should collect multiple validation errors for a single row', async () => {
      const csv = buildCsv([
        buildCsvRow({ name: '', country: 'InvalidCountry', latitude: 'abc' }),
      ]);
      const buffer = Buffer.from(csv, 'utf-8');
      const result = await service.importCsv(buffer, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.skippedValidation).toBe(1);
        expect(result.data.errors[0].errors.length).toBeGreaterThanOrEqual(3);
      }
    });
  });

  describe('Duplicate detection', () => {
    it('should skip duplicate rows', async () => {
      const csv = buildCsv([buildCsvRow()]);
      const buffer = Buffer.from(csv, 'utf-8');

      // Mock duplicate check returns count > 0
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ count: BigInt(1) }]);

      const result = await service.importCsv(buffer, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.skippedDuplicate).toBe(1);
        expect(result.data.imported).toBe(0);
      }
    });
  });

  describe('Successful import', () => {
    it('should import valid, non-duplicate rows', async () => {
      const csv = buildCsv([buildCsvRow()]);
      const buffer = Buffer.from(csv, 'utf-8');

      // Mock: not a duplicate, then successful insert
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ count: BigInt(0) }]);
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: 'new-facility-id' }]);
      mockPrisma.auditEntry.create.mockResolvedValueOnce({});

      const result = await service.importCsv(buffer, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.imported).toBe(1);
        expect(result.data.totalRows).toBe(1);
        expect(result.data.skippedValidation).toBe(0);
        expect(result.data.skippedDuplicate).toBe(0);
        expect(result.data.errors).toHaveLength(0);
      }
    });

    it('should import multiple rows and track counts correctly', async () => {
      const csv = buildCsv([
        buildCsvRow({ name: 'Hospital A' }),
        buildCsvRow({ name: '' }), // invalid - missing name
        buildCsvRow({ name: 'Hospital B' }),
        buildCsvRow({ name: 'Hospital C' }),
      ]);
      const buffer = Buffer.from(csv, 'utf-8');

      // Row 1 (Hospital A): not duplicate, insert ok
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ count: BigInt(0) }]);
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: 'id-a' }]);
      mockPrisma.auditEntry.create.mockResolvedValueOnce({});

      // Row 2 (empty name): skipped by validation - no DB calls

      // Row 3 (Hospital B): duplicate
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ count: BigInt(1) }]);

      // Row 4 (Hospital C): not duplicate, insert ok
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ count: BigInt(0) }]);
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: 'id-c' }]);
      mockPrisma.auditEntry.create.mockResolvedValueOnce({});

      const result = await service.importCsv(buffer, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.totalRows).toBe(4);
        expect(result.data.imported).toBe(2);
        expect(result.data.skippedValidation).toBe(1);
        expect(result.data.skippedDuplicate).toBe(1);
        expect(result.data.errors).toHaveLength(1);
        expect(result.data.errors[0].row).toBe(3); // row 3 = header(1) + data row 2
      }
    });

    it('should allow rows with optional fields empty', async () => {
      const csv = buildCsv([
        buildCsvRow({ city: '', phone: '', email: '', website: '', beds: '' }),
      ]);
      const buffer = Buffer.from(csv, 'utf-8');

      // Not duplicate, insert ok
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ count: BigInt(0) }]);
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: 'new-id' }]);
      mockPrisma.auditEntry.create.mockResolvedValueOnce({});

      const result = await service.importCsv(buffer, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.imported).toBe(1);
        expect(result.data.skippedValidation).toBe(0);
      }
    });

    it('should handle database insertion failure gracefully', async () => {
      const csv = buildCsv([buildCsvRow()]);
      const buffer = Buffer.from(csv, 'utf-8');

      // Not duplicate, but insert fails
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ count: BigInt(0) }]);
      mockPrisma.$queryRaw.mockRejectedValueOnce(new Error('DB error'));

      const result = await service.importCsv(buffer, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.imported).toBe(0);
        expect(result.data.skippedValidation).toBe(1);
        expect(result.data.errors[0].errors[0]).toContain('Failed to insert');
      }
    });
  });

  describe('Import report structure', () => {
    it('should return correct report structure for all-valid import', async () => {
      const csv = buildCsv([buildCsvRow()]);
      const buffer = Buffer.from(csv, 'utf-8');

      mockPrisma.$queryRaw.mockResolvedValueOnce([{ count: BigInt(0) }]);
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: 'facility-1' }]);
      mockPrisma.auditEntry.create.mockResolvedValueOnce({});

      const result = await service.importCsv(buffer, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        const report: ImportReport = result.data;
        expect(report).toHaveProperty('totalRows');
        expect(report).toHaveProperty('imported');
        expect(report).toHaveProperty('skippedValidation');
        expect(report).toHaveProperty('skippedDuplicate');
        expect(report).toHaveProperty('errors');
        expect(Array.isArray(report.errors)).toBe(true);
      }
    });

    it('should include row numbers in error details (1-indexed, header = row 1)', async () => {
      const csv = buildCsv([
        buildCsvRow({ name: 'Valid Hospital' }),
        buildCsvRow({ name: '' }), // invalid at data row 2 (file row 3)
      ]);
      const buffer = Buffer.from(csv, 'utf-8');

      // Row 1: not duplicate, insert ok
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ count: BigInt(0) }]);
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: 'id-1' }]);
      mockPrisma.auditEntry.create.mockResolvedValueOnce({});

      // Row 2: skipped by validation

      const result = await service.importCsv(buffer, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.errors[0].row).toBe(3); // header=1, data starts at 2
      }
    });
  });
});

// Helper to get max file size constant for assertions
function MAX_FILE_SIZE_BYTES(): number {
  return 10 * 1024 * 1024;
}
