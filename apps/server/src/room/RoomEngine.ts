import { nanoid } from "nanoid";
import {
  getLevel,
  pickSessionPairs,
  pickDuelPairs,
  scoreDuel,
  duelWinner,
  getDuelItem,
  scoreRound,
  realPercent,
  roundTo,
  LOBBY_SECONDS,
  REVEAL_SECONDS,
  INTERMISSION_SECONDS,
  type LevelConfig,
  type RoomPhase,
  type RoomState,
  type RoundPair,
  type RoundResult,
  type SessionResult,
  type PlayerPublic,
  type RoundStartPayload,
  type Monument,
} from "@monumental/shared";

export interface EnginePlayer {
  playerKey: string;
  userId: string | null;
  nickname: string;
  isGuest: boolean;
  connections: number;
  totalPoints: number;
  /** error for each round played this session (null = no guess) */
  errors: (number | null)[];
  /** round index the player may first score in (joined mid-round → next round) */
  eligibleFrom: number;
  lastSeen: number;
}

interface LiveRound {
  roundId: string;
  index: number;
  pair: RoundPair;
  realPct: number;
  endsAt: number;
  startedAt: number;
  guesses: Map<string, { guessPct: number; pick?: "a" | "b"; locked: boolean; at: number }>;
}

export interface EngineOptions {
  roomId: string;
  levelId: number;
  /** Public level rooms loop forever; tournament/private rooms may run once. */
  loop: boolean;
  roundsPerSession?: number;
  lobbySeconds?: number;
  tournament?: { id: string; name: string; stage: number; stageName: string };
  /** When set only these playerKeys may join (tournament rooms). */
  allowedPlayers?: Set<string>;
  catalog: () => Monument[];
  /** Deterministic timing for tests. */
  now?: () => number;
}

export interface EngineEvents {
  broadcast: (event: "room_state", payload: RoomState) => void;
  emit: <K extends "player_joined" | "player_left" | "player_locked" | "round_start" | "round_result" | "session_end">(
    event: K,
    payload: K extends "player_joined" ? PlayerPublic
      : K extends "player_left" ? { playerId: string }
      : K extends "player_locked" ? { playerId: string; locked: boolean }
      : K extends "round_start" ? RoundStartPayload
      : K extends "round_result" ? RoundResult
      : SessionResult,
  ) => void;
  onSessionEnd: (engine: RoomEngine, result: SessionResult, players: EnginePlayer[]) => void;
  onIdle: (engine: RoomEngine) => void;
  onSnapshot?: (engine: RoomEngine) => void;
}

/**
 * One live room. Owns the authoritative clock: lobby → (round → reveal) × N → finished → (intermission → lobby…).
 * All scoring happens here on the server; clients only ever send guesses.
 */
export class RoomEngine {
  readonly roomId: string;
  readonly level: LevelConfig;
  readonly opts: EngineOptions;
  phase: RoomPhase = "lobby";
  phaseEndsAt = 0;
  sessionId = nanoid(10);
  roundIndex = -1;
  roundsPerSession: number;
  pairs: RoundPair[] = [];
  players = new Map<string, EnginePlayer>();
  round: LiveRound | null = null;
  lastResult: RoundResult | null = null;
  lastSession: SessionResult | null = null;
  private timer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private started = false;
  destroyed = false;
  private now: () => number;

  constructor(opts: EngineOptions, private ev: EngineEvents) {
    this.opts = opts;
    this.roomId = opts.roomId;
    this.level = getLevel(opts.levelId);
    this.roundsPerSession = opts.roundsPerSession ?? this.level.roundsPerSession;
    this.now = opts.now ?? (() => Date.now());
  }

  // ───────────────────────── players ─────────────────────────

  canJoin(playerKey: string): string | null {
    if (this.destroyed) return "Room closed";
    if (this.opts.allowedPlayers && !this.opts.allowedPlayers.has(playerKey)) return "Not registered for this room";
    return null;
  }

