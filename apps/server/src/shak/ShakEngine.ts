import {
  claimIsTrue,
  dealShak,
  shakStarter,
  tileHas,
  tileOf,
  type ShakPhase,
  type ShakPublicState,
  type ShakReveal,
  type ShakSettings,
} from "@monumental/shared";

/**
 * One أشك table. Server-authoritative: hands live only here; each player is
 * sent their own hand privately. See packages/shared/src/shak.ts for the rules.
 */

export interface ShakSeat {
  id: string; // playerKey, or "bot:N"
  nickname: string;
  isBot: boolean;
  connections: number;
  hand: number[];
  outRank: number | null;
  pendingExit: boolean;
  crowns: number;
}

interface Play { by: string; tiles: number[] }

export interface ShakEvents {
  /** Broadcast the public state to everyone at the table. */
  broadcast: (s: ShakPublicState) => void;
  /** Send one player their private hand. */
  sendHand: (playerId: string, tiles: number[]) => void;
  onIdle: () => void;
}

const REVEAL_MS = 4200;
const BOT_NAMES = ["Bot Amr", "Bot Nour", "Bot Salma", "Bot Karim"];

export class ShakEngine {
  phase: ShakPhase = "waiting";
  seats: ShakSeat[] = [];
  hostId: string;
  settings: ShakSettings;
  round = 0;
  private turn = -1; // seat index
  private turnEndsAt = 0;
  private number: number | null = null;
  private table: Play[] = [];
  private doubtOpen = false;
  private passesInRow = 0;
  private excluded: number[] = [];
  private order: string[] = [];
  private reveal: ShakReveal | undefined;
  private log: ShakPublicState["log"];
  private timer: NodeJS.Timeout | null = null;
  private botTimers: NodeJS.Timeout[] = [];
  private idleTimer: NodeJS.Timeout | null = null;
  private hostTimer: NodeJS.Timeout | null = null;
  private result: ShakPublicState["result"];
  destroyed = false;

  constructor(
    readonly code: string,
    hostId: string,
    settings: ShakSettings,
    private ev: ShakEvents,
    private now: () => number = () => Date.now(),
    private rnd: () => number = Math.random,
    /** Bot thinking delay range (ms); tests pass small values. */
    private botDelay: [number, number] = [1100, 2600],
  ) {
    this.hostId = hostId;
    this.settings = settings;
    this.scheduleIdle();
  }

  // ───────────────────────── seats ─────────────────────────

  join(id: string, nickname: string): { ok: boolean; error?: string } {
    if (this.destroyed) return { ok: false, error: "Table closed" };
    let s = this.seats.find((x) => x.id === id);
    if (!s) {
      if (this.phase !== "waiting" && this.phase !== "finished") return { ok: false, error: "A round is in progress — join when it ends" };
      if (this.seats.length >= 4) return { ok: false, error: "Table is full (4 players)" };
      s = { id, nickname, isBot: false, connections: 0, hand: [], outRank: null, pendingExit: false, crowns: 0 };
      this.seats.push(s);
    }
    s.nickname = nickname;
    s.connections++;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    if (id === this.hostId && this.hostTimer) { clearTimeout(this.hostTimer); this.hostTimer = null; }
    this.push();
    return { ok: true };
  }

  leave(id: string) {
    const s = this.seats.find((x) => x.id === id);
    if (!s) return;
    s.connections = Math.max(0, s.connections - 1);
    if (s.connections === 0 && (this.phase === "waiting" || this.phase === "finished")) {
      this.seats = this.seats.filter((x) => x !== s);
    }
    if (id === this.hostId && !this.hostTimer) {
      this.hostTimer = setTimeout(() => {
        this.hostTimer = null;
        const h = this.seats.find((x) => x.id === this.hostId);
        if (h && h.connections > 0) return;
        const next = this.seats.find((x) => !x.isBot && x.connections > 0);
        if (next) { this.hostId = next.id; this.push(); }
      }, 15_000);
    }
    if (!this.seats.some((x) => !x.isBot && x.connections > 0)) this.scheduleIdle();
    this.push();
  }

