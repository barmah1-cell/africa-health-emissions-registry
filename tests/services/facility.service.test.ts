/**
 * Unit tests for FacilityService.create()
 *
 * Uses mocked Prisma client to verify:
 * - Valid input creates a facility and returns it
 * - Missing required fields returns validation errors
 * - Duplicate detection returns DUPLICATE_RECORD error
 * - Audit entry is created on successful creation
 * - Default values are set correctly
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FacilityService, computeStaleIndicator } from '../../src/services/facility.service';
import { PrismaClient, Prisma } from '@prisma/client';

// Mock PrismaClient
function createMockPrisma() {
  return {
    $queryRaw: vi.fn(),
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
    $executeRaw: ReturnType<typeof vi.fn>;
    facility: {
      findUniqueOrThrow: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
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

const VALID_INPUT = {
  names: { en: 'Kigali General Hospital' },
  addresses: { en: '123 Main Street, Kigali' },
  facilityType: 'hospital',
  country: 'Rwanda',
  adminRegion: 'Kigali Province',
  city: 'Kigali',
  geolocation: { latitude: -1.9403, longitude: 29.8739 },
  operationalStatus: 'operational',
  ownership: 'public',
  contactInfo: { phone: '+250788000000', email: 'info@kgh.rw' },
  beds: 500,
};

const FACILITY_ID = '550e8400-e29b-41d4-a716-446655440000';

const MOCK_FACILITY_DB_RECORD = {
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

describe('FacilityService', () => {
  let service: FacilityService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new FacilityService(mockPrisma as unknown as PrismaClient);
  });

  describe('create', () => {
    function setupSuccessfulCreation() {
      // Duplicate check returns no existing records
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([{ count: BigInt(0) }]) // duplicate check
        .mockResolvedValueOnce([{ id: FACILITY_ID }]) // insert returning id
        .mockResolvedValueOnce([{ lat: -1.9403, lon: 29.8739 }]); // geo fetch

      // findUniqueOrThrow for retrieval
      mockPrisma.facility.findUniqueOrThrow.mockResolvedValue(MOCK_FACILITY_DB_RECORD);

      // Audit entry creation
      mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-1' });
    }

    it('should create a facility with valid input and return the created record', async () => {
      setupSuccessfulCreation();

      const result = await service.create(VALID_INPUT, 'user-123');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(FACILITY_ID);
        expect(result.data.names).toEqual({ en: 'Kigali General Hospital' });
        expect(result.data.country).toBe('Rwanda');
        expect(result.data.facilityType).toBe('hospital');
        expect(result.data.geolocation).toEqual({ latitude: -1.9403, longitude: 29.8739 });
      }
    });

    it('should return validation errors for missing required fields', async () => {
      const invalidInput = {
        names: { en: 'Test' },
        // missing facilityType, country, adminRegion, geolocation, operationalStatus, ownership
      };

      const result = await service.create(invalidInput, 'user-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details).toBeDefined();
        expect(result.error.details!.length).toBeGreaterThan(0);

        const fieldNames = result.error.details!.map((d) => d.field);
        expect(fieldNames).toContain('facilityType');
        expect(fieldNames).toContain('country');
        expect(fieldNames).toContain('adminRegion');
        expect(fieldNames).toContain('geolocation');
        expect(fieldNames).toContain('operationalStatus');
        expect(fieldNames).toContain('ownership');
      }
    });

    it('should return all validation errors at once (not fail-fast)', async () => {
      const invalidInput = {
        // completely empty - multiple fields missing
      };

      const result = await service.create(invalidInput, 'user-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        // Should have errors for multiple fields
        expect(result.error.details!.length).toBeGreaterThan(1);
      }
    });

    it('should return DUPLICATE_RECORD error when facility already exists', async () => {
      // Duplicate check returns existing record
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { count: BigInt(1) },
      ]);

      const result = await service.create(VALID_INPUT, 'user-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('DUPLICATE_RECORD');
        expect(result.error.message).toContain('already exists');
      }
    });

    it('should handle Prisma P2002 unique constraint error as DUPLICATE_RECORD', async () => {
      // Duplicate check passes but DB throws unique constraint error
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([{ count: BigInt(0) }]) // duplicate check passes
        .mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: '5.0.0',
          }),
        );

      const result = await service.create(VALID_INPUT, 'user-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('DUPLICATE_RECORD');
      }
    });

    it('should create an audit entry on successful creation', async () => {
      setupSuccessfulCreation();

      await service.create(VALID_INPUT, 'user-123');

      expect(mockPrisma.auditEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          facilityId: FACILITY_ID,
          userId: 'user-123',
          operationType: 'create',
          changes: expect.any(Object),
        }),
      });

      // Verify the changes structure - old values should all be null
      const auditCall = mockPrisma.auditEntry.create.mock.calls[0][0];
      const changes = auditCall.data.changes as Record<
        string,
        { oldValue: unknown; newValue: unknown }
      >;
      expect(changes.names.oldValue).toBeNull();
      expect(changes.names.newValue).toEqual({ en: 'Kigali General Hospital' });
      expect(changes.country.oldValue).toBeNull();
      expect(changes.country.newValue).toBe('Rwanda');
    });

    it('should set default verification_status to "unverified" when not provided', async () => {
      setupSuccessfulCreation();

      const inputWithoutVerification = { ...VALID_INPUT };
      // verificationStatus not provided

      const result = await service.create(inputWithoutVerification, 'user-123');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.verificationStatus).toBe('unverified');
      }

      // Verify audit entry records 'unverified' as the new value
      const auditCall = mockPrisma.auditEntry.create.mock.calls[0][0];
      const changes = auditCall.data.changes as Record<
        string,
        { oldValue: unknown; newValue: unknown }
      >;
      expect(changes.verificationStatus.newValue).toBe('unverified');
    });

    it('should use provided verification_status when specified', async () => {
      // Duplicate check returns no existing records
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([{ count: BigInt(0) }]) // duplicate check
        .mockResolvedValueOnce([{ id: FACILITY_ID }]) // insert returning id
        .mockResolvedValueOnce([{ lat: -1.9403, lon: 29.8739 }]); // geo fetch

      mockPrisma.facility.findUniqueOrThrow.mockResolvedValue({
        ...MOCK_FACILITY_DB_RECORD,
        verificationStatus: 'self_reported',
      });
      mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-1' });

      const inputWithVerification = {
        ...VALID_INPUT,
        verificationStatus: 'self_reported' as const,
      };

      const result = await service.create(inputWithVerification, 'user-123');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.verificationStatus).toBe('self_reported');
      }
    });

    it('should mark energyProfile as "unknown" when not provided', async () => {
      setupSuccessfulCreation();

      const inputWithoutEnergy = { ...VALID_INPUT };
      // energyProfile not provided

      const result = await service.create(inputWithoutEnergy, 'user-123');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.energyProfile).toBe('unknown');
      }
    });

    it('should store energy sources when energyProfile is provided', async () => {
      const inputWithEnergy = {
        ...VALID_INPUT,
        energyProfile: [
          { energyType: 'solar' as const, consumptionKwhYear: 5000 },
          { energyType: 'grid_electricity' as const },
        ],
      };

      // Duplicate check returns no existing records
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([{ count: BigInt(0) }]) // duplicate check
        .mockResolvedValueOnce([{ id: FACILITY_ID }]) // insert returning id
        .mockResolvedValueOnce([{ lat: -1.9403, lon: 29.8739 }]); // geo fetch

      mockPrisma.facility.findUniqueOrThrow.mockResolvedValue({
        ...MOCK_FACILITY_DB_RECORD,
        energySources: [
          { id: 'es-1', energyType: 'solar', consumptionKwhYear: 5000, facilityId: FACILITY_ID, updatedAt: new Date() },
          { id: 'es-2', energyType: 'grid_electricity', consumptionKwhYear: null, facilityId: FACILITY_ID, updatedAt: new Date() },
        ],
      });
      mockPrisma.energySource.create.mockResolvedValue({ id: 'es-1' });
      mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-1' });

      const result = await service.create(inputWithEnergy, 'user-123');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.energyProfile).not.toBe('unknown');
        expect(Array.isArray(result.data.energyProfile)).toBe(true);
        if (Array.isArray(result.data.energyProfile)) {
          expect(result.data.energyProfile).toHaveLength(2);
          expect(result.data.energyProfile[0].energyType).toBe('solar');
          expect(result.data.energyProfile[0].consumptionKwhYear).toBe(5000);
          expect(result.data.energyProfile[1].energyType).toBe('grid_electricity');
          expect(result.data.energyProfile[1].consumptionKwhYear).toBeNull();
        }
      }

      // Verify energy sources were created
      expect(mockPrisma.energySource.create).toHaveBeenCalledTimes(2);
    });

    it('should use user-specified defaultLocale when provided', async () => {
      const inputWithLocale = {
        ...VALID_INPUT,
        names: { en: 'English Name', fr: 'French Name' },
        defaultLocale: 'fr',
      };

      // Duplicate check returns no existing records
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([{ count: BigInt(0) }]) // duplicate check
        .mockResolvedValueOnce([{ id: FACILITY_ID }]) // insert returning id
        .mockResolvedValueOnce([{ lat: -1.9403, lon: 29.8739 }]); // geo fetch

      mockPrisma.facility.findUniqueOrThrow.mockResolvedValue({
        ...MOCK_FACILITY_DB_RECORD,
        names: { en: 'English Name', fr: 'French Name' },
        defaultLocale: 'fr',
        nameText: 'French Name',
      });
      mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-1' });

      const result = await service.create(inputWithLocale, 'user-123');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.defaultLocale).toBe('fr');
        expect(result.data.nameText).toBe('French Name');
      }

      // Verify the insert used the correct defaultLocale
      const insertCall = (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mock.calls[1];
      // The raw SQL template literal captures parameters - verify via audit
      const auditCall = mockPrisma.auditEntry.create.mock.calls[0][0];
      const changes = auditCall.data.changes as Record<
        string,
        { oldValue: unknown; newValue: unknown }
      >;
      expect(changes.defaultLocale.newValue).toBe('fr');
    });

    it('should use first provided locale as defaultLocale when not specified', async () => {
      const inputWithoutDefaultLocale = {
        ...VALID_INPUT,
        names: { fr: 'Hôpital de Kigali', en: 'Kigali Hospital' },
        // defaultLocale not provided
      };

      // Duplicate check returns no existing records
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([{ count: BigInt(0) }]) // duplicate check
        .mockResolvedValueOnce([{ id: FACILITY_ID }]) // insert returning id
        .mockResolvedValueOnce([{ lat: -1.9403, lon: 29.8739 }]); // geo fetch

      mockPrisma.facility.findUniqueOrThrow.mockResolvedValue({
        ...MOCK_FACILITY_DB_RECORD,
        names: { fr: 'Hôpital de Kigali', en: 'Kigali Hospital' },
        defaultLocale: 'fr',
        nameText: 'Hôpital de Kigali',
      });
      mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-1' });

      const result = await service.create(inputWithoutDefaultLocale, 'user-123');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.defaultLocale).toBe('fr');
      }
    });

    it('should store multilingual names and addresses as JSONB', async () => {
      const multilingualInput = {
        ...VALID_INPUT,
        names: {
          en: 'Kigali General Hospital',
          fr: 'Hôpital Général de Kigali',
          sw: 'Hospitali Kuu ya Kigali',
        },
        addresses: {
          en: '123 Main Street, Kigali',
          fr: '123 Rue Principale, Kigali',
        },
      };

      setupSuccessfulCreation();

      const result = await service.create(multilingualInput, 'user-123');

      expect(result.success).toBe(true);

      // Verify audit entry captures all locale variants
      const auditCall = mockPrisma.auditEntry.create.mock.calls[0][0];
      const changes = auditCall.data.changes as Record<
        string,
        { oldValue: unknown; newValue: unknown }
      >;
      expect(changes.names.newValue).toEqual({
        en: 'Kigali General Hospital',
        fr: 'Hôpital Général de Kigali',
        sw: 'Hospitali Kuu ya Kigali',
      });
      expect(changes.addresses.newValue).toEqual({
        en: '123 Main Street, Kigali',
        fr: '123 Rue Principale, Kigali',
      });
    });

    it('should reject input with invalid geolocation outside Africa bounds', async () => {
      const invalidGeoInput = {
        ...VALID_INPUT,
        geolocation: { latitude: 50.0, longitude: 100.0 }, // Outside Africa
      };

      const result = await service.create(invalidGeoInput, 'user-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        const fields = result.error.details!.map((d) => d.field);
        expect(
          fields.some((f) => f.includes('geolocation') || f.includes('latitude') || f.includes('longitude')),
        ).toBe(true);
      }
    });

    it('should reject input with invalid country', async () => {
      const invalidCountryInput = {
        ...VALID_INPUT,
        country: 'Atlantis',
      };

      const result = await service.create(invalidCountryInput, 'user-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        const fields = result.error.details!.map((d) => d.field);
        expect(fields).toContain('country');
      }
    });

    it('should default addresses to empty object when not provided', async () => {
      const inputWithoutAddresses = { ...VALID_INPUT };
      delete (inputWithoutAddresses as Record<string, unknown>).addresses;

      setupSuccessfulCreation();

      const result = await service.create(inputWithoutAddresses, 'user-123');

      expect(result.success).toBe(true);

      // Verify audit entry has empty addresses
      const auditCall = mockPrisma.auditEntry.create.mock.calls[0][0];
      const changes = auditCall.data.changes as Record<
        string,
        { oldValue: unknown; newValue: unknown }
      >;
      expect(changes.addresses.newValue).toEqual({});
    });
  });

  describe('delete', () => {
    const USER_ID = 'admin-user-123';

    it('should soft-delete an existing facility and return its ID', async () => {
      mockPrisma.facility.findFirst.mockResolvedValue(MOCK_FACILITY_DB_RECORD);
      mockPrisma.facility.update.mockResolvedValue({
        ...MOCK_FACILITY_DB_RECORD,
        deletedAt: new Date(),
      });
      mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-delete-1' });

      const result = await service.delete(FACILITY_ID, USER_ID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(FACILITY_ID);
      }
    });

    it('should call facility.update with deleted_at timestamp', async () => {
      mockPrisma.facility.findFirst.mockResolvedValue(MOCK_FACILITY_DB_RECORD);
      mockPrisma.facility.update.mockResolvedValue({
        ...MOCK_FACILITY_DB_RECORD,
        deletedAt: new Date(),
      });
      mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-delete-1' });

      await service.delete(FACILITY_ID, USER_ID);

      expect(mockPrisma.facility.update).toHaveBeenCalledWith({
        where: { id: FACILITY_ID },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('should create an audit entry with operationType "delete"', async () => {
      mockPrisma.facility.findFirst.mockResolvedValue(MOCK_FACILITY_DB_RECORD);
      mockPrisma.facility.update.mockResolvedValue({
        ...MOCK_FACILITY_DB_RECORD,
        deletedAt: new Date(),
      });
      mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-delete-1' });

      await service.delete(FACILITY_ID, USER_ID);

      expect(mockPrisma.auditEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          facilityId: FACILITY_ID,
          userId: USER_ID,
          operationType: 'delete',
          changes: expect.any(Object),
        }),
      });
    });

    it('should record old values in audit entry with newValue as null for all fields', async () => {
      mockPrisma.facility.findFirst.mockResolvedValue(MOCK_FACILITY_DB_RECORD);
      mockPrisma.facility.update.mockResolvedValue({
        ...MOCK_FACILITY_DB_RECORD,
        deletedAt: new Date(),
      });
      mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-delete-1' });

      await service.delete(FACILITY_ID, USER_ID);

      const auditCall = mockPrisma.auditEntry.create.mock.calls[0][0];
      const changes = auditCall.data.changes as Record<
        string,
        { oldValue: unknown; newValue: unknown }
      >;

      // All newValue fields should be null
      for (const field of Object.keys(changes)) {
        expect(changes[field].newValue).toBeNull();
      }

      // Old values should match the facility record
      expect(changes.names.oldValue).toEqual({ en: 'Kigali General Hospital' });
      expect(changes.country.oldValue).toBe('Rwanda');
      expect(changes.facilityType.oldValue).toBe('hospital');
      expect(changes.adminRegion.oldValue).toBe('Kigali Province');
      expect(changes.city.oldValue).toBe('Kigali');
      expect(changes.ownership.oldValue).toBe('public');
      expect(changes.operationalStatus.oldValue).toBe('operational');
      expect(changes.beds.oldValue).toBe(500);
      expect(changes.verificationStatus.oldValue).toBe('unverified');
      expect(changes.defaultLocale.oldValue).toBe('en');
    });

    it('should return NOT_FOUND when facility does not exist', async () => {
      mockPrisma.facility.findFirst.mockResolvedValue(null);

      const result = await service.delete(FACILITY_ID, USER_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toBe('Facility not found');
      }
    });

    it('should return NOT_FOUND when facility is already soft-deleted', async () => {
      // findFirst with deletedAt: null will return null for already-deleted facilities
      mockPrisma.facility.findFirst.mockResolvedValue(null);

      const result = await service.delete(FACILITY_ID, USER_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should return INVALID_FORMAT for non-UUID ID', async () => {
      const result = await service.delete('not-a-valid-uuid', USER_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_FORMAT');
        expect(result.error.message).toContain('UUID');
      }

      // Should not attempt any DB operations
      expect(mockPrisma.facility.findFirst).not.toHaveBeenCalled();
    });

    it('should return INVALID_FORMAT for empty string ID', async () => {
      const result = await service.delete('', USER_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_FORMAT');
      }
    });

    it('should return INVALID_FORMAT for numeric ID', async () => {
      const result = await service.delete('12345', USER_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_FORMAT');
      }
    });

    it('should query facility with deletedAt: null to exclude already-deleted records', async () => {
      mockPrisma.facility.findFirst.mockResolvedValue(MOCK_FACILITY_DB_RECORD);
      mockPrisma.facility.update.mockResolvedValue({
        ...MOCK_FACILITY_DB_RECORD,
        deletedAt: new Date(),
      });
      mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-delete-1' });

      await service.delete(FACILITY_ID, USER_ID);

      expect(mockPrisma.facility.findFirst).toHaveBeenCalledWith({
        where: {
          id: FACILITY_ID,
          deletedAt: null,
        },
      });
    });

    it('should preserve audit entries (no cascade delete) by only soft-deleting', async () => {
      mockPrisma.facility.findFirst.mockResolvedValue(MOCK_FACILITY_DB_RECORD);
      mockPrisma.facility.update.mockResolvedValue({
        ...MOCK_FACILITY_DB_RECORD,
        deletedAt: new Date(),
      });
      mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-delete-1' });

      await service.delete(FACILITY_ID, USER_ID);

      // Verify that update (soft-delete) was used rather than physical delete
      expect(mockPrisma.facility.update).toHaveBeenCalledWith({
        where: { id: FACILITY_ID },
        data: { deletedAt: expect.any(Date) },
      });
      // No physical delete call should exist - the facility record is preserved
    });

    it('should include contactInfo and addresses in audit old values', async () => {
      const facilityWithContact = {
        ...MOCK_FACILITY_DB_RECORD,
        contactInfo: { phone: '+250788000000', email: 'info@kgh.rw' },
        addresses: { en: '123 Main Street, Kigali', fr: '123 Rue Principale' },
      };

      mockPrisma.facility.findFirst.mockResolvedValue(facilityWithContact);
      mockPrisma.facility.update.mockResolvedValue({
        ...facilityWithContact,
        deletedAt: new Date(),
      });
      mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-delete-1' });

      await service.delete(FACILITY_ID, USER_ID);

      const auditCall = mockPrisma.auditEntry.create.mock.calls[0][0];
      const changes = auditCall.data.changes as Record<
        string,
        { oldValue: unknown; newValue: unknown }
      >;

      expect(changes.contactInfo.oldValue).toEqual({ phone: '+250788000000', email: 'info@kgh.rw' });
      expect(changes.addresses.oldValue).toEqual({ en: '123 Main Street, Kigali', fr: '123 Rue Principale' });
      expect(changes.contactInfo.newValue).toBeNull();
      expect(changes.addresses.newValue).toBeNull();
    });
  });

  describe('getById', () => {
    const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

    function setupGetByIdSuccess(overrides: Record<string, unknown> = {}) {
      const facilityRecord = {
        ...MOCK_FACILITY_DB_RECORD,
        ...overrides,
      };
      mockPrisma.facility.findFirst.mockResolvedValue(facilityRecord);
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { lat: -1.9403, lon: 29.8739 },
      ]);
      return facilityRecord;
    }

    it('should return a complete facility record with all attributes', async () => {
      setupGetByIdSuccess();

      const result = await service.getById(VALID_UUID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(FACILITY_ID);
        expect(result.data.names).toEqual({ en: 'Kigali General Hospital' });
        expect(result.data.addresses).toEqual({ en: '123 Main Street, Kigali' });
        expect(result.data.defaultLocale).toBe('en');
        expect(result.data.facilityType).toBe('hospital');
        expect(result.data.country).toBe('Rwanda');
        expect(result.data.adminRegion).toBe('Kigali Province');
        expect(result.data.city).toBe('Kigali');
        expect(result.data.ownership).toBe('public');
        expect(result.data.operationalStatus).toBe('operational');
        expect(result.data.geolocation).toEqual({ latitude: -1.9403, longitude: 29.8739 });
        expect(result.data.contactInfo).toEqual({ phone: '+250788000000', email: 'info@kgh.rw' });
        expect(result.data.beds).toBe(500);
        expect(result.data.verificationStatus).toBe('unverified');
        expect(result.data.verificationDate).toBeNull();
        expect(result.data.energyVerificationStatus).toBe('unverified');
        expect(result.data.energyVerificationDate).toBeNull();
        expect(result.data.createdAt).toBeInstanceOf(Date);
        expect(result.data.updatedAt).toBeInstanceOf(Date);
      }
    });

    it('should return INVALID_FORMAT for non-UUID id', async () => {
      const result = await service.getById('not-a-uuid');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_FORMAT');
        expect(result.error.message).toContain('UUID');
      }
      expect(mockPrisma.facility.findFirst).not.toHaveBeenCalled();
    });

    it('should return INVALID_FORMAT for empty string id', async () => {
      const result = await service.getById('');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_FORMAT');
      }
    });

    it('should return INVALID_FORMAT for numeric id', async () => {
      const result = await service.getById('12345');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_FORMAT');
      }
    });

    it('should return INVALID_FORMAT for UUID-like but wrong length', async () => {
      const result = await service.getById('550e8400-e29b-41d4-a716-44665544000');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_FORMAT');
      }
    });

    it('should accept valid UUID with uppercase characters', async () => {
      setupGetByIdSuccess();

      const result = await service.getById('550E8400-E29B-41D4-A716-446655440000');

      expect(result.success).toBe(true);
    });

    it('should return NOT_FOUND for non-existent facility', async () => {
      mockPrisma.facility.findFirst.mockResolvedValue(null);

      const result = await service.getById(VALID_UUID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toContain(VALID_UUID);
      }
    });

    it('should exclude soft-deleted records (query with deletedAt: null)', async () => {
      mockPrisma.facility.findFirst.mockResolvedValue(null);

      await service.getById(VALID_UUID);

      expect(mockPrisma.facility.findFirst).toHaveBeenCalledWith({
        where: {
          id: VALID_UUID,
          deletedAt: null,
        },
        include: {
          energySources: true,
        },
      });
    });

    it('should compute staleIndicator as true when status is unverified with no date', async () => {
      setupGetByIdSuccess({
        verificationStatus: 'unverified',
        verificationDate: null,
      });

      const result = await service.getById(VALID_UUID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.staleIndicator).toBe(true);
      }
    });

    it('should compute staleIndicator as true when verification_date is older than 24 months', async () => {
      const oldDate = new Date();
      oldDate.setMonth(oldDate.getMonth() - 25); // 25 months ago

      setupGetByIdSuccess({
        verificationStatus: 'field_verified',
        verificationDate: oldDate,
      });

      const result = await service.getById(VALID_UUID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.staleIndicator).toBe(true);
      }
    });

    it('should compute staleIndicator as false when verification_date is recent', async () => {
      const recentDate = new Date();
      recentDate.setMonth(recentDate.getMonth() - 6); // 6 months ago

      setupGetByIdSuccess({
        verificationStatus: 'field_verified',
        verificationDate: recentDate,
      });

      const result = await service.getById(VALID_UUID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.staleIndicator).toBe(false);
      }
    });

    it('should compute energyStaleIndicator independently from staleIndicator', async () => {
      const recentDate = new Date();
      recentDate.setMonth(recentDate.getMonth() - 6);
      const oldDate = new Date();
      oldDate.setMonth(oldDate.getMonth() - 25);

      setupGetByIdSuccess({
        verificationStatus: 'field_verified',
        verificationDate: recentDate,
        energyVerificationStatus: 'self_reported',
        energyVerificationDate: oldDate,
      });

      const result = await service.getById(VALID_UUID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.staleIndicator).toBe(false);
        expect(result.data.energyStaleIndicator).toBe(true);
      }
    });

    it('should compute energyStaleIndicator as true when energy status is unverified with no date', async () => {
      const recentDate = new Date();
      recentDate.setMonth(recentDate.getMonth() - 6);

      setupGetByIdSuccess({
        verificationStatus: 'field_verified',
        verificationDate: recentDate,
        energyVerificationStatus: 'unverified',
        energyVerificationDate: null,
      });

      const result = await service.getById(VALID_UUID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.staleIndicator).toBe(false);
        expect(result.data.energyStaleIndicator).toBe(true);
      }
    });

    it('should return energy profile as array when energy sources exist', async () => {
      setupGetByIdSuccess({
        energySources: [
          { id: 'es-1', energyType: 'solar', consumptionKwhYear: 5000, facilityId: FACILITY_ID, updatedAt: new Date() },
          { id: 'es-2', energyType: 'grid_electricity', consumptionKwhYear: null, facilityId: FACILITY_ID, updatedAt: new Date() },
        ],
      });

      const result = await service.getById(VALID_UUID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(Array.isArray(result.data.energyProfile)).toBe(true);
        if (Array.isArray(result.data.energyProfile)) {
          expect(result.data.energyProfile).toHaveLength(2);
          expect(result.data.energyProfile[0].energyType).toBe('solar');
          expect(result.data.energyProfile[0].consumptionKwhYear).toBe(5000);
          expect(result.data.energyProfile[1].energyType).toBe('grid_electricity');
          expect(result.data.energyProfile[1].consumptionKwhYear).toBeNull();
        }
      }
    });

    it('should return energy profile as "unknown" when no energy sources exist', async () => {
      setupGetByIdSuccess({
        energySources: [],
      });

      const result = await service.getById(VALID_UUID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.energyProfile).toBe('unknown');
      }
    });

    it('should prefer requested locale for name and address when available', async () => {
      setupGetByIdSuccess({
        names: { en: 'English Name', fr: 'French Name' },
        addresses: { en: 'English Address', fr: 'French Address' },
        defaultLocale: 'en',
      });

      const result = await service.getById(VALID_UUID, 'fr');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('French Name');
        expect(result.data.address).toBe('French Address');
      }
    });

    it('should fallback to default locale when requested locale is not available', async () => {
      setupGetByIdSuccess({
        names: { en: 'English Name', fr: 'French Name' },
        addresses: { en: 'English Address', fr: 'French Address' },
        defaultLocale: 'en',
      });

      const result = await service.getById(VALID_UUID, 'ar'); // Arabic not available

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('English Name');
        expect(result.data.address).toBe('English Address');
      }
    });

    it('should use default locale when no locale preference is provided', async () => {
      setupGetByIdSuccess({
        names: { en: 'English Name', fr: 'French Name' },
        addresses: { en: 'English Address', fr: 'French Address' },
        defaultLocale: 'en',
      });

      const result = await service.getById(VALID_UUID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('English Name');
        expect(result.data.address).toBe('English Address');
      }
    });

    it('should return empty string for address when locale has no address entry', async () => {
      setupGetByIdSuccess({
        names: { en: 'English Name', fr: 'French Name' },
        addresses: { en: 'English Address' },
        defaultLocale: 'fr',
      });

      const result = await service.getById(VALID_UUID, 'fr');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('French Name');
        // fr address doesn't exist, fallback to default locale (fr) also doesn't exist,
        // so falls back to first available address value
        expect(result.data.address).toBe('English Address');
      }
    });

    it('should still return all names and addresses alongside the resolved name/address', async () => {
      setupGetByIdSuccess({
        names: { en: 'English Name', fr: 'French Name', sw: 'Swahili Name' },
        addresses: { en: 'English Address', fr: 'French Address' },
        defaultLocale: 'en',
      });

      const result = await service.getById(VALID_UUID, 'fr');

      expect(result.success).toBe(true);
      if (result.success) {
        // The resolved name/address use the preferred locale
        expect(result.data.name).toBe('French Name');
        expect(result.data.address).toBe('French Address');
        // All names/addresses are still available
        expect(result.data.names).toEqual({ en: 'English Name', fr: 'French Name', sw: 'Swahili Name' });
        expect(result.data.addresses).toEqual({ en: 'English Address', fr: 'French Address' });
      }
    });
  });

  describe('computeStaleIndicator', () => {
    it('should return true when status is unverified and no date', () => {
      expect(computeStaleIndicator('unverified', null)).toBe(true);
    });

    it('should return true when verification date is older than 24 months', () => {
      const oldDate = new Date();
      oldDate.setMonth(oldDate.getMonth() - 25);
      expect(computeStaleIndicator('field_verified', oldDate)).toBe(true);
    });

    it('should return false when verification date is within 24 months', () => {
      const recentDate = new Date();
      recentDate.setMonth(recentDate.getMonth() - 12);
      expect(computeStaleIndicator('field_verified', recentDate)).toBe(false);
    });

    it('should return false when status is not unverified even without a date', () => {
      expect(computeStaleIndicator('field_verified', null)).toBe(false);
    });

    it('should return false when date is exactly 24 months ago (boundary - not yet stale)', () => {
      const exactBoundary = new Date();
      exactBoundary.setMonth(exactBoundary.getMonth() - 24);
      // Exactly 24 months is the threshold - the comparison is < (strictly older)
      // so exactly at 24 months is not considered stale
      expect(computeStaleIndicator('self_reported', exactBoundary)).toBe(false);
    });
  });
});
