/**
 * Unit tests for ExportService.exportCsv()
 *
 * Uses mocked Prisma client to verify:
 * - UTF-8 encoded, RFC 4180 compliant CSV generation
 * - Header row with correct column names
 * - Search filters applied to limit exported records
 * - Requests matching > 50,000 records rejected with EXPORT_TOO_LARGE error and total count
 * - Zero matching records returns header-only CSV
 * - Maximum 50,000 records per export
 * - Invalid filters return VALIDATION_ERROR
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExportService } from '../../src/services/export.service';
import { PrismaClient } from '@prisma/client';
import Papa from 'papaparse';

// Mock PrismaClient
function createMockPrisma() {
  return {
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    $executeRaw: vi.fn(),
    facility: {
      findUniqueOrThrow: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    energySource: {
      create: vi.fn(),
    },
    auditEntry: {
      create: vi.fn(),
    },
  } as unknown as PrismaClient & {
    $queryRaw: ReturnType<typeof vi.fn>;
    $queryRawUnsafe: ReturnType<typeof vi.fn>;
    $executeRaw: ReturnType<typeof vi.fn>;
  };
}

const EXPECTED_HEADERS = [
  'name',
  'facility_type',
  'country',
  'admin_region',
  'city',
  'latitude',
  'longitude',
  'operational_status',
  'ownership',
  'phone',
  'email',
  'website',
  'beds',
  'verification_status',
];

const MOCK_ROW_1 = {
  name_text: 'Kigali General Hospital',
  facility_type: 'hospital',
  country: 'Rwanda',
  admin_region: 'Kigali Province',
  city: 'Kigali',
  lat: -1.9403,
  lon: 29.8739,
  operational_status: 'operational',
  ownership: 'public',
  contact_info: { phone: '+250788000000', email: 'info@kgh.rw', website: 'https://kgh.rw' },
  beds: 500,
  verification_status: 'field_verified',
};

const MOCK_ROW_2 = {
  name_text: 'Nairobi Clinic',
  facility_type: 'clinic',
  country: 'Kenya',
  admin_region: 'Nairobi County',
  city: null,
  lat: -1.2864,
  lon: 36.8172,
  operational_status: 'operational',
  ownership: 'private',
  contact_info: null,
  beds: null,
  verification_status: 'unverified',
};

describe('ExportService.exportCsv', () => {
  let service: ExportService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new ExportService(mockPrisma as unknown as PrismaClient);
  });

  describe('validation', () => {
    it('should reject invalid filter values with VALIDATION_ERROR', async () => {
      const result = await service.exportCsv({ facilityType: 'spaceship' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toBe('Validation failed');
        expect(result.error.details).toBeDefined();
      }
    });

    it('should reject whitespace-only keyword', async () => {
      const result = await service.exportCsv({ keyword: '   ' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should reject invalid country filter', async () => {
      const result = await service.exportCsv({ country: 'Atlantis' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('EXPORT_TOO_LARGE', () => {
    it('should reject requests matching more than 50,000 records', async () => {
      // Count returns 60,000
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(60000) }]);

      const result = await service.exportCsv({});

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('EXPORT_TOO_LARGE');
        expect(result.error.message).toContain('60000');
        expect(result.error.message).toContain('50000');
        expect((result.error as any).totalCount).toBe(60000);
      }
    });

    it('should reject when count is exactly 50,001', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(50001) }]);

      const result = await service.exportCsv({ country: 'Kenya' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('EXPORT_TOO_LARGE');
        expect((result.error as any).totalCount).toBe(50001);
      }
    });

    it('should allow exactly 50,000 records', async () => {
      // Count returns exactly 50,000
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(50000) }]);
      // Data query returns rows
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([MOCK_ROW_1]);

      const result = await service.exportCsv({});

      expect(result.success).toBe(true);
    });
  });

  describe('zero matching records', () => {
    it('should return header-only CSV when no records match', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(0) }]);

      const result = await service.exportCsv({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.recordCount).toBe(0);
        // Parse the CSV to verify headers
        const parsed = Papa.parse(result.data.csv, { header: true, skipEmptyLines: true });
        expect(parsed.meta.fields).toEqual(EXPECTED_HEADERS);
        expect(parsed.data).toHaveLength(0);
      }
    });

    it('should return header-only CSV when filters match nothing', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(0) }]);

      const result = await service.exportCsv({ country: 'Kenya' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.recordCount).toBe(0);
        expect(result.data.csv).toContain('name');
        expect(result.data.csv).toContain('facility_type');
      }
    });
  });

  describe('CSV generation', () => {
    it('should generate RFC 4180 compliant CSV with correct headers', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(2) }]);
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([MOCK_ROW_1, MOCK_ROW_2]);

      const result = await service.exportCsv({});

      expect(result.success).toBe(true);
      if (result.success) {
        const parsed = Papa.parse(result.data.csv, { header: true });
        expect(parsed.meta.fields).toEqual(EXPECTED_HEADERS);
        expect(parsed.data).toHaveLength(2);
        expect(result.data.recordCount).toBe(2);
      }
    });

    it('should correctly map facility data to CSV columns', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(1) }]);
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([MOCK_ROW_1]);

      const result = await service.exportCsv({});

      expect(result.success).toBe(true);
      if (result.success) {
        const parsed = Papa.parse(result.data.csv, { header: true });
        const row = parsed.data[0] as Record<string, string>;

        expect(row.name).toBe('Kigali General Hospital');
        expect(row.facility_type).toBe('hospital');
        expect(row.country).toBe('Rwanda');
        expect(row.admin_region).toBe('Kigali Province');
        expect(row.city).toBe('Kigali');
        expect(row.latitude).toBe('-1.9403');
        expect(row.longitude).toBe('29.8739');
        expect(row.operational_status).toBe('operational');
        expect(row.ownership).toBe('public');
        expect(row.phone).toBe('+250788000000');
        expect(row.email).toBe('info@kgh.rw');
        expect(row.website).toBe('https://kgh.rw');
        expect(row.beds).toBe('500');
        expect(row.verification_status).toBe('field_verified');
      }
    });

    it('should handle null/missing contact info gracefully', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(1) }]);
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([MOCK_ROW_2]);

      const result = await service.exportCsv({});

      expect(result.success).toBe(true);
      if (result.success) {
        const parsed = Papa.parse(result.data.csv, { header: true });
        const row = parsed.data[0] as Record<string, string>;

        expect(row.city).toBe('');
        expect(row.phone).toBe('');
        expect(row.email).toBe('');
        expect(row.website).toBe('');
        expect(row.beds).toBe('');
      }
    });

    it('should produce valid UTF-8 string output', async () => {
      const unicodeRow = {
        ...MOCK_ROW_1,
        name_text: 'Hôpital Général de Kigali',
        admin_region: 'Province de l\'Est',
      };
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(1) }]);
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([unicodeRow]);

      const result = await service.exportCsv({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.csv).toContain('Hôpital Général de Kigali');
        expect(result.data.csv).toContain("Province de l'Est");
      }
    });

    it('should handle values containing commas (RFC 4180 quoting)', async () => {
      const rowWithComma = {
        ...MOCK_ROW_1,
        name_text: 'Hospital, General',
        admin_region: 'Region, Sub-Region',
      };
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(1) }]);
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([rowWithComma]);

      const result = await service.exportCsv({});

      expect(result.success).toBe(true);
      if (result.success) {
        // Papa Parse should handle quoting for RFC 4180 compliance
        const parsed = Papa.parse(result.data.csv, { header: true });
        const row = parsed.data[0] as Record<string, string>;
        expect(row.name).toBe('Hospital, General');
        expect(row.admin_region).toBe('Region, Sub-Region');
      }
    });

    it('should handle values containing quotes (RFC 4180 escaping)', async () => {
      const rowWithQuotes = {
        ...MOCK_ROW_1,
        name_text: 'The "General" Hospital',
      };
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(1) }]);
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([rowWithQuotes]);

      const result = await service.exportCsv({});

      expect(result.success).toBe(true);
      if (result.success) {
        const parsed = Papa.parse(result.data.csv, { header: true });
        const row = parsed.data[0] as Record<string, string>;
        expect(row.name).toBe('The "General" Hospital');
      }
    });
  });

  describe('search filters', () => {
    it('should accept empty filters (export all)', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(1) }]);
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([MOCK_ROW_1]);

      const result = await service.exportCsv({});

      expect(result.success).toBe(true);
      // Verify the WHERE clause only contains deleted_at check
      const countCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
      expect(countCall[0]).toContain('deleted_at IS NULL');
      expect(countCall.length).toBe(1); // No extra params
    });

    it('should pass country filter to query', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(1) }]);
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([MOCK_ROW_1]);

      await service.exportCsv({ country: 'Rwanda' });

      const countCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
      expect(countCall[0]).toContain('f.country = $1');
      expect(countCall[1]).toBe('Rwanda');
    });

    it('should pass multiple filters to query', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(1) }]);
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([MOCK_ROW_1]);

      await service.exportCsv({
        country: 'Rwanda',
        facilityType: 'hospital',
        operationalStatus: 'operational',
      });

      const countCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
      expect(countCall[0]).toContain('f.country = $1');
      expect(countCall[0]).toContain('f.facility_type = $2');
      expect(countCall[0]).toContain('f.operational_status = $3');
      expect(countCall[1]).toBe('Rwanda');
      expect(countCall[2]).toBe('hospital');
      expect(countCall[3]).toBe('operational');
    });

    it('should pass keyword filter to query', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(1) }]);
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([MOCK_ROW_1]);

      await service.exportCsv({ keyword: 'hospital' });

      const countCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
      expect(countCall[0]).toContain('jsonb_each_text(f.names)');
      expect(countCall[1]).toBe('%hospital%');
    });

    it('should pass energy source filter to query', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(1) }]);
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([MOCK_ROW_1]);

      await service.exportCsv({ energySource: 'solar' });

      const countCall = mockPrisma.$queryRawUnsafe.mock.calls[0];
      expect(countCall[0]).toContain('energy_source es');
      expect(countCall[0]).toContain('es.energy_type = $1');
      expect(countCall[1]).toBe('solar');
    });
  });
});