  addBot(by: string) {
    if (by !== this.hostId) return { ok: false, error: "Only the host can add bots" };
    if (this.phase !== "waiting" && this.phase !== "finished") return { ok: false, error: "Wait for the round to end" };
    if (this.seats.length >= 4) return { ok: false, error: "Table is full" };
    const n = this.seats.filter((x) => x.isBot).length;
    this.seats.push({ id: `bot:${n + 1}:${Math.floor(this.rnd() * 1e6)}`, nickname: BOT_NAMES[n] ?? `Bot ${n + 1}`, isBot: true, connections: 1, hand: [], outRank: null, pendingExit: false, crowns: 0 });
    this.push();
    return { ok: true };
  }

  removeBot(by: string) {
    if (by !== this.hostId) return { ok: false, error: "Only the host can remove bots" };
    if (this.phase !== "waiting" && this.phase !== "finished") return { ok: false, error: "Wait for the round to end" };
    const i = this.seats.map((x) => x.isBot).lastIndexOf(true);
    if (i < 0) return { ok: false, error: "No bots to remove" };
    this.seats.splice(i, 1);
    this.push();
    return { ok: true };
  }

  updateSettings(by: string, s: ShakSettings) {
    if (by !== this.hostId) return { ok: false, error: "Only the host can change settings" };
    if (this.phase !== "waiting" && this.phase !== "finished") return { ok: false, error: "Wait for the round to end" };
    this.settings = s;
    this.push();
    return { ok: true };
  }

  // ───────────────────────── round flow ─────────────────────────

  start(by: string): { ok: boolean; error?: string } {
    if (by !== this.hostId) return { ok: false, error: "Only the host can start" };
    if (this.phase !== "waiting" && this.phase !== "finished") return { ok: false, error: "Already playing" };
    // drop humans who left
    this.seats = this.seats.filter((x) => x.isBot || x.connections > 0);
    if (this.seats.length < 3) return { ok: false, error: "أشك needs 3 or 4 players — invite friends or add a bot" };
    const { hands, excluded } = dealShak(this.seats.length, this.rnd);
    this.seats.forEach((s, i) => { s.hand = hands[i]; s.outRank = null; s.pendingExit = false; });
    this.excluded = excluded;
    this.round++;
    this.order = [];
    this.table = [];
    this.number = null;
    this.doubtOpen = false;
    this.passesInRow = 0;
    this.reveal = undefined;
    this.result = undefined;
    this.phase = "playing";
    this.setLog("start", undefined, `Round ${this.round} — ${this.seats[shakStarter(hands)].nickname} holds the biggest double and starts`);
    this.sendHands();
    this.beginTurn(shakStarter(hands));
    return { ok: true };
  }

  play(by: string, tiles: number[], number?: number): { ok: boolean; error?: string } {
    if (this.phase !== "playing") return { ok: false, error: "Not now" };
    const seat = this.seats[this.turn];
    if (!seat || seat.id !== by) return { ok: false, error: "Not your turn" };
    const uniq = [...new Set(tiles)];
    if (uniq.length === 0) return { ok: false, error: "Pick at least one tile" };
    if (this.settings.maxPerPlay > 0 && uniq.length > this.settings.maxPerPlay) return { ok: false, error: `At most ${this.settings.maxPerPlay} tiles per play` };
    if (!uniq.every((t) => seat.hand.includes(t))) return { ok: false, error: "You don't have those tiles" };
    if (this.number === null) {
      if (typeof number !== "number" || !Number.isInteger(number) || number < 0 || number > 6) return { ok: false, error: "Announce a number from 0 to 6" };
      this.number = number;
    }
    this.settleOpenPlay();
    seat.hand = seat.hand.filter((t) => !uniq.includes(t));
    this.table.push({ by, tiles: uniq });
    this.doubtOpen = true;
    this.passesInRow = 0;
    if (seat.hand.length === 0) seat.pendingExit = true;
    this.setLog("play", by, `${seat.nickname} put ${uniq.length} tile${uniq.length > 1 ? "s" : ""} — “${uniq.length > 1 ? "all" : "it's a"} ${this.number}”`);
    this.ev.sendHand(by, seat.hand);
    if (this.checkEnd()) return { ok: true };
    this.beginTurn(this.nextActive(this.turn));
    this.scheduleBotDoubts(by);
    return { ok: true };
  }

