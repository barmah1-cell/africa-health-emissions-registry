/**
 * Import WHO/KEMRI Sub-Saharan Africa Health Facilities Dataset
 * 
 * Reads the Excel file, maps columns to our import format,
 * and imports in batches of 10,000 (our import limit).
 */

import * as XLSX from 'xlsx';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { ImportService } from '../src/services/import.service';

// Map WHO dataset country names to our recognized African countries list
const COUNTRY_MAP: Record<string, string> = {
  'Angola': 'Angola',
  'Benin': 'Benin',
  'Botswana': 'Botswana',
  'Burkina Faso': 'Burkina Faso',
  'Burundi': 'Burundi',
  'Cameroon': 'Cameroon',
  'Cape Verde': 'Cabo Verde',
  'Central African Republic': 'Central African Republic',
  'Chad': 'Chad',
  'Comoros': 'Comoros',
  'Congo': 'Congo',
  'Cote d\'Ivoire': 'Côte d\'Ivoire',
  'Democratic Republic of the Congo': 'Democratic Republic of the Congo',
  'Djibouti': 'Djibouti',
  'Equatorial Guinea': 'Equatorial Guinea',
  'Eritrea': 'Eritrea',
  'Ethiopia': 'Ethiopia',
  'Gabon': 'Gabon',
  'Gambia': 'Gambia',
  'Ghana': 'Ghana',
  'Guinea': 'Guinea',
  'Guinea Bissau': 'Guinea-Bissau',
  'Kenya': 'Kenya',
  'Lesotho': 'Lesotho',
  'Liberia': 'Liberia',
  'Madagascar': 'Madagascar',
  'Malawi': 'Malawi',
  'Mali': 'Mali',
  'Mauritania': 'Mauritania',
  'Mauritius': 'Mauritius',
  'Mozambique': 'Mozambique',
  'Namibia': 'Namibia',
  'Niger': 'Niger',
  'Nigeria': 'Nigeria',
  'Rwanda': 'Rwanda',
  'Sao Tome and Principe': 'São Tomé and Príncipe',
  'Senegal': 'Senegal',
  'Seychelles': 'Seychelles',
  'Sierra Leone': 'Sierra Leone',
  'Somalia': 'Somalia',
  'South Africa': 'South Africa',
  'South Sudan': 'South Sudan',
  'Sudan': 'Sudan',
  'Tanzania': 'Tanzania',
  'Togo': 'Togo',
  'Uganda': 'Uganda',
  'Zambia': 'Zambia',
  'Zanzibar': 'Tanzania', // Zanzibar is part of Tanzania
  'Zimbabwe': 'Zimbabwe',
  'eSwatini': 'Eswatini',
};

// Map the 172 WHO facility types to our 6 types
function mapFacilityType(whoType: string): string {
  const lower = (whoType || '').toLowerCase();
  
  // Hospitals
  if (lower.includes('hospital') || lower.includes('hospitai') || lower.includes('hôpital') ||
      lower.includes('hospitalier') || lower.includes('chirurgical') || lower.includes('teaching') ||
      lower.includes('referral') || lower.includes('medi-clinic') || lower.includes('university')) {
    return 'hospital';
  }
  
  // Health posts / dispensaries / CHPS
  if (lower.includes('health post') || lower.includes('dispensary') || lower.includes('dispensaire') ||
      lower.includes('poste de') || lower.includes('posto de') || lower.includes('postos') ||
      lower.includes('health hut') || lower.includes('health station') ||
      lower.includes('community-based') || lower.includes('unites de') || lower.includes('unité') ||
      lower.includes('village') || lower.includes('satellite')) {
    return 'health_post';
  }
  
  // Clinics
  if (lower.includes('clinic') || lower.includes('clinique') || lower.includes('polyclinic') ||
      lower.includes('polyclinique') || lower.includes('filter') || lower.includes('mini clinic')) {
    return 'clinic';
  }
  
  // Health centers / community health centers
  if (lower.includes('centre') || lower.includes('center') || lower.includes('centro')) {
    return 'community_health_center';
  }
  
  // Default to clinic for anything else
  return 'clinic';
}

