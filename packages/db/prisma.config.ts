import "dotenv/config";
import { defineConfig } from "prisma/config";

// `prisma generate` must work without a database (CI / Docker / Vercel build),
// so the URL is read leniently; migrate/db push still require DATABASE_URL.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: { url: process.env.DATABASE_URL ?? "postgresql://unset:unset@localhost:5432/unset" },
});
