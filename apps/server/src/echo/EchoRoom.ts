import {
  COPY, ECHO, ECHO_COLORS, ECHO_RADIO, ECHO_ROOMS, GOAL, RADIO, ECHO_TAKEN, ECHO_TALK, ECHO_H, ECHO_TEENS, ECHO_W, MIMIC, MIMIC_STATES, PERK, TEEN_LOOKS, cleanLook,
  echoFree, echoPassable, echoPath, echoSpawns, echoTile, echoTileOf, echoWallsBetween, mimicOpen, mimicRevealed,
  type ClipInfo, type ClipTag, type EchoAct, type EchoEvent, type EchoGoal, type EchoLook, type EchoMeta, type EchoSnap2, type EchoState, type EchoSummary, type MimicState,
} from "@monumental/shared";

interface Member {
  id: string;
  n: number;
  name: string;
  color: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  torch: boolean;
  crouch: boolean;
  talk: boolean;
  radio: boolean;
  look: EchoLook;
  /** Clicked "Enter" (past the lobby). */
  entered: boolean;
  /** The fuse I'm carrying. */
  carry: number | null;
  at: number;
  taken: boolean;
  takenUntil: number;
  /** The friend whose voice this player heard most recently. */
  heard: { n: number; at: number } | null;
  /** When this player last asked a question ("where are you?"). */
  askedAt: number;
  /** Sam has used his one escape this match. */
  freed: boolean;
  /** Times grabbed this match; at COPY.STRIKES they are gone. */
  strikes: number;
  gone: boolean;
  /** Fuses this player put in the box. */
  installed: number;
  /** Rode the lift with the Copy and was taken in it. */
  rode: boolean;
}

interface Clip extends ClipInfo {
  at: number;
  have: Set<number>;
  used: boolean;
}

interface Mimic {
  id: number;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  state: MimicState;
  path: [number, number][];
  target: number | null;
  until: number;
  /** When it next looks for someone to hunt. */
  nextHunt: number;
  /** The player it looks like (0 = nobody yet). */
  as: number;
  crouch: boolean;
  torch: boolean;
  speakingUntil: number;
  pendingSay: { at: number; clips: string[] } | null;
  /** Torch time on it, per player. */
  lit: Map<number, number>;
  /** Busy walking out of a torch beam until then. */
  slipUntil: number;
  /** The creature shows itself, then lunges at this time. */
  windUp: number;
  followSince: number;
  /** Looking around at a spot: how, and from which direction. */
  look: { kind: "sweep" | "circle"; base: number; from: number; to: number };
  carry: number | null;
  stealTo: [number, number] | null;
  stealFrom: string;
  calledAt: number;
  /** Mirrors its target crouching, a beat late. */
  crouchAt: number;
  lastPry: number;
}

export interface EchoEvents {
  meta: (m: EchoMeta) => void;
  snap: (s: EchoSnap2) => void;
  event: (e: EchoEvent) => void;
  onIdle: () => void;
}

const T = ECHO.TILE;
const center = (t: number) => (t + 0.5) * T;
const roomName = (x: number, z: number) => ECHO_ROOMS[echoTile(echoTileOf(x), echoTileOf(z))]?.name ?? "dark";
const the = (room: string) => (/^(room|isolation)/i.test(room) ? room : `the ${room.toLowerCase()}`);

/** One ECHO HALLS room: players (who move themselves; the server checks the moves) and the Copies (moved by the server). */
export class EchoRoom {
  private members: Member[] = [];
  private nextN = 1;
  private loop: ReturnType<typeof setInterval> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private clips = new Map<string, Clip>();
  private mimics: Mimic[] = [];
  private wakeAt = 0;
  private awake = false;
  private lastStep = 0;
  private debugAt = 0;
  exposed = 0;
  takenCount = 0;
  goal!: EchoGoal;
  /** Seconds before the Copies wake (tests and local play-testing can shorten it). */
  wakeSec: number = MIMIC.WAKE_SEC;
  /** Match length in seconds (tests and local play-testing can shorten it). */
  matchSec: number = GOAL.MATCH_SEC;
  /** For the result screen. */
  private faces = new Map<number, number>();
  private voices = new Map<number, number>();
  private stolen = 0;
  private rode = false;
  private moments: { at: number; text: string; w: number }[] = [];
  private names = new Map<number, string>();
  private lifted = false;

  constructor(public readonly code: string, private hostId: string, private ev: EchoEvents, private now: () => number = Date.now, private rnd: () => number = Math.random) {
    this.goal = this.newGoal();
    this.scheduleIdle();
  }

  // ───────── players ─────────
  join(id: string, name: string): { ok: true; n: number; spawn: { x: number; z: number } } | { ok: false; error: string } {
    let m = this.members.find((x) => x.id === id);
    if (!m) {
      if (this.members.length >= ECHO.MAX_PLAYERS) return { ok: false, error: `Room is full (${ECHO.MAX_PLAYERS} players)` };
      const spawns = echoSpawns();
      const s = spawns[this.members.length % spawns.length];
      const used = new Set(this.members.map((x) => x.color));
      const color = ECHO_COLORS.find((c) => !used.has(c)) ?? ECHO_COLORS[0];
      // first teen nobody plays yet; the client sends its saved choice right after joining
      const teen = ECHO_TEENS.find((t) => !this.members.some((x) => x.look.teen === t.id))?.id ?? "maya";
      m = {
        id, n: this.nextN++, name: name.slice(0, 20) || "Player", color, x: s.x, y: 0, z: s.z, yaw: 0, pitch: 0, torch: true, crouch: false, talk: false, radio: false,
        look: { ...TEEN_LOOKS[teen] }, entered: false, carry: null, at: this.now(), taken: false, takenUntil: 0, heard: null, askedAt: 0, freed: false,
        strikes: 0, gone: false, installed: 0, rode: false,
      };
      this.members.push(m);
    } else {
      m.name = name.slice(0, 20) || m.name;
    }
    this.names.set(m.n, m.name);
    if (!this.members.some((x) => x.id === this.hostId)) this.hostId = id;
    this.armWake();
    this.clearIdle();
    this.startLoop();
    this.pushMeta();
    return { ok: true, n: m.n, spawn: { x: m.x, z: m.z } };
  }

  leave(id: string) {
    const i = this.members.findIndex((x) => x.id === id);
    if (i < 0) return;
    const gone = this.members[i];
    this.dropFuse(gone);
    this.goal.pry = this.goal.pry.filter((p) => p[0] !== gone.n);
    this.members.splice(i, 1);
    for (const [k, c] of this.clips) if (c.owner === gone.n) this.clips.delete(k); // their voice leaves with them
    for (const mm of this.mimics) {
      if (mm.target === gone.n) this.calm(mm, this.now());
      if (mm.as === gone.n) mm.as = 0; // a face nobody has any more: it changes when nobody is looking
    }
    if (this.hostId === id && this.members.length) this.hostId = this.members[0].id;
    this.pushMeta();
    if (!this.members.length) { this.stopLoop(); this.scheduleIdle(); }
  }