  pass(by: string): { ok: boolean; error?: string } {
    if (this.phase !== "playing") return { ok: false, error: "Not now" };
    const seat = this.seats[this.turn];
    if (!seat || seat.id !== by) return { ok: false, error: "Not your turn" };
    if (this.number === null) return { ok: false, error: "You're starting a new pile — announce a number and play" };
    this.settleOpenPlay();
    this.doubtOpen = false;
    this.passesInRow++;
    this.setLog("pass", by, `${seat.nickname} passed`);
    if (this.checkEnd()) return { ok: true };
    const active = this.activeSeats().length;
    if (this.passesInRow >= active) {
      // everyone passed — the table is removed for good
      const n = this.table.reduce((a, p) => a + p.tiles.length, 0);
      this.table = [];
      this.number = null;
      this.passesInRow = 0;
      this.setLog("clear", undefined, `Everyone passed — ${n} tile${n === 1 ? "" : "s"} removed from the game`);
    }
    this.beginTurn(this.nextActive(this.turn));
    return { ok: true };
  }

  doubt(by: string): { ok: boolean; error?: string } {
    if (this.phase !== "playing") return { ok: false, error: "Not now" };
    if (!this.doubtOpen || this.table.length === 0 || this.number === null) return { ok: false, error: "Nothing to doubt right now" };
    const last = this.table[this.table.length - 1];
    if (last.by === by) return { ok: false, error: "You can't doubt yourself" };
    const doubter = this.seats.find((s) => s.id === by);
    if (!doubter || doubter.outRank !== null || doubter.pendingExit) return { ok: false, error: "You're not in this round" };
    const player = this.seats.find((s) => s.id === last.by)!;
    const truthful = claimIsTrue(last.tiles, this.number);
    const loser = truthful ? doubter : player;
    const all = this.table.flatMap((p) => p.tiles);
    loser.hand = [...loser.hand, ...all].sort((a, b) => a - b);
    if (loser === player) player.pendingExit = false;
    this.reveal = { doubterId: doubter.id, playerId: player.id, number: this.number, tiles: last.tiles, truthful, loserId: loser.id, taken: all.length };
    this.setLog("doubt", by, `${doubter.nickname}: «أشك!» — ${player.nickname} was ${truthful ? "telling the truth" : "bluffing"}. ${loser.nickname} takes ${all.length} tile${all.length === 1 ? "" : "s"}`);
    this.table = [];
    this.number = null;
    this.doubtOpen = false;
    this.passesInRow = 0;
    this.ev.sendHand(loser.id, loser.hand);
    // a truthful last-tile play survives → that player is out
    if (truthful && player.pendingExit) this.markOut(player);
    this.phase = "reveal";
    this.clearTimers();
    this.turnEndsAt = this.now() + REVEAL_MS;
    this.push();
    this.timer = setTimeout(() => {
      this.reveal = undefined;
      this.phase = "playing";
      if (this.checkEnd()) return;
      // the tile-player starts a fresh pile, or the next player if their hand is empty
      const pi = this.seats.indexOf(player);
      const starter = player.hand.length > 0 && player.outRank === null ? pi : this.nextActive(pi);
      this.beginTurn(starter);
    }, REVEAL_MS);
    return { ok: true };
  }

  // ───────────────────────── internals ─────────────────────────

  /** A new play/pass closes the doubt window — a pending last-tile player is now safely out. */
  private settleOpenPlay() {
    const last = this.table[this.table.length - 1];
    if (!this.doubtOpen || !last) return;
    const s = this.seats.find((x) => x.id === last.by);
    if (s?.pendingExit) this.markOut(s);
    this.doubtOpen = false;
  }

