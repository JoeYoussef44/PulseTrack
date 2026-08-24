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

  // Pool settings, not defaults, for two reasons that both bite in practice.
  //
  // connectionTimeoutMillis: Neon's free tier scales compute to zero after a
  // few minutes idle. The next connection has to cold-start it, which measured
  // ~3s here and can be slower. With a short timeout that first request fails
  // with P1001 "Can't reach database server" while the database is in fact
  // perfectly healthy — the second request then succeeds, which makes it look
  // random. An evaluator opening a link we sent days earlier hits exactly this,
  // so the wait is generous.
  //
  // max: a serverless function gets its own pool, so a small per-instance cap
  // is what stops concurrent invocations exhausting Postgres connection slots.
  const adapter = new PrismaPg({
    connectionString,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 10_000,
    max: 5,
  });

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
