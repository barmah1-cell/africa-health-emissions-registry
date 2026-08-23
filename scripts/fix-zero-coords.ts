import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const count = await prisma.$executeRaw`
    UPDATE facility SET deleted_at = NOW()
    WHERE deleted_at IS NULL
    AND ST_Y(geolocation::geometry) = 0
    AND ST_X(geolocation::geometry) = 0
  `;
  console.log(`Removed ${count} facilities with (0,0) coordinates.`);
  await prisma.$disconnect();
}

main().catch(console.error);
