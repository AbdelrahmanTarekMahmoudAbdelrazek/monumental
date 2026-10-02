import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, withDb } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { LEVELS } from "@monumental/shared";

export const dynamic = "force-dynamic";

/** GET /api/tournaments?code=XXXX — upcoming/live public tournaments (+ a private one by invite code). */
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code")?.toUpperCase();
  const list = await withDb(
    () =>
      prisma.tournament.findMany({
        where: {
          OR: [
            { isPrivate: false, status: { in: ["SCHEDULED", "REGISTRATION", "QUALIFYING", "FINAL"] } },
            { isPrivate: false, status: "FINISHED", finishedAt: { gte: new Date(Date.now() - 6 * 3600e3) } },
            ...(code ? [{ inviteCode: code }] : []),
          ],
        },
        orderBy: { startsAt: "asc" },
        take: 30,
        include: { _count: { select: { entries: true } } },
      }),
    [],
  );
  return NextResponse.json({ tournaments: list.map((t) => ({ ...t, entries: t._count.entries, inviteCode: t.inviteCode && code === t.inviteCode ? t.inviteCode : undefined })) });
}

const createSchema = z.object({
  name: z.string().min(3).max(60),
  levelId: z.number().int().refine((n) => LEVELS.some((l) => l.id === n)),
  startsAt: z.string().datetime(),
  isPrivate: z.boolean().default(false),
  qualifyingRounds: z.number().int().min(3).max(15).default(5),
  finalRounds: z.number().int().min(3).max(20).default(10),
  advanceCount: z.number().int().min(2).max(50).default(8),
  qualifyingRoomSize: z.number().int().min(2).max(50).default(20),
});

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

/** POST /api/tournaments — create a custom (optionally private) tournament. Guests may create private ones. */
export async function POST(req: Request) {
  const user = await currentUser();
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid tournament", issues: parsed.error.issues }, { status: 400 });
  const d = parsed.data;
  const startsAt = new Date(d.startsAt);
  if (startsAt.getTime() < Date.now() + 60e3) return NextResponse.json({ error: "Start time must be at least 1 minute in the future" }, { status: 400 });
  if (!d.isPrivate && (!user || user.role !== "ADMIN")) return NextResponse.json({ error: "Only admins can schedule public tournaments — make it private" }, { status: 403 });
  const t = await withDb(
    () =>
      prisma.tournament.create({
        data: {
          name: d.name,
          levelId: d.levelId,
          startsAt,
          status: "REGISTRATION",
          isPrivate: d.isPrivate,
          inviteCode: d.isPrivate ? makeCode() : null,
          qualifyingRounds: d.qualifyingRounds,
          finalRounds: d.finalRounds,
          advanceCount: d.advanceCount,
          qualifyingRoomSize: d.qualifyingRoomSize,
          createdById: user?.id ?? null,
        },
      }),
    null,
  );
  if (!t) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  return NextResponse.json({ tournament: t });
}
