/**
 * Auto-fix obvious coordinate errors and flag remaining issues.
 * 
 * Fixes applied:
 * 1. Longitude sign flip for West African countries (Ghana, Senegal, etc.) 
 *    where positive longitude should be negative
 * 2. Lat/Lon swap detection and correction
 * 
 * Remaining issues are flagged by setting verification_status = 'unverified'
 * and adding a note in the contact_info field for visual indication.
 * 
 * Facilities with (0,0) coordinates are soft-deleted as they have no valid location.
 */

import { PrismaClient } from '@prisma/client';

const COUNTRY_BOUNDS: Record<string, { latMin: number; latMax: number; lonMin: number; lonMax: number }> = {
  'Ghana': { latMin: 4.7, latMax: 11.2, lonMin: -3.3, lonMax: 1.2 },
  'Senegal': { latMin: 12.3, latMax: 16.7, lonMin: -17.5, lonMax: -11.4 },
  'Gambia': { latMin: 13.1, latMax: 13.8, lonMin: -16.8, lonMax: -13.8 },
  'Guinea-Bissau': { latMin: 10.9, latMax: 12.7, lonMin: -16.7, lonMax: -13.6 },
  'Guinea': { latMin: 7.2, latMax: 12.7, lonMin: -15.1, lonMax: -7.6 },
  'Sierra Leone': { latMin: 6.9, latMax: 10.0, lonMin: -13.3, lonMax: -10.3 },
  'Liberia': { latMin: 4.3, latMax: 8.5, lonMin: -11.5, lonMax: -7.4 },
  'Côte d\'Ivoire': { latMin: 4.3, latMax: 10.7, lonMin: -8.6, lonMax: -2.5 },
  'Mali': { latMin: 10.2, latMax: 25.0, lonMin: -12.2, lonMax: 4.3 },
  'Burkina Faso': { latMin: 9.4, latMax: 15.1, lonMin: -5.5, lonMax: 2.4 },
  'Togo': { latMin: 6.1, latMax: 11.1, lonMin: -0.1, lonMax: 1.8 },
  'Benin': { latMin: 6.2, latMax: 12.4, lonMin: 0.8, lonMax: 3.9 },
  'Nigeria': { latMin: 4.3, latMax: 13.9, lonMin: 2.7, lonMax: 14.7 },
  'Niger': { latMin: 11.7, latMax: 23.5, lonMin: 0.2, lonMax: 16.0 },
  'Chad': { latMin: 7.4, latMax: 23.5, lonMin: 13.5, lonMax: 24.0 },
  'Cameroon': { latMin: 1.6, latMax: 13.1, lonMin: 8.5, lonMax: 16.2 },
  'Central African Republic': { latMin: 2.2, latMax: 11.0, lonMin: 14.4, lonMax: 27.5 },
  'Angola': { latMin: -18.1, latMax: -4.4, lonMin: 11.7, lonMax: 24.1 },
  'Congo': { latMin: -5.0, latMax: 3.7, lonMin: 11.2, lonMax: 18.6 },
  'Democratic Republic of the Congo': { latMin: -13.5, latMax: 5.4, lonMin: 12.2, lonMax: 31.3 },
  'Gabon': { latMin: -4.0, latMax: 2.3, lonMin: 8.7, lonMax: 14.5 },
  'Equatorial Guinea': { latMin: -1.5, latMax: 3.8, lonMin: 5.6, lonMax: 11.3 },
  'Kenya': { latMin: -4.7, latMax: 5.0, lonMin: 33.9, lonMax: 41.9 },
  'Uganda': { latMin: -1.5, latMax: 4.2, lonMin: 29.6, lonMax: 35.0 },
  'Tanzania': { latMin: -11.7, latMax: -1.0, lonMin: 29.3, lonMax: 40.4 },
  'Rwanda': { latMin: -2.8, latMax: -1.1, lonMin: 28.9, lonMax: 30.9 },
  'Burundi': { latMin: -4.5, latMax: -2.3, lonMin: 29.0, lonMax: 30.9 },
  'Ethiopia': { latMin: 3.4, latMax: 14.9, lonMin: 33.0, lonMax: 48.0 },
  'Somalia': { latMin: -1.7, latMax: 12.0, lonMin: 40.9, lonMax: 51.4 },
  'South Sudan': { latMin: 3.5, latMax: 12.2, lonMin: 24.0, lonMax: 36.0 },
  'Sudan': { latMin: 8.7, latMax: 22.2, lonMin: 21.8, lonMax: 38.6 },
  'Eritrea': { latMin: 12.4, latMax: 18.0, lonMin: 36.4, lonMax: 43.1 },
  'Djibouti': { latMin: 10.9, latMax: 12.7, lonMin: 41.8, lonMax: 43.4 },
  'Mozambique': { latMin: -26.9, latMax: -10.5, lonMin: 30.2, lonMax: 40.8 },
  'Madagascar': { latMin: -25.6, latMax: -11.9, lonMin: 43.2, lonMax: 50.5 },
  'Malawi': { latMin: -17.1, latMax: -9.4, lonMin: 32.7, lonMax: 35.9 },
  'Zambia': { latMin: -18.1, latMax: -8.2, lonMin: 22.0, lonMax: 33.7 },
  'Zimbabwe': { latMin: -22.4, latMax: -15.6, lonMin: 25.2, lonMax: 33.1 },
  'Botswana': { latMin: -26.9, latMax: -17.8, lonMin: 20.0, lonMax: 29.4 },
  'Namibia': { latMin: -29.0, latMax: -17.0, lonMin: 11.7, lonMax: 25.3 },
  'South Africa': { latMin: -35.0, latMax: -22.1, lonMin: 16.5, lonMax: 32.9 },
  'Lesotho': { latMin: -30.7, latMax: -28.6, lonMin: 27.0, lonMax: 29.5 },
  'Eswatini': { latMin: -27.3, latMax: -25.7, lonMin: 30.8, lonMax: 32.1 },
  'Mauritania': { latMin: 14.7, latMax: 27.3, lonMin: -17.1, lonMax: -4.8 },
};