  private markOut(s: ShakSeat) {
    s.pendingExit = false;
    if (s.outRank !== null) return;
    this.order.push(s.id);
    s.outRank = this.order.length;
    if (s.outRank === 1) s.crowns++;
    this.setLog("out", s.id, s.outRank === 1 ? `👑 ${s.nickname} is out first — the king!` : `${s.nickname} is out (#${s.outRank})`);
  }

  private activeSeats() {
    return this.seats.filter((s) => s.outRank === null && !s.pendingExit && s.hand.length > 0);
  }

  private nextActive(from: number) {
    for (let k = 1; k <= this.seats.length; k++) {
      const i = (from + k) % this.seats.length;
      const s = this.seats[i];
      if (s.outRank === null && !s.pendingExit && s.hand.length > 0) return i;
    }
    return from;
  }

  /** Ends the round when one (or zero) players still hold tiles and nothing is pending. */
  private checkEnd(): boolean {
    const holding = this.seats.filter((s) => s.outRank === null && s.hand.length > 0);
    const pending = this.seats.filter((s) => s.pendingExit);
    if (holding.length > 1) return false;
    if (holding.length === 1 && pending.length > 0) {
      // the last holder may still doubt or act — let them
      return false;
    }
    for (const p of pending) this.markOut(p);
    // nobody left holding (the last two emptied their hands back to back) → the last one out is the fool
    const fool = holding[0] ?? (this.order.length > 1 ? this.seats.find((x) => x.id === this.order[this.order.length - 1]) ?? null : null);
    const foolInOrder = !!fool && this.order.includes(fool.id);
    this.phase = "finished";
    this.clearTimers();
    this.turn = -1;
    this.doubtOpen = false;
    this.result = {
      order: [...this.order, ...(fool && !foolInOrder ? [fool.id] : [])],
      kingId: this.order[0] ?? fool?.id ?? "",
      foolId: fool?.id ?? null,
      hands: this.seats.map((s) => ({ id: s.id, tiles: s.hand })),
    };
    this.setLog("out", fool?.id, fool ? `Round over — ${fool.nickname} is ${foolInOrder ? "last out" : "left holding tiles"} 🤡` : "Round over");
    this.push();
    if (!this.seats.some((x) => !x.isBot && x.connections > 0)) this.scheduleIdle();
    return true;
  }

  private beginTurn(i: number) {
    this.clearTimers();
    this.turn = i;
    this.turnEndsAt = this.now() + this.settings.turnSec * 1000;
    this.push();
    const seat = this.seats[i];
    this.timer = setTimeout(() => this.onTimeout(), this.settings.turnSec * 1000);
    if (seat?.isBot) this.botTimers.push(setTimeout(() => this.botAct(seat.id), this.delay()));
  }

  private onTimeout() {
    const seat = this.seats[this.turn];
    if (!seat || this.phase !== "playing") return;
    if (this.number === null) {
      // must start: play one tile honestly
      const t = seat.hand[0];
      this.play(seat.id, [t], Math.max(...tileOf(t)));
    } else {
      this.pass(seat.id);
    }
  }

  // ───────────────────────── bots ─────────────────────────

  private delay() {
    const [lo, hi] = this.botDelay;
    return lo + this.rnd() * (hi - lo);
  }

  private botAct(id: string) {
    const seat = this.seats[this.turn];
    if (!seat || seat.id !== id || this.phase !== "playing") return;
    const hand = seat.hand;
    if (this.number === null) {
      // start a pile with the number we hold most of
      const counts = [0, 1, 2, 3, 4, 5, 6].map((n) => hand.filter((t) => tileHas(t, n)).length);
      const n = counts.indexOf(Math.max(...counts));
      const honest = hand.filter((t) => tileHas(t, n));
      const pick = honest.slice(0, Math.min(honest.length, 1 + Math.floor(this.rnd() * 2)));
      const lies = hand.filter((t) => !tileHas(t, n));
      if (lies.length && this.rnd() < 0.25) pick.push(lies[0]);
      this.play(id, this.cap(pick), n);
      return;
    }
    const n = this.number;
    const honest = hand.filter((t) => tileHas(t, n));
    const lies = hand.filter((t) => !tileHas(t, n));
    if (honest.length) {
      const pick = honest.slice(0, Math.min(honest.length, 1 + Math.floor(this.rnd() * 2)));
      if (lies.length && this.rnd() < 0.2) pick.push(lies[Math.floor(this.rnd() * lies.length)]);
      this.play(id, this.cap(pick));
    } else if (lies.length && this.rnd() < (hand.length <= 2 ? 0.7 : 0.45)) {
      this.play(id, [lies[Math.floor(this.rnd() * lies.length)]]);
    } else {
      this.pass(id);
    }
  }

