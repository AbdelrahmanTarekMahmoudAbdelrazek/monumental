import {
  OW_MAX_PLAYERS,
  checkClue,
  makeOwBoard,
  otherTeam,
  type OwAction,
  type OwColor,
  type OwPhase,
  type OwPublicState,
  type OwRole,
  type OwSettings,
  type OwTeam,
  type OwClueLog,
} from "@monumental/shared";

interface Seat {
  id: string;
  nickname: string;
  team: OwTeam | null;
  role: OwRole;
  connections: number;
}

type R = { ok: boolean; error?: string };
const ok: R = { ok: true };
const no = (error: string): R => ({ ok: false, error });

export interface OwEvents {
  broadcast: (s: OwPublicState) => void;
  /** Send the key (or null) to one player. */
  sendKey: (playerId: string, key: OwColor[] | null) => void;
  onIdle: () => void;
}

/** Server-authoritative ONE WORD table. The key is only ever sent to Spymasters. */
export class OneWordEngine {
  private seats: Seat[] = [];
  private phase: OwPhase = "lobby";
  private words: string[] = [];
  private key: OwColor[] = [];
  private revealed: boolean[] = [];
  private marks = new Map<number, Set<string>>();
  private startTeam: OwTeam = "red";
  private turn: OwTeam = "red";
  private stage: "clue" | "guess" = "clue";
  private clue: { word: string; count: number } | null = null;
  private guessesLeft = 0;
  private log: OwClueLog[] = [];
  private turnEndsAt = 0;
  private winner: OwTeam | null = null;
  private winReason: "cards" | "bomb" | null = null;
  private wins: Record<OwTeam, number> = { red: 0, blue: 0 };
  private game = 0;
  private event: OwPublicState["event"];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hostTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(
    readonly code: string,
    private hostId: string,
    private settings: OwSettings,
    private ev: OwEvents,
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
      if (this.seats.length >= OW_MAX_PLAYERS) return no(`Table is full (${OW_MAX_PLAYERS} players)`);
      // put newcomers on the smaller team as guessers
      const red = this.seats.filter((x) => x.team === "red").length;
      const blue = this.seats.filter((x) => x.team === "blue").length;
      s = { id, nickname, team: red <= blue ? "red" : "blue", role: "operative", connections: 0 };
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
    if (s.connections === 0 && this.phase === "lobby") this.seats = this.seats.filter((x) => x !== s);
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
    this.push();
  }

  /** The key for a player: only Spymasters during a game (everyone sees all colours once it's over). */
  keyFor(id: string): OwColor[] | null {
    const s = this.seats.find((x) => x.id === id);
    if (!s || s.role !== "spymaster" || this.phase === "lobby") return null;
    return this.key.slice();
  }

  // ───────────────────────── actions ─────────────────────────

  act(by: string, a: OwAction): R {
    if (this.destroyed) return no("Table closed");
    const me = this.seats.find((x) => x.id === by);
    if (!me) return no("Join the table first");
    switch (a.type) {
      case "join_team": return this.joinTeam(me, a.team, a.role);
      case "start": return this.start(by);
      case "clue": return this.giveClue(me, a.word, a.count);
      case "mark": return this.mark(me, a.index);
      case "reveal": return this.reveal(me, a.index);
      case "end_turn": return this.endTurnBy(me);
      case "settings": return this.updateSettings(by, a.settings);
      case "shuffle_teams": return this.shuffleTeams(by);
      case "to_lobby": return this.toLobby(by);
    }
    return no("Unknown action");
  }

  private joinTeam(me: Seat, team: OwTeam, role: OwRole): R {
    if (team !== "red" && team !== "blue") return no("Pick red or blue");
    if (role === "spymaster") {
      const holder = this.seats.find((x) => x.team === team && x.role === "spymaster" && x !== me);
      if (holder && holder.connections > 0) return no(`${holder.nickname} is already the ${team} Spymaster`);
      // mid-game you may only take over an empty / disconnected Spymaster seat, not swap sides
      if (this.phase === "playing" && me.role === "spymaster" && me.team !== team) return no("You can't switch sides mid-game");
      if (holder) holder.role = "operative";
    } else if (this.phase === "playing" && me.role === "spymaster") {
      return no("Spymasters can't become guessers mid-game — they've seen the key");
    }
    me.team = team;
    me.role = role;
    this.ev.sendKey(me.id, this.keyFor(me.id));
    this.push();
    return ok;
  }

