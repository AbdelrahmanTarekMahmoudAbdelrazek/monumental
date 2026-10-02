import { NextResponse } from "next/server";
import { prisma, withDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/leaderboard?period=daily|weekly|alltime&limit=50 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const period = url.searchParams.get("period") ?? "daily";
  const limit = Math.min(100, Number(url.searchParams.get("limit") ?? 50));
  const since = period === "daily" ? new Date(Date.now() - 86400e3) : period === "weekly" ? new Date(Date.now() - 7 * 86400e3) : undefined;

  const rows = await withDb(
    () =>
      prisma.leaderboardEntry.groupBy({
        by: ["playerKey"],
        where: since ? { createdAt: { gte: since } } : undefined,
        _sum: { points: true },
        _count: { _all: true },
        orderBy: { _sum: { points: "desc" } },
        take: limit,
      }),
    [],
  );
  const keys = rows.map((r) => r.playerKey);
  const names = await withDb(() => prisma.playerStats.findMany({ where: { playerKey: { in: keys } }, select: { playerKey: true, nickname: true, wins: true, gamesPlayed: true } }), []);
  const byKey = Object.fromEntries(names.map((n) => [n.playerKey, n]));
  return NextResponse.json({
    period,
    entries: rows.map((r, i) => ({
      rank: i + 1,
      playerKey: r.playerKey,
      nickname: byKey[r.playerKey]?.nickname ?? "Player",
      points: r._sum.points ?? 0,
      sessions: r._count._all,
      wins: byKey[r.playerKey]?.wins ?? 0,
      isGuest: r.playerKey.startsWith("guest:"),
    })),
  });
}
