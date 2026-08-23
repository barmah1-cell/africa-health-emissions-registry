import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Find facilities near the Gulf of Guinea that are likely in the water
  // Ghana coastline is roughly at lat 5.0, anything between lat 0-5 and lon -3 to 1 is suspicious
  const results = await prisma.$queryRaw<any[]>`
    SELECT name_text, country, 
      ST_Y(geolocation::geometry) as lat, 
      ST_X(geolocation::geometry) as lon
    FROM facility 
    WHERE deleted_at IS NULL
    AND ST_Y(geolocation::geometry) BETWEEN 0.1 AND 5.0
    AND ST_X(geolocation::geometry) BETWEEN -3.0 AND 2.0
    AND country IN ('Ghana', 'Togo', 'Benin')
    ORDER BY ST_Y(geolocation::geometry)
    LIMIT 30
  `;
  
  console.log(`Found ${results.length} facilities in the Gulf of Guinea area (lat 0-5, lon -3 to 2):`);
  results.forEach(r => {
    console.log(`  ${r.name_text} (${r.country}): lat=${Number(r.lat).toFixed(4)}, lon=${Number(r.lon).toFixed(4)}`);
  });

  // Also check for any facilities with very low latitudes globally
  const zeroish = await prisma.$queryRaw<any[]>`
    SELECT name_text, country, 
      ST_Y(geolocation::geometry) as lat, 
      ST_X(geolocation::geometry) as lon
    FROM facility 
    WHERE deleted_at IS NULL
    AND ABS(ST_Y(geolocation::geometry)) < 0.5
    AND ABS(ST_X(geolocation::geometry)) < 0.5
    LIMIT 10
  `;
  
  if (zeroish.length > 0) {
    console.log(`\nFound ${zeroish.length} facilities near (0,0):`);
    zeroish.forEach(r => {
      console.log(`  ${r.name_text} (${r.country}): lat=${Number(r.lat).toFixed(4)}, lon=${Number(r.lon).toFixed(4)}`);
    });
  }

  await prisma.$disconnect();
}

main().catch(console.error);