  private shuffleTeams(by: string): R {
    if (by !== this.hostId) return no("Only the host can shuffle teams");
    if (this.phase === "playing") return no("Wait for the game to end");
    const ids = this.seats.map((s) => s.id).sort(() => this.rnd() - 0.5);
    ids.forEach((id, i) => {
      const s = this.seats.find((x) => x.id === id)!;
      s.team = i % 2 === 0 ? "red" : "blue";
      s.role = i < 2 ? "spymaster" : "operative";
    });
    this.seats.forEach((s) => this.ev.sendKey(s.id, null));
    this.push();
    return ok;
  }

  private updateSettings(by: string, s: Partial<OwSettings>): R {
    if (by !== this.hostId) return no("Only the host can change settings");
    if (this.phase === "playing") return no("Wait for the game to end");
    this.settings = { ...this.settings, ...s };
    this.push();
    return ok;
  }

  private toLobby(by: string): R {
    if (by !== this.hostId) return no("Only the host can do that");
    this.clearTimer();
    this.phase = "lobby";
    this.seats = this.seats.filter((x) => x.connections > 0);
    this.seats.forEach((s) => this.ev.sendKey(s.id, null));
    this.push();
    return ok;
  }

  /** Check teams are playable. */
  private readiness(): string | null {
    for (const t of ["red", "blue"] as OwTeam[]) {
      const team = this.seats.filter((x) => x.team === t && x.connections > 0);
      if (!team.some((x) => x.role === "spymaster")) return `The ${t} team needs a Spymaster`;
      if (!team.some((x) => x.role === "operative")) return `The ${t} team needs at least one guesser`;
    }
    return null;
  }

  start(by: string): R {
    if (by !== this.hostId) return no("Only the host can start");
    if (this.phase === "playing") return no("Already playing");
    this.seats = this.seats.filter((x) => x.connections > 0);
    const why = this.readiness();
    if (why) return no(why);
    this.game++;
    // teams alternate who goes first; the first team gets 9 cards
    this.startTeam = this.game === 1 ? (this.rnd() < 0.5 ? "red" : "blue") : otherTeam(this.startTeam);
    const b = makeOwBoard(this.settings.pack, this.startTeam, this.rnd);
    this.words = b.words;
    this.key = b.key;
    this.revealed = Array(25).fill(false);
    this.marks.clear();
    this.log = [];
    this.winner = null;
    this.winReason = null;
    this.phase = "playing";
    this.turn = this.startTeam;
    this.setEvent(`Game ${this.game} — ${cap(this.startTeam)} goes first and has 9 words`);
    this.beginClue();
    this.seats.forEach((s) => this.ev.sendKey(s.id, this.keyFor(s.id)));
    return ok;
  }

  private giveClue(me: Seat, raw: string, count: number): R {
    if (this.phase !== "playing" || this.stage !== "clue") return no("Not time for a clue");
    if (me.team !== this.turn || me.role !== "spymaster") return no("Only the Spymaster whose turn it is can give the clue");
    const unrevealed = this.words.filter((_, i) => !this.revealed[i]);
    const err = checkClue(raw, unrevealed);
    if (err) return no(err);
    const n = Math.round(Number(count));
    if (!Number.isFinite(n) || n < 0 || n > 9) return no("Number must be 0–9 (0 = unlimited)");
    const word = raw.trim().toUpperCase();
    this.clue = { word, count: n };
    this.guessesLeft = n === 0 ? 99 : n + 1;
    this.log.push({ team: this.turn, word, count: n, guesses: [] });
    this.stage = "guess";
    this.marks.clear();
    this.setEvent(`${me.nickname}: “${word}” ${n === 0 ? "∞" : n}`, this.turn);
    this.armTimer();
    this.push();
    return ok;
  }

  private mark(me: Seat, index: number): R {
    if (!this.canGuess(me)) return no("Wait for your team's turn");
    if (!this.validIndex(index) || this.revealed[index]) return no("Pick a hidden card");
    const set = this.marks.get(index) ?? new Set<string>();
    if (set.has(me.id)) set.delete(me.id); else set.add(me.id);
    this.marks.set(index, set);
    this.push();
    return ok;
  }

