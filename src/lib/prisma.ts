/**
 * Prisma Client Singleton
 *
 * Ensures a single PrismaClient instance is reused across the application.
 * In development, prevents multiple instances from being created during hot-reloads.
 */

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
