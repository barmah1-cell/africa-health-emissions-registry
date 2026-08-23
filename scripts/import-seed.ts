/**
 * Seed data import script.
 * Reads the CSV file directly and calls the ImportService.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { ImportService } from '../src/services/import.service';

async function main() {
  const prisma = new PrismaClient();

  try {
    const csvPath = resolve(__dirname, '..', 'data', 'sub-saharan_health_facilities.xlsx');
    const csvBuffer = readFileSync(csvPath);

    console.log(`Read CSV file: ${csvBuffer.length} bytes`);

    const importService = new ImportService(prisma);
    const result = await importService.importCsv(csvBuffer, 'seed-script');

    if (result.success) {
      console.log('\n=== Import Report ===');
      console.log(`Total rows:         ${result.data.totalRows}`);
      console.log(`Imported:           ${result.data.imported}`);
      console.log(`Skipped (invalid):  ${result.data.skippedValidation}`);
      console.log(`Skipped (duplicate): ${result.data.skippedDuplicate}`);

      if (result.data.errors.length > 0) {
        console.log(`\nErrors:`);
        for (const err of result.data.errors) {
          console.log(`  Row ${err.row}: ${err.errors.join('; ')}`);
        }
      }
    } else {
      console.error('Import failed:', result.error);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
