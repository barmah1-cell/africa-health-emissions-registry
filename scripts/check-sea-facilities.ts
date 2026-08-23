import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Find Ghana facilities south of the coastline (lat < 4.7)
  const results = await prisma.$queryRaw<any[]>`
    SELECT name_text, country, 
      ST_Y(geolocation::geometry) as lat, 
      ST_X(geolocation::geometry) as lon
    FROM facility 
    WHERE country = 'Ghana' AND deleted_at IS NULL
    AND ST_Y(geolocation::geometry) < 4.7
    ORDER BY ST_Y(geolocation::geometry)
    LIMIT 30
  `;
  
  console.log(`Found ${results.length} Ghana facilities below latitude 4.7 (in the sea):`);
  results.forEach(r => {
    console.log(`  ${r.name_text}: lat=${r.lat}, lon=${r.lon}`);
  });

  // Soft-delete these — they have bad coordinates
  if (results.length > 0) {
    const count = await prisma.$executeRaw`
      UPDATE facility SET deleted_at = NOW()
      WHERE country = 'Ghana' AND deleted_at IS NULL
      AND ST_Y(geolocation::geometry) < 4.7
    `;
    console.log(`\nSoft-deleted ${count} facilities with coordinates in the sea.`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
