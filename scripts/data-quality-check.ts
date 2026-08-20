/**
 * Data Quality Check: Facilities with mismatched coordinates
 * 
 * Identifies facilities whose GPS coordinates fall outside the
 * approximate bounding box of their stated country.
 * 
 * Outputs:
 * - Summary count by country
 * - CSV file with flagged facilities for review
 */

import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

// Approximate bounding boxes for African countries (lat_min, lat_max, lon_min, lon_max)
// These are rough national boundaries — not precise borders
const COUNTRY_BOUNDS: Record<string, { latMin: number; latMax: number; lonMin: number; lonMax: number }> = {
  'Algeria': { latMin: 19.0, latMax: 37.1, lonMin: -8.7, lonMax: 12.0 },
  'Angola': { latMin: -18.1, latMax: -4.4, lonMin: 11.7, lonMax: 24.1 },
  'Benin': { latMin: 6.2, latMax: 12.4, lonMin: 0.8, lonMax: 3.9 },
  'Botswana': { latMin: -26.9, latMax: -17.8, lonMin: 20.0, lonMax: 29.4 },
  'Burkina Faso': { latMin: 9.4, latMax: 15.1, lonMin: -5.5, lonMax: 2.4 },
  'Burundi': { latMin: -4.5, latMax: -2.3, lonMin: 29.0, lonMax: 30.9 },
  'Cabo Verde': { latMin: 14.8, latMax: 17.2, lonMin: -25.4, lonMax: -22.7 },
  'Cameroon': { latMin: 1.6, latMax: 13.1, lonMin: 8.5, lonMax: 16.2 },
  'Central African Republic': { latMin: 2.2, latMax: 11.0, lonMin: 14.4, lonMax: 27.5 },
  'Chad': { latMin: 7.4, latMax: 23.5, lonMin: 13.5, lonMax: 24.0 },
  'Comoros': { latMin: -12.5, latMax: -11.3, lonMin: 43.2, lonMax: 44.5 },
  'Congo': { latMin: -5.0, latMax: 3.7, lonMin: 11.2, lonMax: 18.6 },
  'Côte d\'Ivoire': { latMin: 4.3, latMax: 10.7, lonMin: -8.6, lonMax: -2.5 },
  'Democratic Republic of the Congo': { latMin: -13.5, latMax: 5.4, lonMin: 12.2, lonMax: 31.3 },
  'Djibouti': { latMin: 10.9, latMax: 12.7, lonMin: 41.8, lonMax: 43.4 },
  'Egypt': { latMin: 22.0, latMax: 31.7, lonMin: 24.7, lonMax: 36.9 },
  'Equatorial Guinea': { latMin: -1.5, latMax: 3.8, lonMin: 5.6, lonMax: 11.3 },
  'Eritrea': { latMin: 12.4, latMax: 18.0, lonMin: 36.4, lonMax: 43.1 },
  'Eswatini': { latMin: -27.3, latMax: -25.7, lonMin: 30.8, lonMax: 32.1 },
  'Ethiopia': { latMin: 3.4, latMax: 14.9, lonMin: 33.0, lonMax: 48.0 },
  'Gabon': { latMin: -4.0, latMax: 2.3, lonMin: 8.7, lonMax: 14.5 },
  'Gambia': { latMin: 13.1, latMax: 13.8, lonMin: -16.8, lonMax: -13.8 },
  'Ghana': { latMin: 4.7, latMax: 11.2, lonMin: -3.3, lonMax: 1.2 },
  'Guinea': { latMin: 7.2, latMax: 12.7, lonMin: -15.1, lonMax: -7.6 },
  'Guinea-Bissau': { latMin: 10.9, latMax: 12.7, lonMin: -16.7, lonMax: -13.6 },
  'Kenya': { latMin: -4.7, latMax: 5.0, lonMin: 33.9, lonMax: 41.9 },
  'Lesotho': { latMin: -30.7, latMax: -28.6, lonMin: 27.0, lonMax: 29.5 },
  'Liberia': { latMin: 4.3, latMax: 8.5, lonMin: -11.5, lonMax: -7.4 },
  'Libya': { latMin: 19.5, latMax: 33.2, lonMin: 9.3, lonMax: 25.2 },
  'Madagascar': { latMin: -25.6, latMax: -11.9, lonMin: 43.2, lonMax: 50.5 },
  'Malawi': { latMin: -17.1, latMax: -9.4, lonMin: 32.7, lonMax: 35.9 },
  'Mali': { latMin: 10.2, latMax: 25.0, lonMin: -12.2, lonMax: 4.3 },
  'Mauritania': { latMin: 14.7, latMax: 27.3, lonMin: -17.1, lonMax: -4.8 },
  'Mauritius': { latMin: -20.5, latMax: -19.9, lonMin: 57.3, lonMax: 57.8 },
  'Morocco': { latMin: 27.7, latMax: 35.9, lonMin: -13.2, lonMax: -1.0 },
  'Mozambique': { latMin: -26.9, latMax: -10.5, lonMin: 30.2, lonMax: 40.8 },
  'Namibia': { latMin: -29.0, latMax: -17.0, lonMin: 11.7, lonMax: 25.3 },
  'Niger': { latMin: 11.7, latMax: 23.5, lonMin: 0.2, lonMax: 16.0 },
  'Nigeria': { latMin: 4.3, latMax: 13.9, lonMin: 2.7, lonMax: 14.7 },
  'Rwanda': { latMin: -2.8, latMax: -1.1, lonMin: 28.9, lonMax: 30.9 },
  'São Tomé and Príncipe': { latMin: 0.0, latMax: 1.7, lonMin: 6.5, lonMax: 7.5 },
  'Senegal': { latMin: 12.3, latMax: 16.7, lonMin: -17.5, lonMax: -11.4 },
  'Seychelles': { latMin: -10.2, latMax: -3.7, lonMin: 46.2, lonMax: 56.3 },
  'Sierra Leone': { latMin: 6.9, latMax: 10.0, lonMin: -13.3, lonMax: -10.3 },
  'Somalia': { latMin: -1.7, latMax: 12.0, lonMin: 40.9, lonMax: 51.4 },
  'South Africa': { latMin: -35.0, latMax: -22.1, lonMin: 16.5, lonMax: 32.9 },
  'South Sudan': { latMin: 3.5, latMax: 12.2, lonMin: 24.0, lonMax: 36.0 },
  'Sudan': { latMin: 8.7, latMax: 22.2, lonMin: 21.8, lonMax: 38.6 },
  'Tanzania': { latMin: -11.7, latMax: -1.0, lonMin: 29.3, lonMax: 40.4 },
  'Togo': { latMin: 6.1, latMax: 11.1, lonMin: -0.1, lonMax: 1.8 },
  'Tunisia': { latMin: 30.2, latMax: 37.3, lonMin: 7.5, lonMax: 11.6 },
  'Uganda': { latMin: -1.5, latMax: 4.2, lonMin: 29.6, lonMax: 35.0 },
  'Zambia': { latMin: -18.1, latMax: -8.2, lonMin: 22.0, lonMax: 33.7 },
  'Zimbabwe': { latMin: -22.4, latMax: -15.6, lonMin: 25.2, lonMax: 33.1 },
};

