import {
  SMUGGLE_GUESS_SEC,
  SMUGGLE_LIMITS,
  SMUGGLE_OPENERS,
  SMUGGLE_SENTENCE_MAX,
  SMUGGLE_WORDS,
  containsWord,
  type SmuggleAction,
  type SmuggleLine,
  type SmugglePhase,
  type SmugglePublicState,
  type SmuggleResult,
  type SmuggleSettings,
} from "@monumental/shared";

interface Seat {
  id: string;
  nickname: string;
  connections: number;
  inGame: boolean;
  words: string[];
  score: number;
  guesses: Record<string, string> | null;
}

type R = { ok: boolean; error?: string };
const ok: R = { ok: true };
const no = (error: string): R => ({ ok: false, error });

export interface SmuggleEvents {
  broadcast: (s: SmugglePublicState) => void;
  sendSecret: (playerId: string, words: string[]) => void;
  onIdle: () => void;
}

/** Server-authoritative SMUGGLERS table. Secret words are only ever sent to their owner (until the reveal). */
export class SmuggleEngine {
  private seats: Seat[] = [];
  private phase: SmugglePhase = "lobby";
  private story: SmuggleLine[] = [];
  private order: string[] = [];
  private turnIdx = 0;
  private lap = 0;
  private turnEndsAt = 0;
  private options: string[] = [];
  private results: SmuggleResult[] | null = null;
  private game = 0;
  private event: SmugglePublicState["event"];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hostTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(
    readonly code: string,
    private hostId: string,
    private settings: SmuggleSettings,
    private ev: SmuggleEvents,
    private now: () => number = Date.now,
    private rnd: () => number = Math.random,
  ) {
    this.scheduleIdle();
  }

  // ───────────────────────── seats ─────────────────────────

  join(id: string, nickname: string): R {
    if (this.destroyed) return no("Table closed");
    let s = this.seats.find((x) => x.id === id);
    if (!s) {
      if (this.seats.length >= SMUGGLE_LIMITS.players.max) return no(`Table is full (${SMUGGLE_LIMITS.players.max} players)`);
      s = { id, nickname, connections: 0, inGame: false, words: [], score: 0, guesses: null };
      this.seats.push(s);
    }
    s.nickname = nickname;
    s.connections++;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    if (id === this.hostId && this.hostTimer) { clearTimeout(this.hostTimer); this.hostTimer = null; }
    this.push();
    return ok;
  }

  leave(id: string) {
    const s = this.seats.find((x) => x.id === id);
    if (!s) return;
    s.connections = Math.max(0, s.connections - 1);
    if (s.connections === 0 && (this.phase === "lobby" || !s.inGame)) this.seats = this.seats.filter((x) => x !== s);
    if (id === this.hostId && !this.hostTimer) {
      this.hostTimer = setTimeout(() => {
        this.hostTimer = null;
        const h = this.seats.find((x) => x.id === this.hostId);
        if (h && h.connections > 0) return;
        const next = this.seats.find((x) => x.connections > 0);
        if (next) { this.hostId = next.id; this.push(); }
      }, 15_000);
    }
    if (!this.seats.some((x) => x.connections > 0)) this.scheduleIdle();
    // a writer who left mid-game shouldn't stall the table forever
    if (this.phase === "guessing") this.maybeReveal();
    this.push();
  }

  secretFor(id: string): string[] {
    const s = this.seats.find((x) => x.id === id);
    return s && s.inGame && this.phase !== "lobby" ? s.words.slice() : [];
  }

  // ───────────────────────── actions ─────────────────────────

  act(by: string, a: SmuggleAction): R {
    if (this.destroyed) return no("Table closed");
    const me = this.seats.find((x) => x.id === by);
    if (!me) return no("Join the table first");
    switch (a.type) {
      case "start": return this.start(by);
      case "write": return this.write(me, a.text);
      case "guess": return this.guess(me, a.guesses);
      case "settings": return this.updateSettings(by, a.settings);
      case "to_lobby": return this.toLobby(by);
    }
    return no("Unknown action");
  }

  private updateSettings(by: string, s: Partial<SmuggleSettings>): R {
    if (by !== this.hostId) return no("Only the host can change settings");
    if (this.phase === "writing" || this.phase === "guessing") return no("Wait for the game to end");
    this.settings = { ...this.settings, ...s };
    this.push();
    return ok;
  }

  private toLobby(by: string): R {
    if (by !== this.hostId) return no("Only the host can do that");
    this.clearTimer();
    this.phase = "lobby";
    this.seats = this.seats.filter((x) => x.connections > 0);
    this.seats.forEach((s) => { s.inGame = false; this.ev.sendSecret(s.id, []); });
    this.push();
    return ok;
  }

  start(by: string): R {
    if (by !== this.hostId) return no("Only the host can start");
    if (this.phase === "writing" || this.phase === "guessing") return no("Already playing");
    this.seats = this.seats.filter((x) => x.connections > 0);
    if (this.seats.length < SMUGGLE_LIMITS.players.min) return no(`Smugglers needs at least ${SMUGGLE_LIMITS.players.min} players — share the invite link`);
    this.game++;
    const pool = this.shuffle(SMUGGLE_WORDS);
    let k = 0;
    for (const s of this.seats) {
      s.inGame = true;
      s.words = pool.slice(k, k + this.settings.wordsPer);
      k += this.settings.wordsPer;
      s.guesses = null;
    }
    // guess options: every secret word in play + a few decoys
    const decoys = pool.slice(k, k + Math.max(4, Math.ceil(this.seats.length * 0.8)));
    this.options = this.shuffle([...this.seats.flatMap((s) => s.words), ...decoys]);
    this.order = this.shuffle(this.seats.map((s) => s.id));
    this.story = [{ by: null, text: SMUGGLE_OPENERS[Math.floor(this.rnd() * SMUGGLE_OPENERS.length)] }];
    this.results = null;
    this.lap = 1;
    this.phase = "writing";
    this.setEvent(`Game ${this.game} — check your secret word and start smuggling 🕵️`);
    this.seats.forEach((s) => this.ev.sendSecret(s.id, s.words.slice()));
    this.beginTurn(0);
    return ok;
  }

