import type { PrismaClient } from "@monumental/db";
import { config } from "./config.js";

let prisma: PrismaClient | null = null;

/** Called once at boot. Returns null when no DATABASE_URL is configured. */
export async function initPersistence(): Promise<PrismaClient | null> {
  if (prisma) return prisma;
  if (!config.databaseUrl || config.isTest) return null;
  try {
    const mod = await import("@monumental/db");
    prisma = mod.prisma;
    await prisma.$queryRaw`SELECT 1`;
    console.log("[db] connected");
  } catch (e) {
    console.error("[db] failed to init prisma:", (e as Error).message);
    prisma = null;
  }
  return prisma;
}

export function getPrisma(): PrismaClient | null {
  return prisma;
}

/** For tests / alternate wiring. */
export function setPrisma(p: PrismaClient | null) {
  prisma = p;
}

export interface SessionPersistInput {
  sessionId: string;
  roomId: string;
  levelId: number;
  tournamentId?: string;
  stage?: number;
  players: {
    playerKey: string;
    userId: string | null;
    nickname: string;
    points: number;
    rank: number;
    roundsPlayed: number;
    avgError: number;
    bestError: number;
    won: boolean;
  }[];
}

export async function persistSession(input: SessionPersistInput): Promise<void> {
  const db = getPrisma();
  if (!db) return;
  const playersCount = input.players.length;
  try {
    await db.$transaction(async (tx) => {
      for (const p of input.players) {
        await tx.sessionResult.create({
          data: {
            sessionId: input.sessionId,
            roomId: input.roomId,
            levelId: input.levelId,
            playerKey: p.playerKey,
            userId: p.userId,
            nickname: p.nickname,
            points: p.points,
            rank: p.rank,
            playersCount,
            roundsPlayed: p.roundsPlayed,
            avgError: p.avgError,
            bestError: p.bestError,
            won: p.won,
            tournamentId: input.tournamentId,
            stage: input.stage,
          },
        });
        await tx.leaderboardEntry.create({
          data: { playerKey: p.playerKey, userId: p.userId, nickname: p.nickname, points: p.points, levelId: input.levelId },
        });
        const existing = await tx.playerStats.findUnique({ where: { playerKey: p.playerKey } });
        const bestError = existing?.bestError == null ? p.bestError : Math.min(existing.bestError, p.bestError);
        await tx.playerStats.upsert({
          where: { playerKey: p.playerKey },
          create: {
            playerKey: p.playerKey,
            userId: p.userId,
            nickname: p.nickname,
            gamesPlayed: 1,
            wins: p.won ? 1 : 0,
            totalPoints: p.points,
            roundsPlayed: p.roundsPlayed,
            errorSum: p.avgError * p.roundsPlayed,
            bestError: Number.isFinite(bestError) ? bestError : null,
          },
          update: {
            nickname: p.nickname,
            userId: p.userId ?? undefined,
            gamesPlayed: { increment: 1 },
            wins: { increment: p.won ? 1 : 0 },
            totalPoints: { increment: p.points },
            roundsPlayed: { increment: p.roundsPlayed },
            errorSum: { increment: p.avgError * p.roundsPlayed },
            bestError: Number.isFinite(bestError) ? bestError : undefined,
          },
        });
      }
    });
  } catch (e) {
    console.error("[db] persistSession failed", (e as Error).message);
  }
}