  /** Pick a teen and outfit. Two players can't play the same teen. */
  setLook(id: string, raw: unknown): { ok: true } | { ok: false; error: string } {
    const m = this.members.find((x) => x.id === id);
    if (!m) return { ok: false, error: "Not in this room" };
    const look = cleanLook(raw);
    if (!look) return { ok: false, error: "Invalid look" };
    const other = this.members.find((x) => x !== m && x.look.teen === look.teen);
    if (other) return { ok: false, error: `${other.name} is already playing ${ECHO_TEENS.find((t) => t.id === look.teen)!.name}` };
    m.look = look;
    this.pushMeta();
    return { ok: true };
  }

  // ───────── Channel 4: a stolen voice on everyone's walkie ─────────
  private nextRadio = 0;
  private radioCall(t: number) {
    if (!this.nextRadio) { this.nextRadio = t + RADIO.FIRST_SEC * 1000; return; }
    if (t < this.nextRadio) return;
    this.nextRadio = t + ((RADIO.GAP_MIN + this.rnd() * (RADIO.GAP_MAX - RADIO.GAP_MIN)) * 1000) / this.fury();
    const others = this.members.length - 1;
    // a piece everyone else already has, preferably a whole phrase, not used before; in the voice of a face it wears if it can
    const ok = [...this.clips.values()].filter((c) => !c.used && c.have.size >= others && c.ms >= 700 && this.members.some((m) => m.n === c.owner && !m.gone));
    if (!ok.length) return;
    const faces = new Set(this.mimics.map((mm) => mm.as));
    const worn = ok.filter((c) => faces.has(c.owner));
    const base = worn.length ? worn : ok;
    const long = base.filter((c) => c.ms >= 1300);
    const pool = long.length ? long : base;
    const c = pool[Math.floor(this.rnd() * pool.length)];
    c.used = true;
    this.voices.set(c.owner, (this.voices.get(c.owner) ?? 0) + 1);
    this.ev.event({ type: "radio", clips: [c.key], as: c.owner });
  }

  // ───────── the goal: three fuses, the fuse box, the lift ─────────
  private newGoal(): EchoGoal {
    const spots = [...GOAL.SPOTS];
    const fuses = Array.from({ length: GOAL.FUSES }, (_, id) => { const [x, y, z] = spots.splice(Math.floor(this.rnd() * spots.length), 1)[0]; return { id, x, y, z, by: null, placed: false }; });
    return { fuses, placed: 0, power: false, startedAt: 0, endsAt: 0, inLift: [], need: 0, result: null, endedAt: 0, pry: [], calledAt: 0, liftAt: 0, gone: [], summary: null };
  }
  /** Bolder the closer you are to leaving. */
  private fury() { return 1 + this.goal.placed * 0.08 + (this.goal.calledAt ? 0.15 : 0); }
  private dropFuse(m: Member) {
    if (m.carry === null) return;
    const f = this.goal.fuses[m.carry];
    m.carry = null;
    if (!f || f.placed) return;
    Object.assign(f, { by: null, x: m.x, y: 0.05, z: m.z });
    this.ev.event({ type: "drop", n: m.n, fuse: f.id });
    this.pushMeta();
  }
  private moment(t: number, text: string, w = 1) {
    if (!this.goal.startedAt) return;
    this.moments.push({ at: Math.max(0, Math.round((t - this.goal.startedAt) / 1000)), text, w });
  }
  private nameOf(n: number) { return this.names.get(n) ?? "someone"; }

  /** A player acts: goes in, pries out a fuse, uses the fuse box, calls the lift, or asks for another round. */
  act(id: string, a: EchoAct): { ok: true } | { ok: false; error: string } {
    const m = this.members.find((x) => x.id === id);
    if (!m) return { ok: false, error: "Not in this room" };
    const t = this.now(), g = this.goal;
    if (a.type === "restart") {
      if (!g.result) return { ok: false, error: "The match is still on" };
      this.restart(t);
      return { ok: true };
    }
    if (a.type === "enter") {
      m.entered = true;
      if (!g.startedAt && !g.result) { g.startedAt = t; g.endsAt = t + this.matchSec * 1000; }
      this.armWake();
      this.pushMeta();
      return { ok: true };
    }
    if (g.result) return { ok: false, error: "The match is over" };
    if (m.gone) return { ok: false, error: "You're gone" };
    if (m.taken) return { ok: false, error: "You were taken" };
    if (a.type === "pickup") {
      const f = g.fuses[a.fuse];
      if (!f || f.placed || f.by !== null) return { ok: false, error: "Not there any more" };
      if (m.carry !== null) return { ok: false, error: "You can only carry one" };
      if (Math.hypot(f.x - m.x, f.z - m.z) > GOAL.REACH + 0.3) return { ok: false, error: "Too far" };
      if (g.pry.some((p) => p[0] === m.n)) return { ok: false, error: "Already prying one out" };
      if (g.pry.some((p) => p[1] === f.id)) return { ok: false, error: "Someone is already on it" };
      g.pry.push([m.n, f.id, t + GOAL.PRY_SEC * 1000]);
      this.ev.event({ type: "pry", n: m.n, fuse: f.id });
      // the scrape carries: a Copy nearby comes to see
      for (const mm of this.mimics) {
        if ((mm.state === "wander" || mm.state === "search") && mm.carry === null && mm.as !== m.n && Math.hypot(mm.x - m.x, mm.z - m.z) < 25) this.hunt(mm, m, t);
      }
      this.pushMeta();
      return { ok: true };
    }
    if (a.type === "install") {
      if (m.carry === null) return { ok: false, error: "You have no fuse" };
      if (Math.hypot(GOAL.BOX.x - m.x, GOAL.BOX.z - m.z) > GOAL.REACH + 0.3) return { ok: false, error: "Too far from the fuse box" };
      const f = g.fuses[m.carry];
      m.carry = null;
      Object.assign(f, { by: null, placed: true, x: GOAL.BOX.x, y: 1.4, z: GOAL.BOX.z });
      g.placed++;
      m.installed++;
      this.ev.event({ type: "install", n: m.n, fuse: f.id });
      if (g.placed >= GOAL.FUSES && !g.power) { g.power = true; this.ev.event({ type: "power" }); this.moment(t, "The power came back on.", 2); }
      this.pushMeta();
      return { ok: true };
    }
    if (a.type === "call") {
      if (!g.power) return { ok: false, error: "No power yet" };
      if (g.calledAt) return { ok: false, error: "It's already coming" };
      if (Math.hypot(GOAL.LIFT.x - m.x, GOAL.LIFT.z - m.z) > GOAL.LIFT_R + 1.5) return { ok: false, error: "Too far from the lift" };
      g.calledAt = t;
      g.liftAt = t + GOAL.LIFT_CALL_SEC * 1000;
      this.ev.event({ type: "call", n: m.n, at: g.liftAt });
      this.moment(t, `${m.name} called the lift. It took ${GOAL.LIFT_CALL_SEC} seconds to come.`, 2);
      this.pushMeta();
      return { ok: true };
    }
    return { ok: false, error: "Unknown" };
  }

