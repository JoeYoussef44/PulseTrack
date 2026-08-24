import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Prisma 7 requires a driver adapter rather than a connection URL on the
 * client. We use the provider-agnostic pg adapter pointed at the POOLED
 * connection string, so this works with Neon or Supabase alike.
 *
 * Runtime uses DATABASE_URL (pooled). Migrations use DIRECT_URL — see
 * prisma.config.ts. Pointing serverless runtime at a direct connection
 * exhausts Postgres connection slots under any real click-through.
 */
function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and fill it in.",
    );
  }

  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({
    adapter,
    // Never log query parameters: they contain patient data.
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

// Next.js dev mode hot-reloads modules, which would otherwise open a new pool
// on every save until Postgres refuses connections.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
