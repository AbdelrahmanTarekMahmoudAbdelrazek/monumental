import "server-only";
import { prisma } from "@monumental/db";

export const dbEnabled = !!process.env.DATABASE_URL;
export { prisma };

/** Wraps a DB call; returns `fallback` when no database is configured (dev without Postgres). */
export async function withDb<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  if (!dbEnabled) return fallback;
  try { return await fn(); } catch (e) { console.error("[db]", (e as Error).message); return fallback; }
}