  private stepGoal(t: number, dt: number) {
    const g = this.goal;
    if (!g.startedAt || g.result) return;
    if (t >= g.endsAt) return this.end("lose", t);
    // everyone who went in is gone
    const inside = this.members.filter((m) => m.entered);
    if (inside.length && inside.every((m) => m.gone)) return this.end("lose", t);
    // carried fuses travel with their carrier
    for (const m of this.members) if (m.carry !== null) { const f = g.fuses[m.carry]; f.x = m.x; f.z = m.z; }
    for (const mm of this.mimics) if (mm.carry !== null) { const f = g.fuses[mm.carry]; f.x = mm.x; f.z = mm.z; }
    // prying
    if (g.pry.length) {
      const keep: typeof g.pry = [];
      let changed = false;
      for (const p of g.pry) {
        const m = this.members.find((x) => x.n === p[0]);
        const f = g.fuses[p[1]];
        if (!m || m.taken || !f || f.by !== null || f.placed || Math.hypot(f.x - m.x, f.z - m.z) > GOAL.REACH + 0.8) { changed = true; continue; }
        if (t < p[2]) { keep.push(p); continue; }
        changed = true;
        if (m.carry !== null) continue;
        f.by = m.n; m.carry = f.id;
        this.ev.event({ type: "pickup", n: m.n, fuse: f.id });
      }
      g.pry = keep;
      if (changed) this.pushMeta();
    }
    if (!g.power) return;
    if (g.liftAt && t >= g.liftAt && !this.lifted) { this.lifted = true; this.ev.event({ type: "lift" }); this.pushMeta(); }
    const living = this.members.filter((m) => m.entered && !m.taken && !m.gone);
    const inLift = living.filter((m) => Math.hypot(m.x - GOAL.LIFT.x, m.z - GOAL.LIFT.z) <= GOAL.LIFT_R).map((m) => m.n);
    const changed = inLift.join() !== g.inLift.join() || g.need !== living.length;
    g.inLift = inLift; g.need = living.length;
    this.liftHold = this.lifted && living.length > 0 && inLift.length === living.length ? this.liftHold + dt : 0;
    if (changed) this.pushMeta();
    if (this.liftHold >= GOAL.LIFT_HOLD) {
      // the doors close. Count heads: a Copy that stood with you takes one of you down with it
      const rider = this.mimics.find((mm) => !mimicRevealed(mm.state) && Math.hypot(mm.x - GOAL.LIFT.x, mm.z - GOAL.LIFT.z) <= GOAL.LIFT_R + 0.3);
      if (rider && inLift.length) {
        const victim = this.members.find((m) => m.n === inLift[Math.floor(this.rnd() * inLift.length)])!;
        this.rode = true;
        victim.rode = true;
        this.ev.event({ type: "reveal", mimic: rider.id, as: rider.as });
        this.moment(t, `The doors closed with one too many inside. "${this.nameOf(rider.as)}" was the Copy, and it took ${victim.name}.`, 3);
        this.takeFor(rider, victim, t, true);
      }
      this.end("win", t);
    }
  }
  private liftHold = 0;

  private end(result: "win" | "lose", t: number) {
    const g = this.goal;
    g.result = result;
    g.endedAt = t;
    g.pry = [];
    for (const mm of this.mimics) if (mm.carry !== null) { const f = g.fuses[mm.carry]; f.by = null; mm.carry = null; }
    this.mimics = [];
    if (result === "lose") this.moment(t, t >= g.endsAt ? "The emergency lights died. Nobody got out." : "Nobody was left.", 3);
    g.summary = this.summary(t);
    this.ev.event({ type: "end", result });
    this.pushMeta();
  }