interface FlaggedFacility {
  id: string;
  name: string;
  country: string;
  adminRegion: string;
  latitude: number;
  longitude: number;
  issue: string;
}

async function main() {
  const prisma = new PrismaClient();
  
  try {
    console.log('Running data quality check...\n');

    // Get all facilities with their coordinates
    const facilities = await prisma.$queryRaw<Array<{
      id: string;
      name_text: string;
      country: string;
      admin_region: string;
      lat: number;
      lon: number;
    }>>`
      SELECT 
        id, name_text, country, admin_region,
        ST_Y(geolocation::geometry) as lat,
        ST_X(geolocation::geometry) as lon
      FROM facility
      WHERE deleted_at IS NULL
    `;

    console.log(`Total facilities to check: ${facilities.length}\n`);

    const flagged: FlaggedFacility[] = [];
    const issuesByCountry: Record<string, number> = {};

    for (const f of facilities) {
      const bounds = COUNTRY_BOUNDS[f.country];
      if (!bounds) continue; // Skip countries without defined bounds

      const issues: string[] = [];

      // Check if coordinates are in the sea (common error patterns)
      if (f.lat === 0 && f.lon === 0) {
        issues.push('Coordinates are (0,0) - likely missing data');
      }

      // Check if coordinates fall outside the country's bounding box
      // Add a 0.5 degree buffer to account for border areas
      const buffer = 0.5;
      if (f.lat < bounds.latMin - buffer || f.lat > bounds.latMax + buffer ||
          f.lon < bounds.lonMin - buffer || f.lon > bounds.lonMax + buffer) {
        issues.push(`Outside ${f.country} bounds (lat: ${bounds.latMin}-${bounds.latMax}, lon: ${bounds.lonMin}-${bounds.lonMax})`);
      }

      // Check for likely lat/lon swap
      if (f.lat > 50 || f.lat < -40 || f.lon > 60 || f.lon < -30) {
        issues.push('Coordinates outside Africa entirely - possible lat/lon swap or data error');
      }

      if (issues.length > 0) {
        flagged.push({
          id: f.id,
          name: f.name_text,
          country: f.country,
          adminRegion: f.admin_region,
          latitude: f.lat,
          longitude: f.lon,
          issue: issues.join('; '),
        });
        issuesByCountry[f.country] = (issuesByCountry[f.country] || 0) + 1;
      }
    }

    // Print summary
    console.log('=== DATA QUALITY REPORT ===\n');
    console.log(`Total facilities checked: ${facilities.length}`);
    console.log(`Flagged with coordinate issues: ${flagged.length} (${(flagged.length / facilities.length * 100).toFixed(1)}%)\n`);

    if (Object.keys(issuesByCountry).length > 0) {
      console.log('Issues by country:');
      const sorted = Object.entries(issuesByCountry).sort((a, b) => b[1] - a[1]);
      sorted.forEach(([country, count]) => {
        console.log(`  ${country}: ${count} facilities with coordinate issues`);
      });
    }

    // Write flagged facilities to CSV
    if (flagged.length > 0) {
      const csvHeader = 'id,name,country,admin_region,latitude,longitude,issue';
      const csvRows = flagged.map(f => 
        `"${f.id}","${f.name.replace(/"/g, '""')}","${f.country}","${f.adminRegion.replace(/"/g, '""')}",${f.latitude},${f.longitude},"${f.issue}"`
      );
      const csv = csvHeader + '\n' + csvRows.join('\n');
      
      const outputPath = resolve(__dirname, '..', 'data', 'flagged-facilities.csv');
      writeFileSync(outputPath, csv, 'utf-8');
      console.log(`\nFlagged facilities exported to: data/flagged-facilities.csv`);
    }

    // Show sample of flagged facilities
    if (flagged.length > 0) {
      console.log('\n--- Sample of flagged facilities ---\n');
      flagged.slice(0, 10).forEach(f => {
        console.log(`  ${f.name} (${f.country})`);
        console.log(`    Coords: ${f.latitude}, ${f.longitude}`);
        console.log(`    Issue: ${f.issue}\n`);
      });
      if (flagged.length > 10) {
        console.log(`  ... and ${flagged.length - 10} more (see CSV file)`);
      }
    }

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
