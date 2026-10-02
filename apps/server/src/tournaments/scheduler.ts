import { getLevel } from "@monumental/shared";
import type { PrismaClient } from "@monumental/db";
import type { RoomManager, IO } from "../room/RoomManager.js";
import type { RoomEngine, EnginePlayer } from "../room/RoomEngine.js";
import { config } from "../config.js";

/**
 * Tournament state machine (runs on the socket server, DB is the source of truth):
 *
 *  SCHEDULED/REGISTRATION ──startsAt──▶ QUALIFYING ──all q-rooms done──▶ FINAL ──done──▶ FINISHED
 *                           (<2 players → CANCELLED)
 *
 *  Qualifying: entries are split into rooms of ≤ qualifyingRoomSize, each room plays
 *  `qualifyingRounds` rounds. Top `advanceCount` by points (tie-break: avg error) advance.
 *  Final: one room, `finalRounds` rounds. Winner = most points.
 *
 *  Hourly open tournaments are auto-created so there is always one to join.
 */
export class TournamentScheduler {
  private timer: NodeJS.Timeout | null = null;
  /** tournamentId → set of live qualifying/final room ids still running */
  private pending = new Map<string, Set<string>>();

  constructor(private db: PrismaClient, private rooms: RoomManager, private io: IO) {
    rooms.onSessionEnd((eng, _r, players) => this.onRoomFinished(eng, players));
  }

  start(intervalMs = 15_000) {
    this.tick().catch((e) => console.error("[tournaments] tick", e));
    this.timer = setInterval(() => this.tick().catch((e) => console.error("[tournaments] tick", e)), intervalMs);
  }
  stop() { if (this.timer) clearInterval(this.timer); }

  async tick() {
    await this.ensureHourly();
    const now = new Date();
    // open registration 30 min before start
    await this.db.tournament.updateMany({
      where: { status: "SCHEDULED", startsAt: { lte: new Date(now.getTime() + 30 * 60 * 1000) } },
      data: { status: "REGISTRATION" },
    });
    const due = await this.db.tournament.findMany({
      where: { status: { in: ["SCHEDULED", "REGISTRATION"] }, startsAt: { lte: now } },
      include: { entries: true },
    });
    for (const t of due) await this.startQualifying(t);
  }

  private async ensureHourly() {
    for (let h = 1; h <= 2; h++) {
      const at = new Date();
      at.setUTCMinutes(0, 0, 0);
      at.setUTCHours(at.getUTCHours() + h);
      const exists = await this.db.tournament.findFirst({ where: { isRecurring: true, startsAt: at } });
      if (!exists) {
        await this.db.tournament.create({
          data: {
            name: `Hourly Open ${at.toISOString().slice(11, 16)} UTC`,
            levelId: config.hourlyTournamentLevel,
            startsAt: at,
            status: "REGISTRATION",
            isRecurring: true,
            qualifyingRounds: 5,
            finalRounds: 8,
            advanceCount: 8,
          },
        });
      }
    }
  }

  private async startQualifying(t: { id: string; name: string; levelId: number; entries: { playerKey: string; userId: string | null; nickname: string }[]; qualifyingRoomSize: number; qualifyingRounds: number }) {
    if (t.entries.length < 2) {
      await this.db.tournament.update({ where: { id: t.id }, data: { status: "CANCELLED", finishedAt: new Date() } });
      this.notify(t.entries.map((e) => e.playerKey), { tournamentId: t.id, status: "CANCELLED", stage: 0, message: "Not enough players — tournament cancelled." });
      return;
    }
    getLevel(t.levelId); // throws on bad level
    await this.db.tournament.update({ where: { id: t.id }, data: { status: "QUALIFYING" } });
    const size = Math.max(2, t.qualifyingRoomSize);
    const groups: typeof t.entries[] = [];
    const shuffled = [...t.entries].sort(() => Math.random() - 0.5);
    for (let i = 0; i < shuffled.length; i += size) groups.push(shuffled.slice(i, i + size));
    // avoid a lonely last group
    if (groups.length > 1 && groups[groups.length - 1].length < 2) {
      const last = groups.pop()!;
      groups[groups.length - 1].push(...last);
    }
    const live = new Set<string>();
    groups.forEach((g, i) => {
      const roomId = `t:${t.id}:q${i + 1}`;
      this.rooms.create({
        roomId,
        levelId: t.levelId,
        loop: false,
        roundsPerSession: t.qualifyingRounds,
        lobbySeconds: 25,
        tournament: { id: t.id, name: t.name, stage: 1, stageName: `Qualifier ${i + 1}` },
        allowedPlayers: new Set(g.map((e) => e.playerKey)),
      });
      live.add(roomId);
      // pre-seat registered players so they're scored even if they never show up
      const eng = this.rooms.get(roomId)!;
      for (const e of g) eng.seat({ playerKey: e.playerKey, userId: e.userId, nickname: e.nickname, isGuest: !e.userId });
      eng.start();
      this.notify(g.map((e) => e.playerKey), { tournamentId: t.id, status: "QUALIFYING", stage: 1, message: `${t.name} is starting — join your qualifier!`, roomId });
    });
    this.pending.set(t.id, live);
    console.log(`[tournaments] ${t.name}: ${t.entries.length} players in ${groups.length} qualifier room(s)`);
  }