  private summary(t: number): EchoSummary {
    const g = this.goal;
    const order = (m: Map<number, number>) => [...m.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    // keep the strongest moments, then tell them in order
    const moments = [...this.moments].sort((a, b) => b.w - a.w || a.at - b.at).slice(0, 8).sort((a, b) => a.at - b.at).map(({ at, text }) => ({ at, text }));
    return {
      players: this.members.filter((m) => m.entered).map((m) => ({
        n: m.n, name: m.name, teen: m.look.teen, strikes: m.strikes, fuses: m.installed,
        status: m.rode ? "rode" : m.gone ? "gone" : g.result === "win" ? "escaped" : "lost",
      })),
      faces: order(this.faces).map(([n, sec]) => ({ n, name: this.nameOf(n), sec: Math.round(sec) })),
      voices: order(this.voices).map(([n, times]) => ({ n, name: this.nameOf(n), times })),
      stolen: this.stolen, exposed: this.exposed, rode: this.rode, moments,
      sec: Math.round(((g.endedAt || t) - (g.startedAt || t)) / 1000),
    };
  }

  /** Another round in the same room: new fuse spots, everyone back to reception, the Copies asleep again. */
  private restart(t: number) {
    this.goal = this.newGoal();
    this.liftHold = 0; this.lifted = false;
    this.mimics = []; this.awake = false; this.exposed = 0; this.takenCount = 0; this.nextRadio = 0;
    this.faces.clear(); this.voices.clear(); this.stolen = 0; this.rode = false; this.moments = [];
    this.wakeAt = 0;
    for (const mm of this.clips.values()) mm.used = false;
    const sp = echoSpawns();
    const spawns: [number, number, number][] = [];
    this.members.forEach((m, i) => {
      const s = sp[i % sp.length];
      Object.assign(m, { x: s.x, z: s.z, y: 0, taken: false, takenUntil: 0, carry: null, freed: false, strikes: 0, gone: false, installed: 0, rode: false, at: t });
      spawns.push([m.n, s.x, s.z]);
    });
    if (this.members.some((m) => m.entered)) { this.goal.startedAt = t; this.goal.endsAt = t + this.matchSec * 1000; }
    this.armWake();
    this.ev.event({ type: "restart", spawns });
    this.pushMeta();
  }

  numberOf(id: string) { return this.members.find((x) => x.id === id)?.n; }
  idOf(n: number) { return this.members.find((x) => x.n === n)?.id; }

  /** A client's own position. Accepted when it is a believable move; otherwise ignored. */
  state(id: string, s: EchoState): boolean {
    const m = this.members.find((x) => x.id === id);
    if (!m || m.taken) return false;
    const t = this.now();
    const dt = Math.min(1, Math.max(0.001, (t - m.at) / 1000));
    const dist = Math.hypot(s.x - m.x, s.z - m.z);
    m.yaw = s.yaw;
    m.pitch = Math.max(-1.6, Math.min(1.6, s.pitch));
    m.torch = s.torch;
    m.crouch = s.crouch;
    m.talk = !!s.talk;
    m.radio = !!s.radio;
    if (dist > ECHO.SPRINT * dt * 1.5 + 1 || !echoFree(s.x, s.z) || !echoPassable(m.x, m.z, s.x, s.z)) return false;
    m.x = s.x;
    m.y = Math.max(-0.5, Math.min(1, s.y));
    m.z = s.z;
    m.at = t;
    return true;
  }

  // ───────── voice pieces (labels only) ─────────
  /** The owner's device cut a new piece of their speech. */
  clip(id: string, pieceId: number, ms: number, tags: ClipTag[]) {
    const m = this.members.find((x) => x.id === id);
    if (!m) return;
    const key = `${m.n}:${pieceId}`;
    if (this.clips.has(key)) return;
    this.clips.set(key, { key, owner: m.n, ms, tags, at: this.now(), have: new Set([m.n]), used: false });
    if (this.clips.size > 400) { const oldest = [...this.clips.values()].sort((a, b) => a.at - b.at)[0]; this.clips.delete(oldest.key); }
    for (const o of this.members) {
      if (o.n === m.n) continue;
      if (Math.hypot(o.x - m.x, o.z - m.z) <= ECHO.VOICE_RANGE) o.heard = { n: m.n, at: this.now() };
    }
    if (tags.includes("question")) m.askedAt = this.now();
  }

  /** Speech-to-text finished for a piece: better labels. */
  tag(id: string, pieceId: number, tags: ClipTag[]) {
    const m = this.members.find((x) => x.id === id);
    const c = m && this.clips.get(`${m.n}:${pieceId}`);
    if (!m || !c) return;
    c.tags = [...new Set([...c.tags, ...tags])];
    if (tags.includes("question")) m.askedAt = this.now();
  }

  /** A player's device received a piece from its owner. */
  have(id: string, key: string) {
    const m = this.members.find((x) => x.id === id);
    const c = this.clips.get(key);
    if (m && c) c.have.add(m.n);
  }

  // ───────── the loop ─────────
  step() {
    const t = this.now();
    const dt = this.lastStep ? Math.min(0.25, (t - this.lastStep) / 1000) : ECHO.SNAP_MS / 1000;
    this.lastStep = t;
    // grabbed players come back to the safe room (unless they're gone)
    for (const m of this.members) {
      if (m.taken && !m.gone && t >= m.takenUntil) {
        const s = echoSpawns()[m.n % 2];
        Object.assign(m, { taken: false, x: s.x, z: s.z, y: 0, at: t });
        this.ev.event({ type: "back", n: m.n, x: s.x, z: s.z });
      }
    }
    this.wake(t);
    if (!this.goal.result) {
      for (const mm of this.mimics) {
        this.think(mm, dt, t);
        if (mm.as && !mimicRevealed(mm.state)) this.faces.set(mm.as, (this.faces.get(mm.as) ?? 0) + dt);
      }
    }
    if (this.awake && !this.goal.result) this.radioCall(t);
    this.stepGoal(t, dt);
    if (process.env.ECHO_DEBUG && t - this.debugAt > 3000) {
      this.debugAt = t;
      // eslint-disable-next-line no-console
      console.log(`[echo ${this.code}]`, this.mimics.map((m) => `${m.state} as=${m.as} t=${m.target} @${m.x.toFixed(0)},${m.z.toFixed(0)}`).join(" | "), "| players", this.members.map((m) => `${m.n}@${m.x.toFixed(0)},${m.z.toFixed(0)} lone=${this.loneliness(m).toFixed(0)}${m.taken ? " TAKEN" : ""}${m.gone ? " GONE" : ""}`).join(" "), "| clips", this.clips.size);
    }
    this.ev.snap(this.snapshot());
  }

  /** The night starts counting once two people are here and the match has begun. */
  private armWake() {
    if (this.wakeAt || this.members.length < 2 || !this.goal.startedAt) return;
    this.wakeAt = this.now() + this.wakeSec * 1000;
  }

  private wake(t: number) {
    if (this.awake || !this.wakeAt || t < this.wakeAt) return;
    this.awake = true;
    const count = this.members.length >= 3 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const [tx, tz] = this.farTile(12);
      const mm: Mimic = {
        id: i + 1, x: center(tx), z: center(tz), yaw: 0, pitch: 0, state: "wander", path: [], target: null, until: 0, nextHunt: t + 8_000 + i * 12_000,
        as: 0, crouch: false, torch: true, speakingUntil: 0, pendingSay: null, lit: new Map(), slipUntil: 0, windUp: 0, followSince: 0,
        look: { kind: "sweep", base: 0, from: t, to: t }, carry: null, stealTo: null, stealFrom: "", calledAt: 0, crouchAt: 0, lastPry: 0,
      };
      this.mimics.push(mm);
      this.disguise(mm, null);
    }
    this.ev.event({ type: "wake" });
    this.pushMeta();
  }

