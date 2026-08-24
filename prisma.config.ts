import "dotenv/config";
import { defineConfig } from "prisma/config";

// The CLI (migrate/introspect) uses the DIRECT connection. Runtime uses the
// POOLED one — see lib/db.ts. Pointing migrations at a pgBouncer-style pooler
// breaks them, and pointing serverless runtime at a direct connection
// exhausts Postgres connection slots.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});