  private cap(tiles: number[]) {
    return this.settings.maxPerPlay > 0 ? tiles.slice(0, this.settings.maxPerPlay) : tiles;
  }

  /** After a play, bots that can doubt may shout «أشك» before the next move. */
  private scheduleBotDoubts(playerId: string) {
    const n = this.number;
    const last = this.table[this.table.length - 1];
    if (n === null || !last) return;
    for (const b of this.seats.filter((s) => s.isBot && s.id !== playerId && s.outRank === null && !s.pendingExit)) {
      const mine = b.hand.filter((t) => tileHas(t, n)).length;
      // 7 tiles carry any given number; count those already accounted for in this pile
      const claimedBefore = this.table.slice(0, -1).reduce((a, p) => a + p.tiles.length, 0);
      const remaining = 7 - mine;
      let p = 0.12 + 0.12 * (last.tiles.length - 1) + (mine >= 3 ? 0.18 : 0) + (claimedBefore + last.tiles.length > remaining ? 0.35 : 0);
      const lp = this.seats.find((s) => s.id === playerId);
      if (lp?.pendingExit) p += 0.3;
      if (last.tiles.length > remaining) p = 1;
      if (this.rnd() < Math.min(0.95, p)) {
        this.botTimers.push(setTimeout(() => {
          if (this.doubtOpen && this.table[this.table.length - 1] === last) this.doubt(b.id);
        }, 500 + this.rnd() * 900));
        break; // one bot shouts at most
      }
    }
  }

  // ───────────────────────── output ─────────────────────────

  private sendHands() {
    for (const s of this.seats) if (!s.isBot) this.ev.sendHand(s.id, s.hand);
  }

  handOf(id: string) {
    return this.seats.find((s) => s.id === id)?.hand ?? [];
  }

  private setLog(kind: NonNullable<ShakPublicState["log"]>["kind"], by: string | undefined, text: string) {
    this.log = { kind, by, text, at: this.now() };
  }

  state(): ShakPublicState {
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      settings: this.settings,
      players: this.seats.map((s) => ({ id: s.id, nickname: s.nickname, isBot: s.isBot, connected: s.isBot || s.connections > 0, tiles: s.hand.length, outRank: s.outRank, pendingExit: s.pendingExit, crowns: s.crowns })),
      turnId: this.phase === "playing" ? this.seats[this.turn]?.id ?? null : null,
      turnEndsAt: this.turnEndsAt,
      serverNow: this.now(),
      number: this.number,
      tableCount: this.table.reduce((a, p) => a + p.tiles.length, 0),
      plays: this.table.map((p) => ({ by: p.by, count: p.tiles.length })),
      doubtOpen: this.doubtOpen,
      excludedCount: this.excluded.length,
      round: this.round,
      reveal: this.reveal,
      log: this.log,
      result: this.result,
    };
  }

  private push() {
    if (!this.destroyed) this.ev.broadcast(this.state());
  }

  private clearTimers() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.botTimers.forEach(clearTimeout);
    this.botTimers = [];
  }

  private scheduleIdle() {
    if (this.idleTimer) return;
    this.idleTimer = setTimeout(() => this.ev.onIdle(), 15 * 60_000);
  }

  destroy() {
    this.destroyed = true;
    this.clearTimers();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.hostTimer) clearTimeout(this.hostTimer);
  }
}