  // ───────── who can see what ─────────
  /** Players still in the match (not grabbed right now, not gone). */
  private alive() { return this.members.filter((m) => m.entered && !m.taken && !m.gone); }
  private los(ax: number, az: number, bx: number, bz: number, range: number) {
    return Math.hypot(ax - bx, az - bz) < range && echoWallsBetween(ax, az, bx, bz) === 0;
  }
  /** Anyone (but `except`) could see this spot. */
  private watched(x: number, z: number, range = 20, except?: Member) {
    return this.alive().some((m) => m !== except && this.los(m.x, m.z, x, z, range));
  }
  /** How far `p` is looking away from (x, z): 0 = straight at it, π = back turned. */
  private lookAway(p: Member, x: number, z: number) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < 0.01) return 0;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    return Math.acos(Math.max(-1, Math.min(1, ((x - p.x) * fx + (z - p.z) * fz) / d)));
  }
  /** How alone a player is: distance to the nearest other living player (walls count as extra distance). */
  private loneliness(m: Member) {
    let best = 99;
    for (const o of this.alive()) {
      if (o === m) continue;
      best = Math.min(best, Math.hypot(o.x - m.x, o.z - m.z) + echoWallsBetween(m.x, m.z, o.x, o.z) * 6);
    }
    return best;
  }

  // ───────── the Copy ─────────
  /**
   * Put on a face. Never the face of the one it hunts; the friend furthest from them, so the two are rarely seen together.
   * With nobody else alive it wears a friend who is already gone. Only changes face where nobody can see it.
   */
  private disguise(mm: Mimic, target: Member | null) {
    const inside = this.members.filter((m) => m.entered || !this.goal.startedAt);
    const others = inside.filter((m) => m !== target && !this.mimics.some((o) => o !== mm && o.as === m.n));
    const living = others.filter((m) => !m.taken && !m.gone);
    const pool = living.length ? living : others.length ? others : inside;
    if (!pool.length) return;
    const ref = target ?? mm;
    const best = [...pool].sort((a, b) => Math.hypot(b.x - ref.x, b.z - ref.z) - Math.hypot(a.x - ref.x, a.z - ref.z))[0];
    mm.as = best.n;
  }
  private canChangeFace(mm: Mimic) { return !this.watched(mm.x, mm.z, 24); }

  private hunt(mm: Mimic, prey: Member, t: number) {
    if (prey.n === mm.as) {
      if (!this.canChangeFace(mm)) return;
      this.disguise(mm, prey);
      if (prey.n === mm.as) return;
    }
    mm.state = "stalk";
    mm.target = prey.n;
    mm.until = t + 60_000;
    mm.path = [];
    mm.crouch = false;
  }

  /** Back to wandering like a player, and wait a while before the next hunt. */
  private calm(mm: Mimic, t: number) {
    mm.state = "wander";
    mm.target = null;
    mm.path = [];
    mm.pendingSay = null;
    mm.crouch = false;
    mm.nextHunt = Math.max(mm.nextHunt, t + ((MIMIC.LURE_GAP_MIN + this.rnd() * (MIMIC.LURE_GAP_MAX - MIMIC.LURE_GAP_MIN)) * 1000) / this.fury());
  }

  /** It shows what it is and lunges. */
  private reveal(mm: Mimic, target: Member, t: number) {
    this.dropCopyFuse(mm);
    mm.state = "chase";
    mm.target = target.n;
    mm.windUp = t + COPY.REVEAL_SEC * 1000;
    mm.until = mm.windUp + COPY.LUNGE_SEC * 1000;
    mm.path = [];
    mm.pendingSay = null;
    mm.crouch = false;
    mm.lit.clear();
    this.ev.event({ type: "reveal", mimic: mm.id, as: mm.as });
  }

  private dropCopyFuse(mm: Mimic) {
    if (mm.carry === null) return;
    const f = this.goal.fuses[mm.carry];
    mm.carry = null;
    mm.stealTo = null;
    if (f && !f.placed) Object.assign(f, { by: null, x: mm.x, y: 0.05, z: mm.z });
    this.pushMeta();
  }

  private say(mm: Mimic, t: number, clips: string[], delayMs: number) {
    if (!clips.length) return;
    mm.pendingSay = { at: t + delayMs, clips };
  }

  private think(mm: Mimic, dt: number, t: number) {
    if (mm.pendingSay && t >= mm.pendingSay.at) {
      const ms = mm.pendingSay.clips.reduce((a, k) => a + (this.clips.get(k)?.ms ?? 0) + 150, 0);
      mm.speakingUntil = t + ms;
      for (const k of mm.pendingSay.clips) { const c = this.clips.get(k); if (c) this.voices.set(c.owner, (this.voices.get(c.owner) ?? 0) + 1); }
      this.ev.event({ type: "say", mimic: mm.id, clips: mm.pendingSay.clips });
      mm.pendingSay = null;
    }
    if (mm.state !== "flee" && this.torchCheck(mm, dt, t)) return;
    // a face nobody plays any more: swap it when unseen
    if (!mimicRevealed(mm.state) && (!mm.as || !this.members.some((m) => m.n === mm.as)) && this.canChangeFace(mm)) this.disguise(mm, this.members.find((m) => m.n === mm.target) ?? null);
    // the lift is coming: every Copy goes to stand with the group
    if (this.goal.calledAt && (mm.state === "wander" || mm.state === "search")) { mm.state = "lift"; mm.path = []; mm.target = null; this.dropCopyFuse(mm); }

    const target = this.members.find((m) => m.n === mm.target && !m.taken && !m.gone);
    const crouchTo = (c: boolean) => { if (mm.crouch !== c && t >= mm.crouchAt) { mm.crouch = c; mm.crouchAt = t + 800; } };

    switch (mm.state) {
      case "wander": {
        mm.pitch = 0;
        crouchTo(false);
        if (t >= mm.nextHunt && mm.carry === null) {
          const prey = this.alive().filter((m) => m.n !== mm.as && !this.mimics.some((o) => o !== mm && o.target === m.n) && this.loneliness(m) > 7).sort((a, b) => this.loneliness(b) - this.loneliness(a))[0];
          if (prey) { this.hunt(mm, prey, t); if ((mm.state as MimicState) === "stalk") break; }
          mm.nextHunt = t + 5000;
        }
        if (!mm.path.length) {
          if (mm.stealTo) {
            // arrived where it hides the stolen fuse
            if (mm.carry !== null && !this.watched(mm.x, mm.z, 14)) {
              const f = this.goal.fuses[mm.carry];
              const spot = GOAL.SPOTS.find(([x, , z]) => echoTileOf(x) === mm.stealTo![0] && echoTileOf(z) === mm.stealTo![1]);
              const from = mm.stealFrom;
              Object.assign(f, { by: null, x: spot ? spot[0] : mm.x, y: spot ? spot[1] : 0.05, z: spot ? spot[2] : mm.z });
              mm.carry = null;
              this.stolen++;
              this.moment(t, `The Copy, wearing ${this.nameOf(mm.as)}'s face, carried a fuse out of ${the(from)} and hid it in ${the(roomName(f.x, f.z))}.`, 2);
              this.pushMeta();
            } else this.dropCopyFuse(mm);
            mm.stealTo = null;
          } else this.startSearch(mm, t);
          break;
        }
        // hurries only where nobody can see it
        this.walk(mm, this.watched(mm.x, mm.z, 22) ? COPY.WALK : COPY.HURRY, dt);
        break;
      }
      case "search": {
        // a player looking for fuses: looks around, crouches to check under things, turns in a slow circle
        const k = Math.min(1, (t - mm.look.from) / Math.max(1, mm.look.to - mm.look.from));
        mm.yaw = mm.look.kind === "circle" ? mm.look.base + k * Math.PI * 2 : mm.look.base + Math.sin(k * Math.PI * 2) * 0.9;
        mm.pitch = mm.crouch ? -0.35 : -0.15;
        // a loose fuse here and nobody watching: it takes it to hide somewhere else
        if (mm.carry === null && this.stolen < COPY.STEALS && this.goal.startedAt && k > 0.5) {
          const f = this.goal.fuses.find((x) => !x.placed && x.by === null && !this.goal.pry.some((p) => p[1] === x.id) && Math.hypot(x.x - mm.x, x.z - mm.z) < 2.2);
          if (f && !this.watched(mm.x, mm.z, 18)) {
            f.by = -mm.id; mm.carry = f.id;
            mm.stealFrom = roomName(f.x, f.z);
            // somewhere in another room, away from the fuse box
            const far = GOAL.SPOTS.filter(([x, , z]) => Math.hypot(x - f.x, z - f.z) > 12 && roomName(x, z) !== mm.stealFrom && Math.hypot(x - GOAL.BOX.x, z - GOAL.BOX.z) > 12 && !this.goal.fuses.some((o) => o !== f && Math.hypot(o.x - x, o.z - z) < 1));
            const [sx, , sz] = far.length ? far[Math.floor(this.rnd() * far.length)] : GOAL.SPOTS[0];
            mm.stealTo = [echoTileOf(sx), echoTileOf(sz)];
            mm.path = echoPath(this.tileOf(mm), mm.stealTo);
            mm.state = "wander";
            crouchTo(false);
            this.pushMeta();
            break;
          }
        }
        if (t >= mm.look.to) { mm.state = "wander"; mm.path = []; crouchTo(false); }
        break;
      }
      case "stalk": {
        if (!target || t > mm.until) { this.calm(mm, t); break; }
        const d = Math.hypot(target.x - mm.x, target.z - mm.z);
        const seen = this.los(target.x, target.z, mm.x, mm.z, 30);
        // close and in sight: walk up like a friend would
        if (d < 8 && seen) { mm.state = "follow"; mm.followSince = t; mm.path = []; break; }
        // calls out in the stolen voice from around the corner
        if (!seen && d < 13 && !mm.pendingSay && t > mm.speakingUntil + 9000) this.say(mm, t, this.pick(target, mm.as, "call"), 300);
        const goal: [number, number] = [echoTileOf(target.x), echoTileOf(target.z)];
        const last = mm.path[mm.path.length - 1];
        if (!last || last[0] !== goal[0] || last[1] !== goal[1]) mm.path = echoPath(this.tileOf(mm), goal);
        this.walk(mm, !this.watched(mm.x, mm.z, 22) && d > 12 ? COPY.HURRY * this.fury() : COPY.WALK, dt);
        break;
      }
      case "follow": {
        if (!target) { this.calm(mm, t); break; }
        const d = Math.hypot(target.x - mm.x, target.z - mm.z);
        if (d > 11 || !this.los(target.x, target.z, mm.x, mm.z, 40)) { mm.state = "stalk"; mm.path = []; break; }
        // the friend it is pretending to be turns up: it slips away before anyone sees two of them
        const real = this.alive().find((m) => m.n === mm.as);
        if (real && this.los(real.x, real.z, mm.x, mm.z, 16)) { this.calm(mm, t); mm.path = echoPath(this.tileOf(mm), this.farTile(10)); break; }
        if (t - mm.followSince > COPY.PATIENCE_SEC * 1000) { this.calm(mm, t); mm.path = echoPath(this.tileOf(mm), this.farTile(10)); break; }
        // their back is turned and nobody else is watching: it closes in, quietly
        const away = this.lookAway(target, mm.x, mm.z);
        const witness = this.alive().some((m) => m !== target && this.los(m.x, m.z, mm.x, mm.z, 14));
        const ready = t - mm.followSince > COPY.FOLLOW_MIN_SEC * 1000 && !witness;
        if (ready && away > 1.75) {
          if (d < 3.2) { this.reveal(mm, target, t); break; }
          mm.path = [];
          this.stepTo(mm, target.x, target.z, COPY.WALK, dt);
          crouchTo(target.crouch);
          break;
        }
        // tags along: close the gap, stop at arm's length, copy their crouch a beat late
        if (d > COPY.FOLLOW_MAX) {
          const goal: [number, number] = [echoTileOf(target.x), echoTileOf(target.z)];
          if (!mm.path.length) mm.path = echoPath(this.tileOf(mm), goal);
          if (this.los(mm.x, mm.z, target.x, target.z, 9)) { mm.path = []; this.stepTo(mm, target.x, target.z, COPY.WALK, dt); } else this.walk(mm, COPY.WALK, dt);
        } else if (d < COPY.FOLLOW_MIN) {
          this.stepTo(mm, mm.x - (target.x - mm.x), mm.z - (target.z - mm.z), 0.8, dt);
        }
        crouchTo(target.crouch);
        // mostly watches them; now and then looks around the room like anyone would
        const toward = Math.atan2(-(target.x - mm.x), -(target.z - mm.z));
        const glance = Math.sin(t / 1700) > 0.7 ? Math.sin(t / 900) * 1.2 : 0;
        mm.yaw = toward + glance;
        mm.pitch = 0;
        // they asked something: a late answer in the friend's voice
        if (target.askedAt > t - 1500 && !mm.pendingSay && t > mm.speakingUntil + 1500) {
          this.say(mm, t, this.pick(target, mm.as, "answer"), (MIMIC.REPLY_MIN + this.rnd() * (MIMIC.REPLY_MAX - MIMIC.REPLY_MIN)) * 1000);
          target.askedAt = 0;
        }
        break;
      }
      case "lift": {
        // stands with the group at the lift, one of them
        const spot = { x: GOAL.LIFT.x + Math.cos(mm.id * 2.1) * 1.2, z: GOAL.LIFT.z + Math.sin(mm.id * 2.1) * 1.0 };
        const d = Math.hypot(spot.x - mm.x, spot.z - mm.z);
        if (d > 3) {
          const goal: [number, number] = [echoTileOf(spot.x), echoTileOf(spot.z)];
          const last = mm.path[mm.path.length - 1];
          if (!last || last[0] !== goal[0] || last[1] !== goal[1]) mm.path = echoPath(this.tileOf(mm), goal);
          this.walk(mm, this.watched(mm.x, mm.z, 22) ? COPY.WALK : COPY.HURRY * this.fury(), dt);
        } else if (d > 0.3) this.stepTo(mm, spot.x, spot.z, COPY.WALK * 0.6, dt);
        else {
          // looks at whoever is nearest, as people waiting for a lift do
          const near = this.alive().sort((a, b) => Math.hypot(a.x - mm.x, a.z - mm.z) - Math.hypot(b.x - mm.x, b.z - mm.z))[0];
          if (near) mm.yaw = Math.atan2(-(near.x - mm.x), -(near.z - mm.z)) + Math.sin(t / 1300) * 0.5;
        }
        // someone wanders off alone while waiting: easy prey
        const lone = this.alive().find((m) => m.n !== mm.as && this.loneliness(m) > 10 && Math.hypot(m.x - mm.x, m.z - mm.z) < 6 && this.lookAway(m, mm.x, mm.z) > 1.75);
        if (lone && !this.alive().some((m) => m !== lone && this.los(m.x, m.z, mm.x, mm.z, 14))) this.reveal(mm, lone, t);
        break;
      }
      case "chase": {
        if (!target) { this.flee(mm, t, 8); break; }
        const d = Math.hypot(target.x - mm.x, target.z - mm.z);
        if (t < mm.windUp) { mm.yaw = Math.atan2(-(target.x - mm.x), -(target.z - mm.z)); break; }
        if (d < MIMIC.CATCH) { this.take(mm, target, t); break; }
        if (t > mm.until || d > 20) { this.flee(mm, t, 8); break; }
        if (this.los(mm.x, mm.z, target.x, target.z, 6)) { mm.path = []; this.stepTo(mm, target.x, target.z, COPY.LUNGE * this.fury(), dt); }
        else {
          const goal: [number, number] = [echoTileOf(target.x), echoTileOf(target.z)];
          const last = mm.path[mm.path.length - 1];
          if (!last || last[0] !== goal[0] || last[1] !== goal[1]) mm.path = echoPath(this.tileOf(mm), goal);
          this.walk(mm, COPY.LUNGE * this.fury(), dt);
        }
        break;
      }
      case "flee": {
        if (!mm.path.length) mm.path = echoPath(this.tileOf(mm), this.farTile(12));
        this.walk(mm, MIMIC.FLEE, dt);
        // once out of everyone's sight it puts a face back on
        if (t >= mm.until && this.canChangeFace(mm)) { this.disguise(mm, null); this.calm(mm, t); }
        break;
      }
      default:
        break;
    }
  }

  private flee(mm: Mimic, t: number, sec: number) {
    mm.state = "flee";
    mm.target = null;
    mm.pendingSay = null;
    mm.crouch = false;
    mm.until = t + sec * 1000;
    mm.path = echoPath(this.tileOf(mm), this.farTile(12));
    mm.lit.clear();
  }

  private startSearch(mm: Mimic, t: number) {
    // where it goes next: usually a place a fuse could be, sometimes just another room
    const spots = GOAL.SPOTS.filter(([x, , z]) => { const d = Math.hypot(x - mm.x, z - mm.z); return d > 6 && d < 34; });
    let dest: [number, number];
    if (spots.length && this.rnd() < 0.65) { const [x, , z] = spots[Math.floor(this.rnd() * spots.length)]; dest = [echoTileOf(x), echoTileOf(z)]; }
    else dest = this.farTile(6);
    const here = GOAL.SPOTS.find(([x, , z]) => Math.hypot(x - mm.x, z - mm.z) < 2.5);
    // first look around where it stands (if it just arrived somewhere)
    if (mm.look.to < t - 1000) {
      const dur = 2500 + this.rnd() * 3000;
      const circle = this.rnd() < 0.3;
      mm.look = { kind: circle ? "circle" : "sweep", base: mm.yaw, from: t, to: t + dur };
      mm.crouch = !!here && here[1] < 0.6 ? true : this.rnd() < 0.25;
      mm.crouchAt = t + 800;
      mm.state = "search";
      mm.path = echoPath(this.tileOf(mm), dest);
      return;
    }
    mm.path = echoPath(this.tileOf(mm), dest);
  }

  private take(mm: Mimic, target: Member, t: number) {
    // Sam's bolt cutters: once per match he cuts himself loose and the monster reels back
    if (target.look.teen === "sam" && !target.freed) {
      target.freed = true;
      this.ev.event({ type: "free", n: target.n, mimic: mm.id });
      this.moment(t, `${target.name} cut free of the Copy with the bolt cutters in ${the(roomName(target.x, target.z))}.`, 2);
      this.flee(mm, t, PERK.SAM_STUN_SEC);
      mm.nextHunt = t + PERK.SAM_STUN_SEC * 1000 + 8000;
      this.pushMeta();
      return;
    }
    this.takeFor(mm, target, t, false);
    this.flee(mm, t, 10);
    mm.nextHunt = t + 25_000;
    this.pushMeta();
  }

  /** `target` is grabbed. A second grab (or the lift) and they're gone for good. */
  private takeFor(mm: Mimic, target: Member, t: number, forGood: boolean) {
    target.strikes++;
    target.taken = true;
    const gone = forGood || target.strikes >= COPY.STRIKES;
    target.takenUntil = gone ? Infinity : t + COPY.BACK_SEC * 1000;
    if (gone) { target.gone = true; this.goal.gone = [...new Set([...this.goal.gone, target.n])]; }
    this.takenCount++;
    this.dropFuse(target);
    this.goal.pry = this.goal.pry.filter((p) => p[0] !== target.n);
    this.ev.event({ type: "taken", n: target.n, mimic: mm.id, lure: null, gone });
    if (!forGood) {
      const face = mm.as ? `"${this.nameOf(mm.as)}"` : "something in the dark";
      this.moment(t, `${target.name} trusted ${face} in ${the(roomName(target.x, target.z))}. It wasn't ${mm.as ? this.nameOf(mm.as) : "anyone"}.${gone ? ` ${target.name} didn't come back.` : ""}`, gone ? 3 : 2);
    }
  }

  /** Torches: a disguised Copy notices the light and walks off (or attacks if it can); held long enough, the disguise fails. */
  private torchCheck(mm: Mimic, dt: number, t: number): boolean {
    const revealed = mimicRevealed(mm.state);
    for (const m of this.alive()) {
      const dx = mm.x - m.x, dz = mm.z - m.z;
      const d = Math.hypot(dx, dz);
      const nora = m.look.teen === "nora";
      let lit = false;
      if (m.torch && d < (revealed ? COPY.REVEALED_RANGE : COPY.EXPOSE_RANGE) + (nora ? PERK.NORA_RANGE : 0) && d > 0.01) {
        const fx = -Math.sin(m.yaw), fz = -Math.cos(m.yaw);
        lit = (fx * dx + fz * dz) / d > Math.cos(MIMIC.BEAM) && echoWallsBetween(m.x, m.z, mm.x, mm.z) === 0;
      }
      const v = Math.max(0, (mm.lit.get(m.n) ?? 0) + (lit ? dt * (nora ? PERK.NORA_EXPOSE : 1) : -dt * 2));
      mm.lit.set(m.n, v);
      if (!lit) continue;
      if (v >= (revealed ? COPY.EXPOSE_REVEALED : COPY.EXPOSE_SEC)) {
        this.exposed++;
        this.ev.event({ type: "exposed", mimic: mm.id, by: m.n });
        this.moment(t, mm.as && !revealed ? `${m.name} held the torch on "${this.nameOf(mm.as)}" in ${the(roomName(mm.x, mm.z))} until its face slid off. The Copy ran.` : `${m.name}'s torch drove the creature back in ${the(roomName(mm.x, mm.z))}.`, 2);
        if (!revealed) this.ev.event({ type: "reveal", mimic: mm.id, as: mm.as });
        this.dropCopyFuse(mm);
        this.flee(mm, t, COPY.FLEE_SEC);
        mm.nextHunt = mm.until + 8000;
        this.pushMeta();
        return true;
      }
      // a disguised Copy feels the light on it: alone with you and close, it attacks; otherwise it walks out of the beam
      if (!revealed && v >= COPY.NOTICE_SEC && t > mm.slipUntil) {
        const witness = this.alive().some((o) => o !== m && this.los(o.x, o.z, mm.x, mm.z, 14));
        if (d < 5 && !witness && m.n !== mm.as) { this.reveal(mm, m, t); return true; }
        mm.slipUntil = t + 3500;
        if (mm.state !== "lift") {
          if (mm.state === "follow" || mm.state === "stalk") { mm.state = "wander"; mm.target = null; mm.nextHunt = t + 10_000; }
          if (mm.state === "search") mm.state = "wander";
          mm.path = echoPath(this.tileOf(mm), this.awayFrom(m));
        }
      }
    }
    return false;
  }

  /** A tile out of `m`'s sight, a short walk away. */
  private awayFrom(m: Member): [number, number] {
    let best: [number, number] = this.farTile(6), score = -Infinity;
    for (let z = 0; z < ECHO_H; z++) for (let x = 0; x < ECHO_W; x++) {
      if (!mimicOpen(x, z)) continue;
      const cx = center(x), cz = center(z);
      const d = Math.hypot(cx - m.x, cz - m.z);
      if (d < 6 || d > 20 || this.los(m.x, m.z, cx, cz, 30)) continue;
      const s = -Math.abs(d - 10) + this.rnd();
      if (s > score) { score = s; best = [x, z]; }
    }
    return best;
  }

  /**
   * Which voice pieces to play at `target`, in `owner`'s voice (the face it wears). Only pieces the target's device holds, never reused.
   * call: their name + "come here" / a call / "found it"; answer: "here" / a short phrase.
   */
  private pick(target: Member, owner: number, kind: "call" | "answer", commit = true): string[] {
    const pool = [...this.clips.values()].filter((c) => !c.used && c.owner === owner && c.owner !== target.n && c.have.has(target.n));
    if (!pool.length) return [];
    const has = (tag: ClipTag) => pool.filter((c) => c.tags.includes(tag));
    // the best "plain" pieces sound like a full short phrase: the closer to 1.5 s the better
    const short = pool.filter((c) => c.ms >= 700).sort((a, b) => Math.abs(a.ms - 1500) - Math.abs(b.ms - 1500));
    let chosen: Clip[] = [];
    if (kind === "answer") chosen = [has("here")[0] ?? has("call")[0] ?? short[0]].filter(Boolean) as Clip[];
    else {
      const name = has(`name:${target.n}`)[0];
      const call = has("call").find((c) => c !== name);
      if (name && call) chosen = [name, call];
      // tiny fragments ("ah", a breath) give it away: better to stay quiet than play one
      else chosen = [call ?? has("found")[0] ?? short[Math.floor(this.rnd() * Math.min(3, short.length))]].filter(Boolean) as Clip[];
    }
    if (!chosen.length) return [];
    if (commit) chosen.forEach((c) => { c.used = true; });
    return chosen.map((c) => c.key);
  }

  // ───────── moving ─────────
  private tileOf(mm: Mimic): [number, number] { return [echoTileOf(mm.x), echoTileOf(mm.z)]; }

  private walk(mm: Mimic, speed: number, dt: number) {
    let left = (mm.crouch ? Math.min(speed, ECHO.CROUCH) : speed) * dt;
    while (left > 0 && mm.path.length) {
      const [tx, tz] = mm.path[0];
      const gx = center(tx), gz = center(tz);
      const d = Math.hypot(gx - mm.x, gz - mm.z);
      if (d <= left) { mm.x = gx; mm.z = gz; left -= d; mm.path.shift(); continue; }
      this.stepTo(mm, gx, gz, left / dt, dt);
      left = 0;
    }
  }

  private stepTo(mm: Mimic, x: number, z: number, speed: number, dt: number) {
    const dx = x - mm.x, dz = z - mm.z, d = Math.hypot(dx, dz);
    if (d < 1e-4) return;
    const s = Math.min(d, speed * dt);
    const nx = mm.x + (dx / d) * s, nz = mm.z + (dz / d) * s;
    if (!echoPassable(mm.x, mm.z, nx, nz)) return;
    mm.x = nx;
    mm.z = nz;
    mm.yaw = Math.atan2(-dx, -dz);
  }

  /** An open tile far from everyone (at least `min` m if possible). */
  private farTile(min = 0): [number, number] {
    const opts: { t: [number, number]; d: number }[] = [];
    for (let z = 0; z < ECHO_H; z++) for (let x = 0; x < ECHO_W; x++) {
      if (!mimicOpen(x, z)) continue;
      const d = Math.min(99, ...this.members.map((m) => Math.hypot(center(x) - m.x, center(z) - m.z)));
      const seen = this.members.some((m) => echoWallsBetween(m.x, m.z, center(x), center(z)) === 0 && Math.hypot(center(x) - m.x, center(z) - m.z) < 15);
      opts.push({ t: [x, z], d: seen ? d * 0.3 : d });
    }
    const far = opts.filter((o) => o.d >= Math.max(min, 1));
    const pool = far.length ? far : opts.sort((a, b) => b.d - a.d).slice(0, 5);
    return pool[Math.floor(this.rnd() * pool.length)].t;
  }

  // ───────── state out ─────────
  meta(): EchoMeta {
    return {
      code: this.code, hostId: this.hostId, serverNow: this.now(),
      players: this.members.map((m) => ({ id: m.id, n: m.n, name: m.name, color: m.color, look: m.look })),
      night: { awake: this.awake, wakeAt: this.wakeAt, exposed: this.exposed, taken: this.takenCount },
      goal: this.goal,
    };
  }

  snapshot(): EchoSnap2 {
    const t = this.now();
    return {
      t,
      p: this.members.map((m) => [m.n, Math.round(m.x * 100), Math.round(m.y * 100), Math.round(m.z * 100), Math.round(m.yaw * 1000), Math.round(m.pitch * 1000), (m.torch ? 1 : 0) | (m.crouch ? 2 : 0) | (m.taken ? ECHO_TAKEN : 0) | (m.talk && !m.taken ? ECHO_TALK : 0) | (m.radio && !m.taken ? ECHO_RADIO : 0)]),
      m: this.mimics.map((mm) => [mm.id, Math.round(mm.x * 100), Math.round(mm.z * 100), Math.round(mm.yaw * 1000), MIMIC_STATES.indexOf(mm.state), t < mm.speakingUntil ? 1 : 0, mm.as, (mm.torch ? 1 : 0) | (mm.crouch ? 2 : 0), Math.round(mm.pitch * 1000)]),
    };
  }

  /** Tests / debugging. */
  debug() { return { members: this.members, mimics: this.mimics, clips: this.clips }; }
  /** Local play-testing (ECHO_DEBUG only): put the Copy somewhere, in some state. */
  debugCmd(raw: unknown) {
    const c = (raw as { copy?: Record<string, unknown> } | null)?.copy;
    const mm = this.mimics[0];
    if (!c || !mm) return;
    const t = this.now();
    if (typeof c.x === "number" && typeof c.z === "number") { mm.x = c.x; mm.z = c.z; mm.path = []; }
    if (typeof c.as === "number") mm.as = c.as;
    if (c.target === null || typeof c.target === "number") mm.target = c.target as number | null;
    if (typeof c.state === "string" && (MIMIC_STATES as string[]).includes(c.state)) {
      mm.state = c.state as MimicState;
      mm.followSince = t - 10_000;
      mm.until = t + 60_000;
      mm.nextHunt = t + 120_000;
      mm.look = { kind: "sweep", base: mm.yaw, from: t, to: t + 60_000 };
    }
  }

  get size() { return this.members.length; }

  private pushMeta() { if (!this.destroyed) this.ev.meta(this.meta()); }
  private startLoop() {
    if (this.loop || this.destroyed) return;
    this.lastStep = 0;
    this.loop = setInterval(() => { if (!this.destroyed) this.step(); }, ECHO.SNAP_MS);
  }
  private stopLoop() { if (this.loop) { clearInterval(this.loop); this.loop = null; } }
  private scheduleIdle() {
    if (this.idleTimer || this.destroyed) return;
    this.idleTimer = setTimeout(() => this.ev.onIdle(), 10 * 60_000);
  }
  private clearIdle() { if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; } }

  destroy() {
    this.destroyed = true;
    this.stopLoop();
    this.clearIdle();
  }
}
