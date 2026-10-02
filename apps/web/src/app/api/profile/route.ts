import { NextResponse } from "next/server";
import { prisma, withDb } from "@/lib/db";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/profile?guestId=… — stats + history for the signed-in user, or for a guest id. */
export async function GET(req: Request) {
  const user = await currentUser();
  const guestId = new URL(req.url).searchParams.get("guestId");
  const playerKey = user ? `user:${user.id}` : guestId ? `guest:${guestId}` : null;
  if (!playerKey) return NextResponse.json({ error: "no identity" }, { status: 400 });

  const stats = await withDb(() => prisma.playerStats.findUnique({ where: { playerKey } }), null);
  const history = await withDb(
    () => prisma.sessionResult.findMany({ where: { playerKey }, orderBy: { createdAt: "desc" }, take: 30, include: { tournament: { select: { name: true } } } }),
    [],
  );
  const tournaments = await withDb(
    () => prisma.tournamentEntry.findMany({ where: { playerKey }, orderBy: { registeredAt: "desc" }, take: 10, include: { tournament: { select: { id: true, name: true, status: true, startsAt: true } } } }),
    [],
  );
  return NextResponse.json({
    playerKey,
    user: user ? { id: user.id, email: user.email, name: user.name, nickname: user.nickname, role: user.role } : null,
    stats: stats
      ? { ...stats, avgError: stats.roundsPlayed ? stats.errorSum / stats.roundsPlayed : null }
      : { gamesPlayed: 0, wins: 0, totalPoints: 0, roundsPlayed: 0, avgError: null, bestError: null },
    history,
    tournaments,
  });
}

/** PATCH /api/profile { nickname } — signed-in users only. */
export async function PATCH(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { nickname?: string };
  const nickname = String(body.nickname ?? "").trim().slice(0, 20);
  if (nickname.length < 2) return NextResponse.json({ error: "nickname too short" }, { status: 400 });
  await prisma.user.update({ where: { id: user.id }, data: { nickname } });
  return NextResponse.json({ ok: true, nickname });
}