// Countries where longitudes should generally be negative (west of prime meridian)
const WEST_AFRICA_COUNTRIES = [
  'Ghana', 'Senegal', 'Gambia', 'Guinea-Bissau', 'Guinea', 
  'Sierra Leone', 'Liberia', 'Côte d\'Ivoire', 'Mali', 'Mauritania',
];

function isInBounds(lat: number, lon: number, bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number }, buffer = 0.5): boolean {
  return lat >= bounds.latMin - buffer && lat <= bounds.latMax + buffer &&
         lon >= bounds.lonMin - buffer && lon <= bounds.lonMax + buffer;
}

async function main() {
  const prisma = new PrismaClient();
  
  try {
    console.log('Loading facilities with coordinates...\n');

    const facilities = await prisma.$queryRaw<Array<{
      id: string;
      name_text: string;
      country: string;
      lat: number;
      lon: number;
    }>>`
      SELECT id, name_text, country,
        ST_Y(geolocation::geometry) as lat,
        ST_X(geolocation::geometry) as lon
      FROM facility
      WHERE deleted_at IS NULL
    `;

    console.log(`Total facilities: ${facilities.length}\n`);

    let fixedLonFlip = 0;
    let fixedLatLonSwap = 0;
    let deletedZeroCoords = 0;
    let flaggedRemaining = 0;

    for (const f of facilities) {
      const bounds = COUNTRY_BOUNDS[f.country];
      if (!bounds) continue;

      // Skip if already within bounds
      if (isInBounds(f.lat, f.lon, bounds)) continue;

      // --- FIX 1: (0,0) coordinates → soft-delete ---
      if (f.lat === 0 && f.lon === 0) {
        await prisma.$executeRaw`
          UPDATE facility SET deleted_at = NOW() WHERE id = ${f.id}::uuid
        `;
        deletedZeroCoords++;
        continue;
      }

      // --- FIX 2: Longitude sign flip for West African countries ---
      // If longitude is positive but should be negative
      if (WEST_AFRICA_COUNTRIES.includes(f.country) && f.lon > 0 && isInBounds(f.lat, -f.lon, bounds)) {
        const newLon = -f.lon;
        await prisma.$executeRaw`
          UPDATE facility 
          SET geolocation = ST_SetSRID(ST_MakePoint(${newLon}, ${f.lat}), 4326)::geography
          WHERE id = ${f.id}::uuid
        `;
        fixedLonFlip++;
        continue;
      }

      // --- FIX 3: Longitude sign flip for any country where negating fixes it ---
      if (f.lon > 0 && bounds.lonMax < 0 && isInBounds(f.lat, -f.lon, bounds)) {
        const newLon = -f.lon;
        await prisma.$executeRaw`
          UPDATE facility 
          SET geolocation = ST_SetSRID(ST_MakePoint(${newLon}, ${f.lat}), 4326)::geography
          WHERE id = ${f.id}::uuid
        `;
        fixedLonFlip++;
        continue;
      }

      // --- FIX 4: Lat/Lon swap ---
      if (isInBounds(f.lon, f.lat, bounds)) {
        await prisma.$executeRaw`
          UPDATE facility 
          SET geolocation = ST_SetSRID(ST_MakePoint(${f.lat}, ${f.lon}), 4326)::geography
          WHERE id = ${f.id}::uuid
        `;
        fixedLatLonSwap++;
        continue;
      }

      // --- FLAG: remaining issues → mark verification_status ---
      await prisma.facility.update({
        where: { id: f.id },
        data: { verificationStatus: 'unverified' },
      });
      flaggedRemaining++;
    }

    console.log('=== AUTO-FIX RESULTS ===\n');
    console.log(`Fixed (longitude sign flip):  ${fixedLonFlip}`);
    console.log(`Fixed (lat/lon swap):         ${fixedLatLonSwap}`);
    console.log(`Soft-deleted (0,0 coords):    ${deletedZeroCoords}`);
    console.log(`Flagged for review:           ${flaggedRemaining}`);
    console.log(`Total corrections:            ${fixedLonFlip + fixedLatLonSwap + deletedZeroCoords + flaggedRemaining}`);

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
