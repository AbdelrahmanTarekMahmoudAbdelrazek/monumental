import type { Server } from "socket.io";
import { LEVELS, type ClientToServerEvents, type ServerToClientEvents, type SessionResult } from "@monumental/shared";
import { RoomEngine, type EngineOptions, type EnginePlayer } from "./RoomEngine.js";
import { getCatalog } from "../catalog.js";
import { persistSession } from "../persistence.js";
import type { LiveStore } from "../store.js";

export type IO = Server<ClientToServerEvents, ServerToClientEvents>;

export type SessionEndHook = (engine: RoomEngine, result: SessionResult, players: EnginePlayer[]) => void | Promise<void>;

/**
 * Owns every live RoomEngine in this process and bridges them to Socket.io.
 * Room ids:
 *   level:<n>            public room for a level (one per level per server; auto-created)
 *   p:<code>:<level>     private friends room
 *   t:<tid>:q<n> / t:<tid>:final   tournament stage rooms (created by the scheduler)
 */
export class RoomManager {
  rooms = new Map<string, RoomEngine>();
  private sessionEndHooks: SessionEndHook[] = [];

  constructor(private io: IO, private store: LiveStore) {}

  onSessionEnd(hook: SessionEndHook) { this.sessionEndHooks.push(hook); }

  publicRoomId(levelId: number) { return `level:${levelId}`; }

  get(roomId: string) { return this.rooms.get(roomId); }

  /** Resolve or create the room a join request points at. */
  resolve(p: { roomId?: string; levelId?: number }): RoomEngine | null {
    if (p.roomId) {
      const existing = this.rooms.get(p.roomId);
      if (existing) return existing;
      if (p.roomId.startsWith("level:")) {
        const lvl = Number(p.roomId.slice(6));
        return LEVELS.some((l) => l.id === lvl) ? this.create({ roomId: p.roomId, levelId: lvl, loop: true }) : null;
      }
      if (p.roomId.startsWith("p:")) {
        // private room "p:<code>:<level>"
        const [, code, lvlStr] = p.roomId.split(":");
        const lvl = Number(lvlStr ?? p.levelId ?? 1);
        if (!/^[A-Z0-9]{4,10}$/.test(code ?? "") || !LEVELS.some((l) => l.id === lvl)) return null;
        return this.create({ roomId: `p:${code}:${lvl}`, levelId: lvl, loop: true });
      }
      return null; // tournament rooms must already exist
    }
    if (p.levelId && LEVELS.some((l) => l.id === p.levelId)) {
      const id = this.publicRoomId(p.levelId);
      return this.rooms.get(id) ?? this.create({ roomId: id, levelId: p.levelId, loop: true });
    }
    return null;
  }

  create(o: Omit<EngineOptions, "catalog">): RoomEngine {
    const io = this.io;
    const engine = new RoomEngine(
      { ...o, catalog: getCatalog },
      {
        broadcast: (event, payload) => io.to(o.roomId).emit(event, payload),
        emit: (event, payload) => (io.to(o.roomId) as any).emit(event, payload),
        onSessionEnd: (eng, result, players) => this.handleSessionEnd(eng, result, players),
        onIdle: (eng) => this.destroy(eng.roomId),
        onSnapshot: (eng) => void this.snapshot(eng),
      },
    );
    this.rooms.set(o.roomId, engine);
    void this.store.sadd("rooms", o.roomId);
    return engine;
  }

  destroy(roomId: string) {
    const eng = this.rooms.get(roomId);
    if (!eng) return;
    eng.destroy();
    this.rooms.delete(roomId);
    void this.store.del(`room:${roomId}`);
    void this.store.srem("rooms", roomId);
    this.io.in(roomId).socketsLeave(roomId);
  }

  private async snapshot(eng: RoomEngine) {
    try {
      await this.store.set(`room:${eng.roomId}`, JSON.stringify(eng.state()), 600);
    } catch { /* ignore */ }
  }

  private async handleSessionEnd(eng: RoomEngine, result: SessionResult, players: EnginePlayer[]) {
    const ranked = result.leaderboard;
    const persist = players
      .filter((p) => p.errors.length > 0)
      .map((p) => {
        const errs = p.errors.filter((e): e is number => e != null);
        const rank = ranked.findIndex((r) => r.playerId === p.playerKey) + 1;
        return {
          playerKey: p.playerKey,
          userId: p.userId,
          nickname: p.nickname,
          points: p.totalPoints,
          rank,
          roundsPlayed: p.errors.length,
          avgError: errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : 999,
          bestError: errs.length ? Math.min(...errs) : 999,
          won: result.winnerId === p.playerKey,
        };
      });
    if (persist.length > 0) {
      await persistSession({
        sessionId: result.sessionId,
        roomId: eng.roomId,
        levelId: eng.level.id,
        tournamentId: eng.opts.tournament?.id,
        stage: eng.opts.tournament?.stage,
        players: persist,
      });
    }
    for (const h of this.sessionEndHooks) {
      try { await h(eng, result, players); } catch (e) { console.error("[rooms] hook failed", e); }
    }
  }

  /** Lightweight overview for the lobby page. */
  overview() {
    const levels = LEVELS.map((l) => {
      const r = this.rooms.get(this.publicRoomId(l.id));
      return { levelId: l.id, players: r?.connectedCount() ?? 0, phase: r?.phase ?? "lobby", roundIndex: r?.roundIndex ?? -1, phaseEndsAt: r?.phaseEndsAt ?? 0 };
    });
    return { levels, rooms: this.rooms.size, serverNow: Date.now() };
  }
}
