/**
 * Unit tests for verification status tracking (Task 11.1)
 *
 * Validates:
 * - Default verification_status on creation is 'unverified'
 * - Updating verification_status also sets verification_date
 * - computeStaleIndicator returns true for unverified + no date
 * - computeStaleIndicator returns true for date > 24 months ago
 * - computeStaleIndicator returns false for recent verification
 * - Independent staleness for energy profile
 * - Filtering by verification_status in search works
 *
 * Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FacilityService, computeStaleIndicator } from '../../src/services/facility.service';
import { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// computeStaleIndicator pure function tests
// ---------------------------------------------------------------------------

describe('computeStaleIndicator', () => {
  it('should return true when status is "unverified" and no date exists', () => {
    expect(computeStaleIndicator('unverified', null)).toBe(true);
  });

  it('should return true when verification_date is more than 24 months ago', () => {
    const thirtySixMonthsAgo = new Date();
    thirtySixMonthsAgo.setMonth(thirtySixMonthsAgo.getMonth() - 36);
    expect(computeStaleIndicator('field_verified', thirtySixMonthsAgo)).toBe(true);
  });

  it('should return true when verification_date is exactly 25 months ago', () => {
    const twentyFiveMonthsAgo = new Date();
    twentyFiveMonthsAgo.setMonth(twentyFiveMonthsAgo.getMonth() - 25);
    expect(computeStaleIndicator('self_reported', twentyFiveMonthsAgo)).toBe(true);
  });

  it('should return false when verification_date is recent (within 24 months)', () => {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    expect(computeStaleIndicator('field_verified', oneMonthAgo)).toBe(false);
  });

  it('should return false when verification_date is exactly now', () => {
    expect(computeStaleIndicator('field_verified', new Date())).toBe(false);
  });

  it('should return false when verification_date is 23 months ago', () => {
    const twentyThreeMonthsAgo = new Date();
    twentyThreeMonthsAgo.setMonth(twentyThreeMonthsAgo.getMonth() - 23);
    expect(computeStaleIndicator('self_reported', twentyThreeMonthsAgo)).toBe(false);
  });

  it('should return false when status is "unverified" but a date exists and is recent', () => {
    // Edge case: unverified with a date — only the date staleness check applies
    const recentDate = new Date();
    recentDate.setMonth(recentDate.getMonth() - 6);
    expect(computeStaleIndicator('unverified', recentDate)).toBe(false);
  });

  it('should return true when status is "unverified" with a date older than 24 months', () => {
    const oldDate = new Date();
    oldDate.setMonth(oldDate.getMonth() - 30);
    expect(computeStaleIndicator('unverified', oldDate)).toBe(true);
  });

  it('should return false for non-unverified status with no date', () => {
    // Status is not 'unverified' and no date — no staleness condition met
    expect(computeStaleIndicator('field_verified', null)).toBe(false);
  });

  it('should return false for imported_secondary with a recent date', () => {
    const recentDate = new Date();
    recentDate.setMonth(recentDate.getMonth() - 12);
    expect(computeStaleIndicator('imported_secondary', recentDate)).toBe(false);
  });

  // Energy profile staleness uses the same function, tested with independent inputs
  describe('independent energy profile staleness', () => {
    it('should evaluate energy profile independently from facility verification', () => {
      // Facility verification is stale, energy is fresh — different results
      const staleDate = new Date();
      staleDate.setMonth(staleDate.getMonth() - 30);
      const freshDate = new Date();
      freshDate.setMonth(freshDate.getMonth() - 3);

      const facilityStale = computeStaleIndicator('field_verified', staleDate);
      const energyStale = computeStaleIndicator('self_reported', freshDate);

      expect(facilityStale).toBe(true);
      expect(energyStale).toBe(false);
    });

    it('should mark energy as stale when energy is unverified with no date', () => {
      expect(computeStaleIndicator('unverified', null)).toBe(true);
    });

    it('should mark energy as not stale when energy date is recent', () => {
      const freshDate = new Date();
      freshDate.setMonth(freshDate.getMonth() - 6);
      expect(computeStaleIndicator('field_verified', freshDate)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// FacilityService verification status update tests
// ---------------------------------------------------------------------------

function createMockPrisma() {
  return {
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    $executeRaw: vi.fn(),
    facility: {
      findUniqueOrThrow: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
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
    facility: {
      findUniqueOrThrow: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
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
  contactInfo: { phone: '+250788000000' },
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

describe('FacilityService verification status updates', () => {
  let service: FacilityService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new FacilityService(mockPrisma as unknown as PrismaClient);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
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
    mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-1' });
    // For getFacilityById after update
    mockPrisma.facility.findUniqueOrThrow.mockResolvedValue(updated);
    // Geo query for the returned record
    (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { lat: -1.9403, lon: 29.8739 },
    ]);
  }

  describe('updating verification_status sets verification_date', () => {
    it('should set verification_date to current timestamp when verification_status changes', async () => {
      const now = new Date('2024-06-15T12:00:00Z');
      vi.setSystemTime(now);

      setupExistingFacility({ verificationStatus: 'unverified', verificationDate: null });
      setupSuccessfulUpdate({
        verificationStatus: 'field_verified',
        verificationDate: now,
      });

      const result = await service.update(
        FACILITY_ID,
        { verificationStatus: 'field_verified' },
        USER_ID,
      );

      expect(result.success).toBe(true);

      // Verify that the prisma update was called with both verificationStatus and verificationDate
      expect(mockPrisma.facility.update).toHaveBeenCalledWith({
        where: { id: FACILITY_ID },
        data: expect.objectContaining({
          verificationStatus: 'field_verified',
          verificationDate: now,
        }),
      });
    });

    it('should include verificationDate in audit changes when status changes', async () => {
      const now = new Date('2024-06-15T12:00:00Z');
      vi.setSystemTime(now);

      setupExistingFacility({ verificationStatus: 'unverified', verificationDate: null });
      setupSuccessfulUpdate({
        verificationStatus: 'self_reported',
        verificationDate: now,
      });

      await service.update(
        FACILITY_ID,
        { verificationStatus: 'self_reported' },
        USER_ID,
      );

      // Check the audit entry includes both status and date change
      const auditCall = mockPrisma.auditEntry.create.mock.calls[0][0];
      const auditChanges = auditCall.data.changes as Record<string, { oldValue: unknown; newValue: unknown }>;
      expect(auditChanges.verificationStatus).toEqual({
        oldValue: 'unverified',
        newValue: 'self_reported',
      });
      expect(auditChanges.verificationDate).toEqual({
        oldValue: null,
        newValue: now,
      });
    });

    it('should update verification_date even when previous date existed', async () => {
      const now = new Date('2024-08-01T10:00:00Z');
      vi.setSystemTime(now);

      const previousDate = new Date('2023-01-01T00:00:00Z');
      setupExistingFacility({
        verificationStatus: 'self_reported',
        verificationDate: previousDate,
      });
      setupSuccessfulUpdate({
        verificationStatus: 'field_verified',
        verificationDate: now,
      });

      await service.update(
        FACILITY_ID,
        { verificationStatus: 'field_verified' },
        USER_ID,
      );

      expect(mockPrisma.facility.update).toHaveBeenCalledWith({
        where: { id: FACILITY_ID },
        data: expect.objectContaining({
          verificationStatus: 'field_verified',
          verificationDate: now,
        }),
      });

      // Audit should show the old date
      const auditCall = mockPrisma.auditEntry.create.mock.calls[0][0];
      const auditChanges = auditCall.data.changes as Record<string, { oldValue: unknown; newValue: unknown }>;
      expect(auditChanges.verificationDate?.oldValue).toEqual(previousDate);
    });

    it('should NOT set verification_date when verification_status is not changing', async () => {
      setupExistingFacility({ verificationStatus: 'unverified', verificationDate: null });
      setupSuccessfulUpdate({ beds: 600 });

      await service.update(FACILITY_ID, { beds: 600 }, USER_ID);

      // Should not include verificationDate in the update
      const updateCall = mockPrisma.facility.update.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty('verificationDate');
    });
  });

  describe('stale indicator in responses', () => {
    it('should include staleIndicator=true for unverified facility with no date in response', async () => {
      setupExistingFacility({
        verificationStatus: 'unverified',
        verificationDate: null,
        energyVerificationStatus: 'unverified',
        energyVerificationDate: null,
      });
      setupSuccessfulUpdate({ beds: 600 });

      const result = await service.update(FACILITY_ID, { beds: 600 }, USER_ID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.staleIndicator).toBe(true);
        expect(result.data.energyStaleIndicator).toBe(true);
      }
    });

    it('should include staleIndicator=false for recently verified facility in response', async () => {
      const recentDate = new Date();
      recentDate.setMonth(recentDate.getMonth() - 6);

      setupExistingFacility({
        verificationStatus: 'field_verified',
        verificationDate: recentDate,
        energyVerificationStatus: 'self_reported',
        energyVerificationDate: recentDate,
      });

      const updatedFacility = {
        ...MOCK_EXISTING_FACILITY,
        verificationStatus: 'field_verified',
        verificationDate: recentDate,
        energyVerificationStatus: 'self_reported',
        energyVerificationDate: recentDate,
        beds: 600,
      };
      mockPrisma.facility.update.mockResolvedValue(updatedFacility);
      mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-1' });
      mockPrisma.facility.findUniqueOrThrow.mockResolvedValue(updatedFacility);
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { lat: -1.9403, lon: 29.8739 },
      ]);

      const result = await service.update(FACILITY_ID, { beds: 600 }, USER_ID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.staleIndicator).toBe(false);
        expect(result.data.energyStaleIndicator).toBe(false);
      }
    });

    it('should compute energy stale indicator independently from facility verification', async () => {
      const freshDate = new Date();
      freshDate.setMonth(freshDate.getMonth() - 3);
      const staleDate = new Date();
      staleDate.setMonth(staleDate.getMonth() - 30);

      setupExistingFacility({
        verificationStatus: 'field_verified',
        verificationDate: freshDate,
        energyVerificationStatus: 'imported_secondary',
        energyVerificationDate: staleDate,
      });

      const updatedFacility = {
        ...MOCK_EXISTING_FACILITY,
        verificationStatus: 'field_verified',
        verificationDate: freshDate,
        energyVerificationStatus: 'imported_secondary',
        energyVerificationDate: staleDate,
        beds: 600,
      };
      mockPrisma.facility.update.mockResolvedValue(updatedFacility);
      mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-1' });
      mockPrisma.facility.findUniqueOrThrow.mockResolvedValue(updatedFacility);
      (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { lat: -1.9403, lon: 29.8739 },
      ]);

      const result = await service.update(FACILITY_ID, { beds: 600 }, USER_ID);

      expect(result.success).toBe(true);
      if (result.success) {
        // Facility recently verified — not stale
        expect(result.data.staleIndicator).toBe(false);
        // Energy verified 30 months ago — stale
        expect(result.data.energyStaleIndicator).toBe(true);
      }
    });
  });

  describe('search filters by verification_status', () => {
    it('should include verification_status filter condition in search query', async () => {
      // Setup count query result
      (mockPrisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { count: BigInt(0) },
      ]);

      const result = await service.search(
        { verificationStatus: 'field_verified' },
        { page: 1, pageSize: 100 },
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pagination.totalCount).toBe(0);
      }

      // Verify the raw query included the verification_status filter
      const countQueryCall = (mockPrisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0];
      const query = countQueryCall[0] as string;
      expect(query).toContain('f.verification_status');
      expect(countQueryCall[1]).toBe('field_verified');
    });

    it('should support all valid verification_status values in search filter', async () => {
      const statuses = ['field_verified', 'self_reported', 'imported_secondary', 'unverified'];

      for (const status of statuses) {
        (mockPrisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
          { count: BigInt(0) },
        ]);

        const result = await service.search(
          { verificationStatus: status },
          { page: 1, pageSize: 100 },
        );

        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid verification_status in search filter', async () => {
      const result = await service.search(
        { verificationStatus: 'invalid_status' },
        { page: 1, pageSize: 100 },
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Default verification_status on create (integration with create method)
// ---------------------------------------------------------------------------

describe('FacilityService.create verification defaults', () => {
  let service: FacilityService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new FacilityService(mockPrisma as unknown as PrismaClient);
  });

  it('should default verification_status to "unverified" when not provided', async () => {
    const facilityId = '660e8400-e29b-41d4-a716-446655440001';

    // Mock: no duplicate found
    (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { count: BigInt(0) },
    ]);
    // Mock: insert returns the new ID
    (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: facilityId },
    ]);
    // Mock: audit entry
    mockPrisma.auditEntry.create.mockResolvedValue({ id: 'audit-1' });
    // Mock: getFacilityById
    mockPrisma.facility.findUniqueOrThrow.mockResolvedValue({
      id: facilityId,
      names: { en: 'Test Hospital' },
      addresses: {},
      defaultLocale: 'en',
      nameText: 'Test Hospital',
      facilityType: 'hospital',
      country: 'Kenya',
      adminRegion: 'Nairobi County',
      city: 'Nairobi',
      ownership: 'public',
      operationalStatus: 'operational',
      contactInfo: null,
      beds: null,
      verificationStatus: 'unverified',
      verificationDate: null,
      energyVerificationStatus: 'unverified',
      energyVerificationDate: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      energySources: [],
    });
    // Geo for getFacilityById
    (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { lat: -1.2921, lon: 36.8219 },
    ]);

    const input = {
      names: { en: 'Test Hospital' },
      facilityType: 'hospital',
      country: 'Kenya',
      adminRegion: 'Nairobi County',
      geolocation: { latitude: -1.2921, longitude: 36.8219 },
      operationalStatus: 'operational',
      ownership: 'public',
    };

    const result = await service.create(input, USER_ID);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.verificationStatus).toBe('unverified');
      expect(result.data.verificationDate).toBeNull();
      expect(result.data.energyVerificationStatus).toBe('unverified');
      expect(result.data.energyVerificationDate).toBeNull();
      // Stale indicators should be true (unverified + no date)
      expect(result.data.staleIndicator).toBe(true);
      expect(result.data.energyStaleIndicator).toBe(true);
    }
  });
});