  private write(me: Seat, raw: string): R {
    if (this.phase !== "writing") return no("Not writing now");
    if (this.order[this.turnIdx] !== me.id) return no("Wait for your turn");
    const text = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, SMUGGLE_SENTENCE_MAX);
    if (text.length < 3) return no("Write a sentence");
    this.story.push({ by: me.id, text });
    this.nextTurn();
    return ok;
  }

  private guess(me: Seat, g: Record<string, string>): R {
    if (this.phase !== "guessing") return no("Not guessing now");
    if (!me.inGame) return no("You're watching this game");
    const clean: Record<string, string> = {};
    for (const s of this.seats) {
      if (!s.inGame || s.id === me.id) continue;
      const w = String(g?.[s.id] ?? "").toUpperCase();
      if (w && this.options.includes(w)) clean[s.id] = w;
    }
    me.guesses = clean;
    this.push();
    this.maybeReveal();
    return ok;
  }

  // ───────────────────────── flow ─────────────────────────

  private beginTurn(i: number) {
    this.clearTimer();
    this.turnIdx = i;
    this.turnEndsAt = this.now() + this.settings.turnSec * 1000;
    this.timer = setTimeout(() => {
      this.timer = null;
      const id = this.order[this.turnIdx];
      const s = this.seats.find((x) => x.id === id);
      this.story.push({ by: id, text: `(${s?.nickname ?? "Someone"} stayed silent…)`, skipped: true });
      this.nextTurn();
    }, this.settings.turnSec * 1000);
    this.push();
  }

  private nextTurn() {
    let i = this.turnIdx + 1;
    if (i >= this.order.length) {
      i = 0;
      this.lap++;
      if (this.lap > this.settings.laps) return this.beginGuessing();
    }
    this.beginTurn(i);
  }

  private beginGuessing() {
    this.clearTimer();
    this.phase = "guessing";
    this.turnEndsAt = this.now() + SMUGGLE_GUESS_SEC * 1000;
    this.setEvent("The story is done! Who smuggled what? 🔍");
    this.timer = setTimeout(() => { this.timer = null; this.reveal(); }, SMUGGLE_GUESS_SEC * 1000);
    this.push();
  }

  private maybeReveal() {
    const players = this.seats.filter((s) => s.inGame && s.connections > 0);
    if (players.length && players.every((s) => s.guesses)) this.reveal();
  }

  private reveal() {
    if (this.phase !== "guessing") return;
    this.clearTimer();
    const inGame = this.seats.filter((s) => s.inGame);
    const results: SmuggleResult[] = inGame.map((s) => {
      const mine = this.story.filter((l) => l.by === s.id && !l.skipped).map((l) => l.text).join(" \n ");
      const smuggled = s.words.map((w) => containsWord(mine, w));
      const caughtBy = inGame.filter((o) => o.id !== s.id && o.guesses && s.words.includes(o.guesses[s.id] ?? "")).map((o) => o.id);
      let points = smuggled.filter(Boolean).length * 2;
      if (smuggled.some(Boolean) && caughtBy.length === 0) points += 3;
      return { playerId: s.id, words: s.words.slice(), smuggled, caughtBy, points };
    });
    // detective points
    for (const r of results) for (const id of r.caughtBy) {
      const d = results.find((x) => x.playerId === id);
      if (d) d.points += 1;
    }
    for (const r of results) {
      const s = this.seats.find((x) => x.id === r.playerId);
      if (s) s.score += r.points;
    }
    this.results = results;
    this.phase = "reveal";
    this.turnEndsAt = 0;
    const best = [...results].sort((a, b) => b.points - a.points)[0];
    const bs = this.seats.find((x) => x.id === best?.playerId);
    this.setEvent(bs ? `🏆 ${bs.nickname} wins the round with ${best.points} points` : "Round over");
    this.push();
    if (!this.seats.some((x) => x.connections > 0)) this.scheduleIdle();
  }

  // ───────────────────────── state ─────────────────────────

  state(): SmugglePublicState {
    const reveal = this.phase === "reveal";
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      settings: this.settings,
      players: this.seats.map((s) => ({
        id: s.id, nickname: s.nickname, connected: s.connections > 0, inGame: s.inGame, score: s.score, guessed: !!s.guesses,
      })),
      story: this.phase === "lobby" ? [] : this.story,
      order: this.order,
      turnId: this.phase === "writing" ? this.order[this.turnIdx] ?? null : null,
      lap: this.lap,
      turnEndsAt: this.turnEndsAt,
      serverNow: this.now(),
      options: this.phase === "guessing" || reveal ? this.options : [],
      results: reveal ? this.results : null,
      guesses: reveal ? Object.fromEntries(this.seats.filter((s) => s.guesses).map((s) => [s.id, s.guesses!])) : null,
      game: this.game,
      event: this.event,
    };
  }

  private setEvent(text: string) { this.event = { text, at: this.now() }; }
  private push() { if (!this.destroyed) this.ev.broadcast(this.state()); }
  private clearTimer() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
  private scheduleIdle() {
    if (this.idleTimer) return;
    this.idleTimer = setTimeout(() => this.ev.onIdle(), 15 * 60_000);
  }
  private shuffle<T>(arr: readonly T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  destroy() {
    this.destroyed = true;
    this.clearTimer();
    if (this.hostTimer) clearTimeout(this.hostTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
  }
}