// Map ownership
function mapOwnership(whoOwnership: string): string {
  const lower = (whoOwnership || '').toLowerCase();
  if (lower.includes('govt') || lower.includes('gov') || lower.includes('public') ||
      lower.includes('mission') || lower.includes('ngo') || lower.includes('faith')) {
    return 'public';
  }
  return 'private';
}

async function main() {
  const prisma = new PrismaClient();

  try {
    console.log('Reading Excel file...');
    const filePath = resolve(__dirname, '..', 'data', 'sub-saharan_health_facilities.xlsx');
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json<Record<string, any>>(ws);

    console.log(`Total rows in dataset: ${data.length}`);

    // Convert to our CSV format
    const csvHeader = 'name,facility_type,country,admin_region,city,latitude,longitude,operational_status,ownership,phone,email,website,beds';
    
    // Filter out rows with invalid coordinates
    const validRows = data.filter(row => {
      const lat = Number(row.Lat);
      const lon = Number(row.Long);
      const country = COUNTRY_MAP[row.Country];
      return country && !isNaN(lat) && !isNaN(lon) && 
             lat >= -35 && lat <= 37 && lon >= -25 && lon <= 55;
    });

    console.log(`Valid rows (within Africa bounds, recognized country): ${validRows.length}`);
    console.log(`Skipped: ${data.length - validRows.length} (invalid coords or unrecognized country)`);

    // Process in batches of 9000 (under the 10,000 limit)
    const BATCH_SIZE = 9000;
    const importService = new ImportService(prisma);
    let totalImported = 0;
    let totalSkippedValidation = 0;
    let totalSkippedDuplicate = 0;
    const batches = Math.ceil(validRows.length / BATCH_SIZE);

    for (let batch = 0; batch < batches; batch++) {
      const start = batch * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, validRows.length);
      const batchRows = validRows.slice(start, end);

      console.log(`\nBatch ${batch + 1}/${batches} (rows ${start + 1}-${end})...`);

      // Convert to CSV
      const csvRows = batchRows.map(row => {
        const name = (row.Facility_n || 'Unknown Facility').replace(/,/g, ' ').replace(/"/g, '');
        const facilityType = mapFacilityType(row.Facility_t);
        const country = COUNTRY_MAP[row.Country] || row.Country;
        const adminRegion = (row.Admin1 || 'Unknown').replace(/,/g, ' ').replace(/"/g, '');
        const lat = Number(row.Lat);
        const lon = Number(row.Long);
        const ownership = mapOwnership(row.Ownership);
        
        return `"${name}",${facilityType},${country},${adminRegion},,${lat},${lon},operational,${ownership},,,,`;
      });

      const csvContent = csvHeader + '\n' + csvRows.join('\n');
      const buffer = Buffer.from(csvContent, 'utf-8');

      const result = await importService.importCsv(buffer, 'who-dataset-import');

      if (result.success) {
        totalImported += result.data.imported;
        totalSkippedValidation += result.data.skippedValidation;
        totalSkippedDuplicate += result.data.skippedDuplicate;
        console.log(`  Imported: ${result.data.imported}, Skipped (validation): ${result.data.skippedValidation}, Skipped (duplicate): ${result.data.skippedDuplicate}`);
        if (result.data.errors.length > 0 && result.data.errors.length <= 5) {
          result.data.errors.forEach(e => console.log(`    Row ${e.row}: ${e.errors[0]}`));
        } else if (result.data.errors.length > 5) {
          console.log(`    First error: Row ${result.data.errors[0].row}: ${result.data.errors[0].errors[0]}`);
          console.log(`    ... and ${result.data.errors.length - 1} more`);
        }
      } else {
        console.error(`  Batch failed:`, result.error);
      }
    }

    console.log('\n=============================');
    console.log('=== IMPORT COMPLETE ===');
    console.log('=============================');
    console.log(`Total imported:            ${totalImported}`);
    console.log(`Total skipped (validation): ${totalSkippedValidation}`);
    console.log(`Total skipped (duplicate):  ${totalSkippedDuplicate}`);
    console.log(`Total processed:           ${totalImported + totalSkippedValidation + totalSkippedDuplicate}`);

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
