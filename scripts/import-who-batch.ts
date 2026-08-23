/**
 * Batch import WHO dataset to Neon.
 * Uses multi-row INSERT statements (500 rows at a time) for much faster imports.
 * Skips facilities that already exist (ON CONFLICT DO NOTHING).
 */

import * as XLSX from 'xlsx';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Country name mapping (WHO → our system)
const COUNTRY_MAP: Record<string, string> = {
  'Angola': 'Angola', 'Benin': 'Benin', 'Botswana': 'Botswana',
  'Burkina Faso': 'Burkina Faso', 'Burundi': 'Burundi', 'Cameroon': 'Cameroon',
  'Cape Verde': 'Cabo Verde', 'Central African Republic': 'Central African Republic',
  'Chad': 'Chad', 'Comoros': 'Comoros', 'Congo': 'Congo',
  "Cote d'Ivoire": "Côte d'Ivoire",
  'Democratic Republic of the Congo': 'Democratic Republic of the Congo',
  'Djibouti': 'Djibouti', 'Equatorial Guinea': 'Equatorial Guinea',
  'Eritrea': 'Eritrea', 'Ethiopia': 'Ethiopia', 'Gabon': 'Gabon',
  'Gambia': 'Gambia', 'Ghana': 'Ghana', 'Guinea': 'Guinea',
  'Guinea Bissau': 'Guinea-Bissau', 'Kenya': 'Kenya', 'Lesotho': 'Lesotho',
  'Liberia': 'Liberia', 'Madagascar': 'Madagascar', 'Malawi': 'Malawi',
  'Mali': 'Mali', 'Mauritania': 'Mauritania', 'Mauritius': 'Mauritius',
  'Mozambique': 'Mozambique', 'Namibia': 'Namibia', 'Niger': 'Niger',
  'Nigeria': 'Nigeria', 'Rwanda': 'Rwanda',
  'Sao Tome and Principe': 'São Tomé and Príncipe',
  'Senegal': 'Senegal', 'Seychelles': 'Seychelles', 'Sierra Leone': 'Sierra Leone',
  'Somalia': 'Somalia', 'South Africa': 'South Africa', 'South Sudan': 'South Sudan',
  'Sudan': 'Sudan', 'Tanzania': 'Tanzania', 'Togo': 'Togo',
  'Uganda': 'Uganda', 'Zambia': 'Zambia', 'Zanzibar': 'Tanzania',
  'Zimbabwe': 'Zimbabwe', 'eSwatini': 'Eswatini',
};

function mapFacilityType(whoType: string): string {
  const lower = (whoType || '').toLowerCase();
  if (lower.includes('hospital') || lower.includes('hospitai') || lower.includes('hôpital') ||
      lower.includes('hospitalier') || lower.includes('chirurgical') || lower.includes('teaching') ||
      lower.includes('referral') || lower.includes('medi-clinic') || lower.includes('university')) return 'hospital';
  if (lower.includes('health post') || lower.includes('dispensary') || lower.includes('dispensaire') ||
      lower.includes('poste de') || lower.includes('posto de') || lower.includes('postos') ||
      lower.includes('health hut') || lower.includes('health station') ||
      lower.includes('community-based') || lower.includes('unites de') || lower.includes('unité') ||
      lower.includes('village') || lower.includes('satellite')) return 'health_post';
  if (lower.includes('clinic') || lower.includes('clinique') || lower.includes('polyclinic') ||
      lower.includes('polyclinique') || lower.includes('filter') || lower.includes('mini clinic')) return 'clinic';
  if (lower.includes('centre') || lower.includes('center') || lower.includes('centro')) return 'community_health_center';
  return 'clinic';
}

function mapOwnership(whoOwnership: string): string {
  const lower = (whoOwnership || '').toLowerCase();
  if (lower.includes('govt') || lower.includes('gov') || lower.includes('public') ||
      lower.includes('mission') || lower.includes('ngo') || lower.includes('faith')) return 'public';
  return 'private';
}

function escapeSQL(str: string): string {
  return str.replace(/'/g, "''").replace(/\\/g, '\\\\');
}

async function main() {
  try {
    console.log('Reading Excel file...');
    const filePath = resolve(__dirname, '..', 'data', 'sub-saharan_health_facilities.xlsx');
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json<Record<string, any>>(ws);

    console.log(`Total rows: ${data.length}`);

    // Filter valid rows
    const validRows = data.filter(row => {
      const lat = Number(row.Lat);
      const lon = Number(row.Long);
      const country = COUNTRY_MAP[row.Country];
      return country && !isNaN(lat) && !isNaN(lon) && lat >= -35 && lat <= 37 && lon >= -25 && lon <= 55;
    });

    console.log(`Valid rows: ${validRows.length}`);

    // Process in batches of 500
    const BATCH_SIZE = 500;
    const batches = Math.ceil(validRows.length / BATCH_SIZE);
    let totalInserted = 0;

    for (let i = 0; i < batches; i++) {
      const start = i * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, validRows.length);
      const batch = validRows.slice(start, end);

      // Build multi-row INSERT with ON CONFLICT DO NOTHING
      const values = batch.map(row => {
        const name = escapeSQL((row.Facility_n || 'Unknown').replace(/,/g, ' '));
        const facilityType = mapFacilityType(row.Facility_t);
        const country = COUNTRY_MAP[row.Country]!;
        const adminRegion = escapeSQL((row.Admin1 || 'Unknown').replace(/,/g, ' '));
        const lat = Number(row.Lat);
        const lon = Number(row.Long);
        const ownership = mapOwnership(row.Ownership);
        const names = JSON.stringify({ en: name }).replace(/'/g, "''");

        return `(gen_random_uuid(), '${names}'::jsonb, '{}'::jsonb, 'en', '${escapeSQL(name)}', '${facilityType}', '${escapeSQL(country)}', '${adminRegion}', '${ownership}', 'operational', 'unverified', 'unverified', ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography, NOW(), NOW())`;
      }).join(',\n');

      const sql = `
        INSERT INTO facility (id, names, addresses, default_locale, name_text, facility_type, country, admin_region, ownership, operational_status, verification_status, energy_verification_status, geolocation, created_at, updated_at)
        VALUES ${values}
        ON CONFLICT DO NOTHING;
      `;

      try {
        const result = await prisma.$executeRawUnsafe(sql);
        totalInserted += result;
        if ((i + 1) % 10 === 0 || i === batches - 1) {
          console.log(`Batch ${i + 1}/${batches}: ${totalInserted} total inserted (${Math.round((i + 1) / batches * 100)}%)`);
        }
      } catch (err: any) {
        console.error(`Batch ${i + 1} failed:`, err.message?.substring(0, 200));
        // Continue with next batch
      }
    }

    console.log(`\n=== IMPORT COMPLETE ===`);
    console.log(`Total inserted: ${totalInserted}`);

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