  join(p: { playerKey: string; userId: string | null; nickname: string; isGuest: boolean }): EnginePlayer {
    let ep = this.players.get(p.playerKey);
    if (!ep) {
      ep = {
        ...p,
        connections: 0,
        totalPoints: 0,
        errors: [],
        // joining mid-round → eligible from the next round
        eligibleFrom: this.phase === "round" ? this.roundIndex + 1 : Math.max(0, this.roundIndex + (this.phase === "reveal" ? 1 : 0)),
        lastSeen: this.now(),
      };
      this.players.set(p.playerKey, ep);
      this.ev.emit("player_joined", this.publicPlayer(ep));
    } else {
      ep.nickname = p.nickname;
    }
    ep.connections++;
    ep.lastSeen = this.now();
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    if (!this.started) this.startLobby();
    return ep;
  }

  /** Pre-register a player (tournament seat) without a live connection. */
  seat(p: { playerKey: string; userId: string | null; nickname: string; isGuest: boolean }) {
    if (this.players.has(p.playerKey)) return;
    this.players.set(p.playerKey, { ...p, connections: 0, totalPoints: 0, errors: [], eligibleFrom: 0, lastSeen: this.now() });
  }

  /** Kick off the lobby countdown now (tournament rooms start on the server clock, not on first join). */
  start() {
    if (!this.started) this.startLobby();
  }

  leave(playerKey: string) {
    const ep = this.players.get(playerKey);
    if (!ep) return;
    ep.connections = Math.max(0, ep.connections - 1);
    if (ep.connections === 0) {
      // In the lobby / between sessions, drop immediately; mid-session keep the
      // seat so reconnects keep their points (removed at session end).
      // Tournament seats are never dropped.
      if ((this.phase === "lobby" || this.phase === "finished") && !this.opts.allowedPlayers) {
        this.players.delete(playerKey);
        this.ev.emit("player_left", { playerId: playerKey });
      } else {
        this.ev.emit("player_left", { playerId: playerKey }); // clients mark as disconnected via room_state
        this.broadcastState();
      }
    }
    if (this.connectedCount() === 0) this.scheduleIdle();
  }

  connectedCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.connections > 0) n++;
    return n;
  }

  private scheduleIdle() {
    if (this.idleTimer || !this.opts.loop) return;
    this.idleTimer = setTimeout(() => this.ev.onIdle(this), 120_000);
  }

  // ───────────────────────── guesses ─────────────────────────

  get isDuel() {
    return this.level.kind === "duel";
  }

  submitGuess(playerKey: string, roundId: string, guessPct: number | undefined, lock: boolean, pick?: "a" | "b"): { ok: boolean; error?: string } {
    const r = this.round;
    if (!r || this.phase !== "round") return { ok: false, error: "No round in progress" };
    if (r.roundId !== roundId) return { ok: false, error: "Stale round" };
    if (this.now() > r.endsAt + 750) return { ok: false, error: "Round over" }; // small latency grace
    const p = this.players.get(playerKey);
    if (!p) return { ok: false, error: "Not in room" };
    if (r.index < p.eligibleFrom) return { ok: false, error: "You joined mid-round — you'll play from the next one" };
    const prev = r.guesses.get(playerKey);
    if (prev?.locked) return { ok: false, error: "Already locked" };
    if (this.isDuel) {
      if (pick !== "a" && pick !== "b") return { ok: false, error: "Pick a side" };
      lock = true; // one tap = final answer
      r.guesses.set(playerKey, { guessPct: 0, pick, locked: true, at: this.now() });
    } else {
      if (typeof guessPct !== "number" || !Number.isFinite(guessPct)) return { ok: false, error: "Bad guess" };
      r.guesses.set(playerKey, { guessPct, locked: lock, at: this.now() });
    }
    if (lock) this.ev.emit("player_locked", { playerId: playerKey, locked: true });
    return { ok: true };
  }

  // ───────────────────────── phases ─────────────────────────

  private setTimer(ms: number, fn: () => void) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; if (!this.destroyed) fn(); }, Math.max(0, ms));
  }

  private startLobby() {
    this.started = true;
    this.phase = "lobby";
    this.sessionId = nanoid(10);
    this.roundIndex = -1;
    this.round = null;
    this.lastResult = null;
    for (const p of this.players.values()) { p.totalPoints = 0; p.errors = []; p.eligibleFrom = 0; }
    const seed = `${this.roomId}:${this.sessionId}`;
    this.pairs = this.isDuel
      ? pickDuelPairs(this.level.duelCats ?? [], this.level.tiers, this.roundsPerSession, seed).map((p) => ({ baseId: p.aId, targetId: p.bId }))
      : pickSessionPairs(this.level, this.opts.catalog(), this.roundsPerSession, seed);
    this.roundsPerSession = Math.min(this.roundsPerSession, this.pairs.length);
    const lobby = (this.opts.lobbySeconds ?? LOBBY_SECONDS) * 1000;
    this.phaseEndsAt = this.now() + lobby;
    this.broadcastState();
    this.setTimer(lobby, () => this.startRound());
  }

  private startRound() {
    if (this.connectedCount() === 0 && this.opts.loop) {
      // nobody here — go back to an (unstarted) lobby and wait
      this.started = false;
      this.phase = "lobby";
      this.phaseEndsAt = 0;
      this.scheduleIdle();
      return;
    }
    this.roundIndex++;
    const pair = this.pairs[this.roundIndex];
    let realPct = 0;
    if (!this.isDuel) {
      const base = this.opts.catalog().find((m) => m.id === pair.baseId)!;
      const target = this.opts.catalog().find((m) => m.id === pair.targetId)!;
      realPct = realPercent(base.heightM, target.heightM);
    }
    const endsAt = this.now() + this.level.timerSec * 1000;
    this.round = {
      roundId: nanoid(8),
      index: this.roundIndex,
      pair,
      realPct,
      startedAt: this.now(),
      endsAt,
      guesses: new Map(),
    };
    this.phase = "round";
    this.phaseEndsAt = endsAt;
    this.lastResult = null;
    this.ev.emit("round_start", {
      roundId: this.round.roundId,
      roundIndex: this.roundIndex,
      baseId: pair.baseId,
      targetId: pair.targetId,
      timerSec: this.level.timerSec,
      endsAt,
      serverNow: this.now(),
      levelId: this.level.id,
      kind: this.isDuel ? "duel" : "size",
    });
    this.broadcastState();
    this.setTimer(endsAt - this.now() + 250, () => this.endRound());
  }

  private endRound() {
    const r = this.round;
    if (!r) return;
    // Eligible = joined before this round AND (still connected OR actually sent a guess).
    // Disconnected seats that never guessed are left out of the round result (they keep their points).
    const eligible = [...this.players.values()].filter((p) => r.index >= p.eligibleFrom && (p.connections > 0 || r.guesses.has(p.playerKey)));
    if (this.isDuel) return this.endDuelRound(r, eligible);
    const scored = scoreRound(
      r.realPct,
      eligible.map((p) => ({ playerId: p.playerKey, guessPct: r.guesses.get(p.playerKey)?.guessPct ?? null })),
    );
    const entries = scored.map((s) => {
      const p = this.players.get(s.playerId)!;
      p.totalPoints += s.points;
      p.errors.push(s.errorPct);
      return {
        playerId: s.playerId,
        nickname: p.nickname,
        guessPct: s.guessPct == null ? null : roundTo(s.guessPct, 1),
        errorPct: s.errorPct == null ? null : roundTo(s.errorPct, 1),
        points: s.points,
        rank: s.rank,
      };
    });
    entries.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
    const result: RoundResult = {
      roundIndex: r.index,
      baseId: r.pair.baseId,
      targetId: r.pair.targetId,
      realPct: roundTo(r.realPct, 1),
      entries,
      leaderboard: this.leaderboard(),
    };
    this.finishRound(result);
  }

  private finishRound(result: RoundResult) {
    this.lastResult = result;
    this.phase = "reveal";
    this.phaseEndsAt = this.now() + REVEAL_SECONDS * 1000;
    this.ev.emit("round_result", result);
    this.broadcastState();
    const last = this.roundIndex >= this.roundsPerSession - 1;
    this.setTimer(REVEAL_SECONDS * 1000, () => (last ? this.endSession() : this.startRound()));
  }

  private endDuelRound(r: LiveRound, eligible: EnginePlayer[]) {
    const a = getDuelItem(r.pair.baseId);
    const b = getDuelItem(r.pair.targetId);
    const winner = duelWinner(a, b);
    const scored = scoreDuel(
      winner,
      eligible.map((p) => {
        const g = r.guesses.get(p.playerKey);
        return { playerId: p.playerKey, pick: g?.pick ?? null, ms: g ? g.at - r.startedAt : null };
      }),
    );
    const entries = scored.map((s) => {
      const p = this.players.get(s.playerId)!;
      p.totalPoints += s.points;
      // stats: "error" for duels = 0 when right, 100 when wrong / no answer
      p.errors.push(s.pick == null ? null : s.correct ? 0 : 100);
      return { playerId: s.playerId, nickname: p.nickname, guessPct: null, errorPct: null, pick: s.pick, ms: s.ms, correct: s.correct, points: s.points, rank: s.rank };
    });
    entries.sort((x, y) => (x.rank ?? 1e9) - (y.rank ?? 1e9) || Number(y.correct) - Number(x.correct));
    const result: RoundResult = {
      roundIndex: r.index,
      baseId: r.pair.baseId,
      targetId: r.pair.targetId,
      realPct: 0,
      duel: { winner },
      entries,
      leaderboard: this.leaderboard(),
    };
    this.finishRound(result);
  }

  private leaderboard() {
    return [...this.players.values()]
      .map((p) => ({ playerId: p.playerKey, nickname: p.nickname, totalPoints: p.totalPoints }))
      .sort((a, b) => b.totalPoints - a.totalPoints);
  }

  private endSession() {
    const players = [...this.players.values()];
    const lb = players
      .map((p) => {
        const errs = p.errors.filter((e): e is number => e != null);
        return {
          playerId: p.playerKey,
          nickname: p.nickname,
          totalPoints: p.totalPoints,
          avgError: errs.length ? roundTo(errs.reduce((a, b) => a + b, 0) / errs.length, 2) : Infinity,
        };
      })
      .sort((a, b) => b.totalPoints - a.totalPoints || a.avgError - b.avgError);
    const result: SessionResult = {
      sessionId: this.sessionId,
      levelId: this.level.id,
      leaderboard: lb.map((x) => ({ ...x, avgError: Number.isFinite(x.avgError) ? x.avgError : 999 })),
      winnerId: lb[0] && lb[0].totalPoints > 0 ? lb[0].playerId : null,
    };
    this.lastSession = result;
    this.phase = "finished";
    this.round = null;
    this.phaseEndsAt = this.now() + INTERMISSION_SECONDS * 1000;
    this.ev.emit("session_end", result);
    this.broadcastState();
    this.ev.onSessionEnd(this, result, players);

    // drop disconnected seats now that the session is over
    for (const [k, p] of this.players) if (p.connections === 0) this.players.delete(k);

    if (this.opts.loop) {
      this.setTimer(INTERMISSION_SECONDS * 1000, () => {
        if (this.connectedCount() === 0) { this.started = false; this.phase = "lobby"; this.phaseEndsAt = 0; this.scheduleIdle(); return; }
        this.startLobby();
      });
    } else {
      this.setTimer(INTERMISSION_SECONDS * 1000, () => this.ev.onIdle(this));
    }
  }

  // ───────────────────────── snapshots ─────────────────────────

  publicPlayer(p: EnginePlayer): PlayerPublic {
    return {
      id: p.playerKey,
      nickname: p.nickname,
      locked: this.round?.guesses.get(p.playerKey)?.locked ?? false,
      totalPoints: p.totalPoints,
      isGuest: p.isGuest,
      connected: p.connections > 0,
    };
  }

  state(): RoomState {
    return {
      roomId: this.roomId,
      levelId: this.level.id,
      phase: this.phase,
      phaseEndsAt: this.phaseEndsAt,
      serverNow: this.now(),
      roundIndex: this.roundIndex,
      roundsPerSession: this.roundsPerSession,
      sessionId: this.sessionId,
      players: [...this.players.values()].map((p) => this.publicPlayer(p)),
      round: this.round
        ? { baseId: this.round.pair.baseId, targetId: this.round.pair.targetId, timerSec: this.level.timerSec, roundId: this.round.roundId, kind: this.isDuel ? "duel" : "size" }
        : undefined,
      result: this.phase === "reveal" ? this.lastResult ?? undefined : undefined,
      sessionResult: this.phase === "finished" ? this.lastSession ?? undefined : undefined,
      tournament: this.opts.tournament,
    };
  }

  broadcastState() {
    this.ev.broadcast("room_state", this.state());
    this.ev.onSnapshot?.(this);
  }

  destroy() {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
  }
}
