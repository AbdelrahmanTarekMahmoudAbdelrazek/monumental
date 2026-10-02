import { PrismaClient } from "./generated/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function create(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // No database configured (e.g. a build step or a dev run without Postgres):
    // return a client that only fails when actually used.
    return new Proxy({} as PrismaClient, {
      get(_t, prop) {
        if (prop === "then") return undefined;
        throw new Error("DATABASE_URL is not set");
      },
    });
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter, log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? create();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export { PrismaClient } from "./generated/client";
export * from "./generated/client";