  private async onRoomFinished(eng: RoomEngine, players: EnginePlayer[]) {
    const t = eng.opts.tournament;
    if (!t) return;
    const live = this.pending.get(t.id);
    if (!live) return;
    live.delete(eng.roomId);

    // write stage results to entries
    for (const p of players) {
      const errs = p.errors.filter((e): e is number => e != null);
      const avg = errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : 999;
      if (t.stage === 1) {
        await this.db.tournamentEntry.updateMany({ where: { tournamentId: t.id, playerKey: p.playerKey }, data: { qualifyingPoints: p.totalPoints, qualifyingAvgError: avg } });
      } else {
        await this.db.tournamentEntry.updateMany({ where: { tournamentId: t.id, playerKey: p.playerKey }, data: { finalPoints: p.totalPoints } });
      }
    }
    if (live.size > 0) return; // other rooms of this stage still running

    const tour = await this.db.tournament.findUnique({ where: { id: t.id }, include: { entries: true } });
    if (!tour) return;

    if (t.stage === 1) {
      const ranked = [...tour.entries].sort((a, b) => b.qualifyingPoints - a.qualifyingPoints || (a.qualifyingAvgError ?? 999) - (b.qualifyingAvgError ?? 999));
      const finalists = ranked.slice(0, Math.max(2, tour.advanceCount));
      await this.db.tournamentEntry.updateMany({ where: { id: { in: finalists.map((f) => f.id) } }, data: { advanced: true } });
      await this.db.tournament.update({ where: { id: t.id }, data: { status: "FINAL" } });
      const roomId = `t:${t.id}:final`;
      this.rooms.create({
        roomId,
        levelId: tour.levelId,
        loop: false,
        roundsPerSession: tour.finalRounds,
        lobbySeconds: 25,
        tournament: { id: t.id, name: tour.name, stage: 2, stageName: "Final" },
        allowedPlayers: new Set(finalists.map((f) => f.playerKey)),
      });
      const eng2 = this.rooms.get(roomId)!;
      for (const f of finalists) eng2.seat({ playerKey: f.playerKey, userId: f.userId, nickname: f.nickname, isGuest: !f.userId });
      eng2.start();
      this.pending.set(t.id, new Set([roomId]));
      this.notify(finalists.map((f) => f.playerKey), { tournamentId: t.id, status: "FINAL", stage: 2, message: `You advanced to the ${tour.name} final!`, roomId });
      this.notify(ranked.slice(finalists.length).map((f) => f.playerKey), { tournamentId: t.id, status: "FINAL", stage: 2, message: `Qualifying over — you didn't make the top ${finalists.length} this time.` });
    } else {
      const finalists = tour.entries.filter((e) => e.advanced).sort((a, b) => b.finalPoints - a.finalPoints);
      for (let i = 0; i < finalists.length; i++) {
        await this.db.tournamentEntry.update({ where: { id: finalists[i].id }, data: { finalRank: i + 1 } });
      }
      const w = finalists[0];
      await this.db.tournament.update({ where: { id: t.id }, data: { status: "FINISHED", finishedAt: new Date(), winnerKey: w?.playerKey, winnerName: w?.nickname } });
      this.pending.delete(t.id);
      this.notify(tour.entries.map((e) => e.playerKey), { tournamentId: t.id, status: "FINISHED", stage: 2, message: `${tour.name} finished — winner: ${w?.nickname ?? "nobody"}!` });
      console.log(`[tournaments] ${tour.name} finished, winner ${w?.nickname}`);
    }
  }

  private notify(playerKeys: string[], payload: { tournamentId: string; status: string; stage: number; message: string; roomId?: string }) {
    for (const k of playerKeys) this.io.to(`player:${k}`).emit("tournament_update", payload);
  }
}
