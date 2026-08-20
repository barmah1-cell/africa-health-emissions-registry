/**
 * Unit tests for FacilityService.update()
 *
 * Uses mocked Prisma client to verify:
 * - Partial updates only change submitted fields
 * - Validation of updated fields using Zod schema
 * - Uniqueness check when name/country/geolocation change
 * - Non-updated fields are preserved
 * - Audit entry records old and new values for changed fields
 * - Returns complete updated record
 * - Returns 404 if facility doesn't exist
 * - Returns 400 for invalid field values / invalid UUID
 * - Returns 409 DUPLICATE_RECORD if update would cause duplicate
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FacilityService } from '../../src/services/facility.service';
import { PrismaClient } from '@prisma/client';

// Mock PrismaClient
function createMockPrisma() {
  return {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    facility: {
      findUniqueOrThrow: vi.fn(),
      findUnique: vi.fn(),
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
    $executeRaw: ReturnType<typeof vi.fn>;
    facility: {
      findUniqueOrThrow: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    energySource: {
      create: ReturnType<typeof vi.fn>;
    };
    auditEntry: {
      create: ReturnType<typeof vi.fn>;
    };
  };
}

const FACILITY_ID = '550e8400-e29b-41d4-a716-446655440000';
const USER_ID = 'user-123';

const MOCK_EXISTING_FACILITY = {
  id: FACILITY_ID,
  names: { en: 'Kigali General Hospital' },
  addresses: { en: '123 Main Street, Kigali' },
  defaultLocale: 'en',
  nameText: 'Kigali General Hospital',
  facilityType: 'hospital',
  country: 'Rwanda',
  adminRegion: 'Kigali Province',
  city: 'Kigali',
  ownership: 'public',
  operationalStatus: 'operational',
  contactInfo: { phone: '+250788000000', email: 'info@kgh.rw' },
  beds: 500,
  verificationStatus: 'unverified',
  verificationDate: null,
  energyVerificationStatus: 'unverified',
  energyVerificationDate: null,
  createdAt: new Date('2024-01-15T10:00:00Z'),
  updatedAt: new Date('2024-01-15T10:00:00Z'),
  deletedAt: null,
  energySources: [],
};

describe('FacilityService.update', () => {
  let service: FacilityService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new FacilityService(mockPrisma as unknown as PrismaClient);
  });

  function setupExistingFacility(overrides: Record<string, unknown> = {}) {
    const facility = { ...MOCK_EXISTING_FACILITY, ...overrides };
    mockPrisma.facility.findUnique.mockResolvedValue(facility);
    // Geo query for existing facility
    (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { lat: -1.9403, lon: 29.8739 },
    ]);
  }

  function setupSuccessfulUpdate(updatedRecord?: Record<string, unknown>) {
    const updated = { ...MOCK_EXISTING_FACILITY, ...updatedRecord };
    mockPrisma.facility.update.mockResolvedValue(updated);
    mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-update-1' });
    // For getFacilityById after update
    mockPrisma.facility.findUniqueOrThrow.mockResolvedValue(updated);
    // Geo query for the returned record
    (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { lat: -1.9403, lon: 29.8739 },
    ]);
  }

  describe('successful updates', () => {
    it('should update a single field and return the complete updated record', async () => {
      setupExistingFacility();
      setupSuccessfulUpdate({ beds: 600 });

      const result = await service.update(FACILITY_ID, { beds: 600 }, USER_ID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(FACILITY_ID);
        expect(result.data.country).toBe('Rwanda');
      }
    });

    it('should only update submitted fields and preserve non-updated fields', async () => {
      setupExistingFacility();
      setupSuccessfulUpdate({ operationalStatus: 'temporarily_closed' });

      const result = await service.update(
        FACILITY_ID,
        { operationalStatus: 'temporarily_closed' },
        USER_ID,
      );

      expect(result.success).toBe(true);
      // The prisma update should only contain the changed field
      expect(mockPrisma.facility.update).toHaveBeenCalledWith({
        where: { id: FACILITY_ID },
        data: expect.objectContaining({
          operationalStatus: 'temporarily_closed',
        }),
      });
      // Verify that unchanged fields are NOT in the update payload
      const updateCall = mockPrisma.facility.update.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty('country');
      expect(updateCall.data).not.toHaveProperty('facilityType');
      expect(updateCall.data).not.toHaveProperty('beds');
    });

    it('should create an audit entry with old and new values for changed fields only', async () => {
      setupExistingFacility();
      setupSuccessfulUpdate({ beds: 750 });

      await service.update(FACILITY_ID, { beds: 750 }, USER_ID);

      expect(mockPrisma.auditEntry.create).toHaveBeenCalledWith({
        data: {
          facilityId: FACILITY_ID,
          userId: USER_ID,
          operationType: 'update',
          changes: {
            beds: { oldValue: 500, newValue: 750 },
          },
        },
      });
    });

    it('should update nameText when names change', async () => {
      setupExistingFacility();
      setupSuccessfulUpdate({
        names: { en: 'Kigali Central Hospital' },
        nameText: 'Kigali Central Hospital',
      });
      // Duplicate check (no duplicate found)
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { count: BigInt(0) },
      ]);

      await service.update(
        FACILITY_ID,
        { names: { en: 'Kigali Central Hospital' } },
        USER_ID,
      );

      const updateCall = mockPrisma.facility.update.mock.calls[0][0];
      expect(updateCall.data.nameText).toBe('Kigali Central Hospital');
      expect(updateCall.data.names).toEqual({ en: 'Kigali Central Hospital' });
    });

    it('should update nameText when defaultLocale changes', async () => {
      setupExistingFacility({
        names: { en: 'English Name', fr: 'French Name' },
        defaultLocale: 'en',
        nameText: 'English Name',
      });
      setupSuccessfulUpdate({
        defaultLocale: 'fr',
        nameText: 'French Name',
      });
      // Duplicate check
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { count: BigInt(0) },
      ]);

      await service.update(FACILITY_ID, { defaultLocale: 'fr' }, USER_ID);

      const updateCall = mockPrisma.facility.update.mock.calls[0][0];
      expect(updateCall.data.defaultLocale).toBe('fr');
      expect(updateCall.data.nameText).toBe('French Name');
    });

    it('should use raw SQL to update geolocation when it changes', async () => {
      setupExistingFacility();
      // Duplicate check (no duplicate found)
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { count: BigInt(0) },
      ]);
      setupSuccessfulUpdate();
      // Override the geo query for the final response
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { lat: -2.0, lon: 30.0 },
      ]);

      await service.update(
        FACILITY_ID,
        { geolocation: { latitude: -2.0, longitude: 30.0 } },
        USER_ID,
      );

      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });

    it('should return the existing record unchanged when no actual changes are detected', async () => {
      setupExistingFacility();
      // getFacilityById for returning the unchanged record
      mockPrisma.facility.findUniqueOrThrow.mockResolvedValue(MOCK_EXISTING_FACILITY);
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { lat: -1.9403, lon: 29.8739 },
      ]);

      // Submit same value as existing
      const result = await service.update(FACILITY_ID, { beds: 500 }, USER_ID);

      expect(result.success).toBe(true);
      // No update should be called
      expect(mockPrisma.facility.update).not.toHaveBeenCalled();
      // No audit entry should be created
      expect(mockPrisma.auditEntry.create).not.toHaveBeenCalled();
    });

    it('should update multiple fields at once', async () => {
      setupExistingFacility();
      setupSuccessfulUpdate({
        beds: 1000,
        ownership: 'private',
        operationalStatus: 'temporarily_closed',
      });

      await service.update(
        FACILITY_ID,
        { beds: 1000, ownership: 'private', operationalStatus: 'temporarily_closed' },
        USER_ID,
      );

      expect(mockPrisma.facility.update).toHaveBeenCalledWith({
        where: { id: FACILITY_ID },
        data: expect.objectContaining({
          beds: 1000,
          ownership: 'private',
          operationalStatus: 'temporarily_closed',
        }),
      });

      // Audit entry should record all changes
      const auditCall = mockPrisma.auditEntry.create.mock.calls[0][0];
      const auditChanges = auditCall.data.changes as Record<string, { oldValue: unknown; newValue: unknown }>;
      expect(auditChanges.beds).toEqual({ oldValue: 500, newValue: 1000 });
      expect(auditChanges.ownership).toEqual({ oldValue: 'public', newValue: 'private' });
      expect(auditChanges.operationalStatus).toEqual({ oldValue: 'operational', newValue: 'temporarily_closed' });
    });
  });

  describe('uniqueness checks', () => {
    it('should check uniqueness when country changes', async () => {
      setupExistingFacility();
      // Duplicate check returns a match
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { count: BigInt(1) },
      ]);

      const result = await service.update(FACILITY_ID, { country: 'Kenya' }, USER_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('DUPLICATE_RECORD');
        expect(result.error.message).toContain('already exists');
      }
    });

    it('should check uniqueness when names change', async () => {
      setupExistingFacility();
      // Duplicate check returns a match
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { count: BigInt(1) },
      ]);

      const result = await service.update(
        FACILITY_ID,
        { names: { en: 'Duplicate Hospital' } },
        USER_ID,
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('DUPLICATE_RECORD');
      }
    });

    it('should check uniqueness when geolocation changes', async () => {
      setupExistingFacility();
      // Duplicate check returns a match
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { count: BigInt(1) },
      ]);

      const result = await service.update(
        FACILITY_ID,
        { geolocation: { latitude: 0.0, longitude: 30.0 } },
        USER_ID,
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('DUPLICATE_RECORD');
      }
    });

    it('should allow update when uniqueness check passes', async () => {
      setupExistingFacility();
      // Duplicate check passes (no duplicate)
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { count: BigInt(0) },
      ]);
      setupSuccessfulUpdate({ country: 'Kenya' });

      const result = await service.update(FACILITY_ID, { country: 'Kenya' }, USER_ID);

      expect(result.success).toBe(true);
    });
  });

  describe('error cases', () => {
    it('should return INVALID_FORMAT for a malformed UUID', async () => {
      const result = await service.update('not-a-uuid', { beds: 100 }, USER_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_FORMAT');
        expect(result.error.message).toContain('UUID');
      }
    });

    it('should return INVALID_FORMAT for an empty string ID', async () => {
      const result = await service.update('', { beds: 100 }, USER_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_FORMAT');
      }
    });

    it('should return NOT_FOUND if the facility does not exist', async () => {
      mockPrisma.facility.findUnique.mockResolvedValue(null);
      // Geo query still needed before findUnique can return
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { lat: 0, lon: 0 },
      ]);

      const result = await service.update(FACILITY_ID, { beds: 100 }, USER_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toContain('not found');
      }
    });

    it('should return NOT_FOUND if the facility is soft-deleted', async () => {
      mockPrisma.facility.findUnique.mockResolvedValue({
        ...MOCK_EXISTING_FACILITY,
        deletedAt: new Date('2024-06-01T00:00:00Z'),
      });
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { lat: -1.9403, lon: 29.8739 },
      ]);

      const result = await service.update(FACILITY_ID, { beds: 100 }, USER_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should return VALIDATION_ERROR for invalid field values', async () => {
      const result = await service.update(
        FACILITY_ID,
        { facilityType: 'invalid_type' },
        USER_ID,
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details).toBeDefined();
        expect(result.error.details!.length).toBeGreaterThan(0);
      }
    });

    it('should return VALIDATION_ERROR for invalid country', async () => {
      const result = await service.update(
        FACILITY_ID,
        { country: 'Atlantis' },
        USER_ID,
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        const fields = result.error.details!.map((d) => d.field);
        expect(fields).toContain('country');
      }
    });

    it('should return VALIDATION_ERROR for invalid geolocation outside Africa bounds', async () => {
      const result = await service.update(
        FACILITY_ID,
        { geolocation: { latitude: 60.0, longitude: 100.0 } },
        USER_ID,
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details!.some((d) =>
          d.field.includes('geolocation') || d.field.includes('latitude') || d.field.includes('longitude'),
        )).toBe(true);
      }
    });

    it('should return VALIDATION_ERROR for beds exceeding maximum', async () => {
      const result = await service.update(
        FACILITY_ID,
        { beds: 100000 },
        USER_ID,
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should return multiple validation errors at once', async () => {
      const result = await service.update(
        FACILITY_ID,
        {
          country: 'InvalidCountry',
          facilityType: 'invalid_type',
          beds: -10,
        },
        USER_ID,
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details!.length).toBeGreaterThan(1);
      }
    });
  });
});