  private reveal(me: Seat, index: number): R {
    if (!this.canGuess(me)) return no("Wait for your team's turn");
    if (!this.validIndex(index) || this.revealed[index]) return no("Pick a hidden card");
    this.revealed[index] = true;
    this.marks.delete(index);
    const color = this.key[index];
    const word = this.words[index];
    this.log[this.log.length - 1]?.guesses.push({ word, color });
    const team = this.turn;
    if (color === "bomb") {
      return this.finish(otherTeam(team), "bomb", `💣 ${me.nickname} hit the bomb — ${cap(otherTeam(team))} wins!`);
    }
    // any team running out of words wins (also when the other team uncovers your last word)
    for (const t of [team, otherTeam(team)] as OwTeam[]) {
      if (this.remaining(t) === 0) return this.finish(t, "cards", `${cap(t)} found all their words!`);
    }
    if (color === team) {
      this.guessesLeft--;
      this.setEvent(`✅ ${word} — correct!`, color);
      if (this.guessesLeft <= 0) return this.switchTurn("Out of guesses");
      this.push();
      return ok;
    }
    this.setEvent(color === "neutral" ? `😐 ${word} — a bystander. Turn over.` : `❌ ${word} was ${cap(color)}'s. Turn over.`, color);
    return this.switchTurn();
  }

  private endTurnBy(me: Seat): R {
    if (!this.canGuess(me)) return no("Not your turn");
    this.setEvent(`${me.nickname} ended ${cap(this.turn)}'s turn`, this.turn);
    return this.switchTurn();
  }

  // ───────────────────────── flow ─────────────────────────

  private canGuess(me: Seat) {
    return this.phase === "playing" && this.stage === "guess" && me.team === this.turn && me.role === "operative";
  }
  private validIndex(i: number) { return Number.isInteger(i) && i >= 0 && i < 25; }
  private remaining(t: OwTeam) { return this.key.filter((c, i) => c === t && !this.revealed[i]).length; }

  private switchTurn(_why?: string): R {
    this.turn = otherTeam(this.turn);
    this.beginClue();
    return ok;
  }

  private beginClue() {
    this.stage = "clue";
    this.clue = null;
    this.guessesLeft = 0;
    this.marks.clear();
    this.armTimer();
    this.push();
  }

  private armTimer() {
    this.clearTimer();
    if (!this.settings.timerSec) { this.turnEndsAt = 0; return; }
    this.turnEndsAt = this.now() + this.settings.timerSec * 1000;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.phase !== "playing") return;
      this.setEvent(`⏰ Time's up for ${cap(this.turn)}`, this.turn);
      this.switchTurn();
    }, this.settings.timerSec * 1000);
  }

  private finish(winner: OwTeam, reason: "cards" | "bomb", text: string): R {
    this.clearTimer();
    this.phase = "finished";
    this.winner = winner;
    this.winReason = reason;
    this.wins[winner]++;
    this.turnEndsAt = 0;
    this.marks.clear();
    this.setEvent(text, winner);
    this.push();
    if (!this.seats.some((x) => x.connections > 0)) this.scheduleIdle();
    return ok;
  }

  private setEvent(text: string, color?: OwColor) {
    this.event = { text, at: this.now(), color };
  }

  state(): OwPublicState {
    const over = this.phase === "finished";
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      settings: this.settings,
      players: this.seats.map((s) => ({ id: s.id, nickname: s.nickname, team: s.team, role: s.role, connected: s.connections > 0 })),
      cards: this.phase === "lobby" ? [] : this.words.map((word, i) => ({
        word,
        color: this.revealed[i] || over ? this.key[i] : null,
        revealed: this.revealed[i],
        marks: [...(this.marks.get(i) ?? [])],
      })),
      startTeam: this.startTeam,
      turn: this.turn,
      stage: this.stage,
      clue: this.clue,
      guessesLeft: this.guessesLeft,
      remaining: this.phase === "lobby" ? { red: 0, blue: 0 } : { red: this.remaining("red"), blue: this.remaining("blue") },
      log: this.log,
      turnEndsAt: this.turnEndsAt,
      serverNow: this.now(),
      winner: this.winner,
      winReason: this.winReason,
      wins: { ...this.wins },
      game: this.game,
      event: this.event,
    };
  }

  private push() {
    if (!this.destroyed) this.ev.broadcast(this.state());
  }
  private clearTimer() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }
  private scheduleIdle() {
    if (this.idleTimer) return;
    this.idleTimer = setTimeout(() => this.ev.onIdle(), 15 * 60_000);
  }
  destroy() {
    this.destroyed = true;
    this.clearTimer();
    if (this.hostTimer) clearTimeout(this.hostTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
  }
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
