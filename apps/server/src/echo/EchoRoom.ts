import {
  ECHO, ECHO_COLORS, GOAL, ECHO_TAKEN, ECHO_TALK, ECHO_H, ECHO_TEENS, ECHO_W, MIMIC, MIMIC_STATES, TEEN_LOOKS, cleanLook,
  echoFree, echoPassable, echoPath, echoSpawns, echoTileOf, echoWallsBetween, mimicOpen,
  type ClipInfo, type ClipTag, type EchoAct, type EchoEvent, type EchoGoal, type EchoLook, type EchoMeta, type EchoSnap2, type EchoState, type MimicState,
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
  look: EchoLook;
  /** Clicked "Enter" (past the lobby). */
  entered: boolean;
  /** The fuse I'm carrying. */
  carry: number | null;
  at: number;
  taken: boolean;
  takenUntil: number;
  /** The friend whose voice this player heard most recently (for the mimic to copy). */
  heard: { n: number; at: number } | null;
  /** When this player last asked a question ("where are you?"). */
  askedAt: number;
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
  state: MimicState;
  path: [number, number][];
  target: number | null;
  until: number;
  nextLure: number;
  lures: number;
  lastLure: string | null;
  speakingUntil: number;
  pendingSay: { at: number; clips: string[] } | null;
  expose: Map<number, number>;
  /** Until when it is busy slipping out of a torch beam. */
  slipUntil: number;
  /** Spotted: it freezes for a moment before it charges (your chance to light it up). */
  windUp: number;
}

export interface EchoEvents {
  meta: (m: EchoMeta) => void;
  snap: (s: EchoSnap2) => void;
  event: (e: EchoEvent) => void;
  onIdle: () => void;
}

const T = ECHO.TILE;
const center = (t: number) => (t + 0.5) * T;

/** One ECHO HALLS room: players (who move themselves; the server checks the moves) and the mimics (moved by the server). */
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
  /** Seconds before mimics wake (tests and local play-testing can shorten it). */
  wakeSec: number = MIMIC.WAKE_SEC;
  /** Match length in seconds (tests and local play-testing can shorten it). */
  matchSec: number = GOAL.MATCH_SEC;

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
      m = { id, n: this.nextN++, name: name.slice(0, 20) || "Player", color, x: s.x, y: 0, z: s.z, yaw: 0, pitch: 0, torch: true, crouch: false, talk: false, look: { ...TEEN_LOOKS[teen] }, entered: false, carry: null, at: this.now(), taken: false, takenUntil: 0, heard: null, askedAt: 0 };
      this.members.push(m);
    } else {
      m.name = name.slice(0, 20) || m.name;
    }
    if (!this.members.some((x) => x.id === this.hostId)) this.hostId = id;
    if (this.members.length >= 2 && !this.wakeAt) this.wakeAt = this.now() + this.wakeSec * 1000;
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
    this.members.splice(i, 1);
    for (const [k, c] of this.clips) if (c.owner === gone.n) this.clips.delete(k); // their voice leaves with them
    for (const mm of this.mimics) if (mm.target === gone.n) this.calm(mm);
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

  // ───────── the goal: three fuses, the fuse box, the lift ─────────
  private newGoal(): EchoGoal {
    const spots = [...GOAL.SPOTS];
    const fuses = Array.from({ length: GOAL.FUSES }, (_, id) => { const [x, y, z] = spots.splice(Math.floor(this.rnd() * spots.length), 1)[0]; return { id, x, y, z, by: null, placed: false }; });
    return { fuses, placed: 0, power: false, startedAt: 0, endsAt: 0, inLift: [], need: 0, result: null, endedAt: 0 };
  }
  /** 1 → 1.24 as fuses go in: it gets bolder the closer you are to leaving. */
  private fury() { return 1 + this.goal.placed * 0.08; }
  private dropFuse(m: Member) {
    if (m.carry === null) return;
    const f = this.goal.fuses[m.carry];
    m.carry = null;
    if (!f || f.placed) return;
    Object.assign(f, { by: null, x: m.x, y: 0.05, z: m.z });
    this.ev.event({ type: "drop", n: m.n, fuse: f.id });
    this.pushMeta();
  }

  /** A player acts: goes in, picks up a fuse, uses the fuse box, or asks for another round. */
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
      this.pushMeta();
      return { ok: true };
    }
    if (g.result) return { ok: false, error: "The match is over" };
    if (m.taken) return { ok: false, error: "You were taken" };
    if (a.type === "pickup") {
      const f = g.fuses[a.fuse];
      if (!f || f.placed || f.by !== null) return { ok: false, error: "Not there any more" };
      if (m.carry !== null) return { ok: false, error: "You can only carry one" };
      if (Math.hypot(f.x - m.x, f.z - m.z) > GOAL.REACH + 0.3) return { ok: false, error: "Too far" };
      f.by = m.n; m.carry = f.id;
      this.ev.event({ type: "pickup", n: m.n, fuse: f.id });
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
      this.ev.event({ type: "install", n: m.n, fuse: f.id });
      if (g.placed >= GOAL.FUSES && !g.power) { g.power = true; this.ev.event({ type: "power" }); }
      this.pushMeta();
      return { ok: true };
    }
    return { ok: false, error: "Unknown" };
  }

  private stepGoal(t: number, dt: number) {
    const g = this.goal;
    if (!g.startedAt || g.result) return;
    if (t >= g.endsAt) return this.end("lose", t);
    // carried fuses travel with their carrier
    for (const m of this.members) if (m.carry !== null) { const f = g.fuses[m.carry]; f.x = m.x; f.z = m.z; }
    if (!g.power) return;
    const living = this.members.filter((m) => m.entered && !m.taken);
    const inLift = living.filter((m) => Math.hypot(m.x - GOAL.LIFT.x, m.z - GOAL.LIFT.z) <= GOAL.LIFT_R).map((m) => m.n);
    const changed = inLift.join() !== g.inLift.join() || g.need !== living.length;
    g.inLift = inLift; g.need = living.length;
    this.liftHold = living.length > 0 && inLift.length === living.length ? this.liftHold + dt : 0;
    if (changed) this.pushMeta();
    if (this.liftHold >= GOAL.LIFT_HOLD) this.end("win", t);
  }
  private liftHold = 0;

  private end(result: "win" | "lose", t: number) {
    this.goal.result = result;
    this.goal.endedAt = t;
    this.mimics = [];
    this.ev.event({ type: "end", result });
    this.pushMeta();
  }

  /** Another round in the same room: new fuse spots, everyone back to reception, the mimics asleep again. */
  private restart(t: number) {
    this.goal = this.newGoal();
    this.liftHold = 0;
    this.mimics = []; this.awake = false; this.exposed = 0; this.takenCount = 0;
    this.wakeAt = this.members.length >= 2 ? t + this.wakeSec * 1000 : 0;
    for (const mm of this.clips.values()) mm.used = false;
    const sp = echoSpawns();
    const spawns: [number, number, number][] = [];
    this.members.forEach((m, i) => { const s = sp[i % sp.length]; Object.assign(m, { x: s.x, z: s.z, y: 0, taken: false, takenUntil: 0, carry: null, at: t }); spawns.push([m.n, s.x, s.z]); });
    if (this.members.some((m) => m.entered)) { this.goal.startedAt = t; this.goal.endsAt = t + this.matchSec * 1000; }
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
    // everyone close enough to hear it now remembers this voice as "the friend I heard last"
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
    // taken players come back to the safe room
    for (const m of this.members) {
      if (m.taken && t >= m.takenUntil) {
        const s = echoSpawns()[m.n % 2];
        Object.assign(m, { taken: false, x: s.x, z: s.z, y: 0, at: t });
        this.ev.event({ type: "back", n: m.n, x: s.x, z: s.z });
      }
    }
    this.wake(t);
    if (!this.goal.result) for (const mm of this.mimics) this.think(mm, dt, t);
    this.stepGoal(t, dt);
    if (process.env.ECHO_DEBUG && t - this.debugAt > 3000) {
      this.debugAt = t;
      // eslint-disable-next-line no-console
      console.log(`[echo ${this.code}]`, this.mimics.map((m) => `${m.state} t=${m.target} next=${Math.round((m.nextLure - t) / 1000)}s`).join(" | "), "| players", this.members.map((m) => `${m.n}@${m.x.toFixed(0)},${m.z.toFixed(0)} lone=${this.loneliness(m).toFixed(0)} pick=${this.pick(m, false, false).length}${m.taken ? " TAKEN" : ""}`).join(" "), "| clips", this.clips.size);
    }
    this.ev.snap(this.snapshot());
  }

  private wake(t: number) {
    if (this.awake || !this.wakeAt || t < this.wakeAt || this.clips.size < MIMIC.MIN_CLIPS) return;
    this.awake = true;
    const count = this.members.length >= 3 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const [tx, tz] = this.farTile();
      this.mimics.push({ id: i + 1, x: center(tx), z: center(tz), yaw: 0, state: "wander", path: [], target: null, until: 0, nextLure: t + 10_000 + i * 15_000, lures: 0, lastLure: null, speakingUntil: 0, pendingSay: null, expose: new Map(), slipUntil: 0, windUp: 0 });
    }
    this.ev.event({ type: "wake" });
    this.pushMeta();
  }

  private alive() { return this.members.filter((m) => !m.taken); }

  /** How alone a player is: distance to the nearest other living player (walls count as extra distance). */
  private loneliness(m: Member) {
    let best = 99;
    for (const o of this.alive()) {
      if (o === m) continue;
      const d = Math.hypot(o.x - m.x, o.z - m.z) + echoWallsBetween(m.x, m.z, o.x, o.z) * 6;
      best = Math.min(best, d);
    }
    return best;
  }

  private think(mm: Mimic, dt: number, t: number) {
    // a call that waits for its "late answer" moment
    // never waste a voice on someone too far away to hear it: follow them instead
    const prey = this.members.find((m) => m.n === mm.target && !m.taken);
    if (mm.pendingSay && prey && Math.hypot(prey.x - mm.x, prey.z - mm.z) > 14) {
      for (const k of mm.pendingSay.clips) { const c = this.clips.get(k); if (c) c.used = false; }
      mm.pendingSay = null;
      if (mm.state === "lure") { mm.state = "stalk"; mm.path = []; mm.until = t + 30_000; }
    }
    if (mm.pendingSay && t >= mm.pendingSay.at) {
      const ms = mm.pendingSay.clips.reduce((a, k) => a + (this.clips.get(k)?.ms ?? 0) + 150, 0);
      mm.speakingUntil = t + ms;
      this.ev.event({ type: "say", mimic: mm.id, clips: mm.pendingSay.clips });
      mm.pendingSay = null;
    }
    if (mm.state !== "flee" && this.checkExposed(mm, dt, t)) return;
    // always dangerous up close: walk into it, or look straight at it nearby, and it comes for you
    if (mm.state === "wander" || mm.state === "stalk" || mm.state === "lure") {
      for (const p of this.alive()) {
        const d = Math.hypot(p.x - mm.x, p.z - mm.z);
        if (d >= 6) continue;
        const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
        const facing = d > 0.01 && ((mm.x - p.x) * fx + (mm.z - p.z) * fz) / d > Math.cos(0.6);
        const sees = facing && echoWallsBetween(mm.x, mm.z, p.x, p.z) === 0;
        if (d < MIMIC.NOTICE || sees) {
          mm.state = "chase"; mm.target = p.n; mm.until = t + 12_000; mm.path = []; mm.pendingSay = null;
          mm.windUp = d < MIMIC.NOTICE ? 0 : t + 1200;
          break;
        }
      }
    }
    const target = this.members.find((m) => m.n === mm.target && !m.taken);

    switch (mm.state) {
      case "wander": {
        if (!mm.path.length) mm.path = echoPath(this.tileOf(mm), this.farTile(8));
        this.walk(mm, MIMIC.WANDER, dt);
        if (t >= mm.nextLure) {
          const prey = this.alive().filter((m) => this.loneliness(m) > 9 && this.pick(m, false, false).length).sort((a, b) => this.loneliness(b) - this.loneliness(a))[0];
          if (prey) { mm.state = "stalk"; mm.target = prey.n; mm.until = t + 45_000; mm.path = []; mm.lures = 0; }
          else mm.nextLure = t + 4000;
        }
        break;
      }
      case "stalk": {
        if (!target || t > mm.until || this.loneliness(target) < 6) { this.calm(mm); break; }
        if (!mm.path.length) {
          const spot = this.hideSpot(target, mm);
          if (!spot) { this.calm(mm); break; }
          mm.path = echoPath(this.tileOf(mm), spot);
          if (!mm.path.length) { this.startLure(mm, target, t); break; }
        }
        // hurries while far away (nobody can see it), creeps the last stretch
        const far = Math.hypot(target.x - mm.x, target.z - mm.z) > 15;
        this.walk(mm, far ? MIMIC.STALK * 1.7 : MIMIC.STALK, dt);
        if (!mm.path.length) this.startLure(mm, target, t);
        break;
      }
      case "lure": {
        if (!target) { this.calm(mm); break; }
        if (Math.hypot(target.x - mm.x, target.z - mm.z) > 14) { mm.state = "stalk"; mm.path = []; mm.until = t + 30_000; break; }
        mm.yaw = Math.atan2(-(target.x - mm.x), -(target.z - mm.z));
        const d = Math.hypot(target.x - mm.x, target.z - mm.z);
        // it pounces when you come close, or when you turn round and see it
        const fx = -Math.sin(target.yaw), fz = -Math.cos(target.yaw);
        const facing = d > 0.01 && ((mm.x - target.x) * fx + (mm.z - target.z) * fz) / d > Math.cos(0.6);
        const sees = facing && echoWallsBetween(mm.x, mm.z, target.x, target.z) === 0;
        if (d < MIMIC.NOTICE || (sees && d < 6)) { mm.state = "chase"; mm.until = t + 12_000; mm.path = []; mm.windUp = d < MIMIC.NOTICE ? 0 : t + 1200; break; }
        // they asked "where are you?" → answer, late
        if (target.askedAt > t - 1500 && !mm.pendingSay && t > mm.speakingUntil + 1500) {
          const clips = this.pick(target, true);
          if (clips.length) mm.pendingSay = { at: t + (MIMIC.REPLY_MIN + this.rnd() * (MIMIC.REPLY_MAX - MIMIC.REPLY_MIN)) * 1000, clips };
          target.askedAt = 0;
        }
        if (t > mm.until) {
          if (mm.lures < 2 && this.loneliness(target) > 7) this.startLure(mm, target, t);
          else this.calm(mm);
        }
        break;
      }
      case "chase": {
        if (!target || t > mm.until) { this.calm(mm); break; }
        const d = Math.hypot(target.x - mm.x, target.z - mm.z);
        if (d > 18) { this.calm(mm); break; }
        if (d < MIMIC.CATCH) { this.take(mm, target, t); break; }
        if (t < mm.windUp) { mm.yaw = Math.atan2(-(target.x - mm.x), -(target.z - mm.z)); break; }
        const sees = echoWallsBetween(mm.x, mm.z, target.x, target.z) === 0;
        if (sees && d < 5) {
          this.stepTo(mm, target.x, target.z, MIMIC.CHASE * this.fury(), dt);
        } else {
          const goal: [number, number] = [echoTileOf(target.x), echoTileOf(target.z)];
          const last = mm.path[mm.path.length - 1];
          if (!last || last[0] !== goal[0] || last[1] !== goal[1]) mm.path = echoPath(this.tileOf(mm), goal);
          this.walk(mm, MIMIC.CHASE * this.fury(), dt);
        }
        break;
      }
      case "flee": {
        if (!mm.path.length && t < mm.until) mm.path = echoPath(this.tileOf(mm), this.farTile(12));
        this.walk(mm, MIMIC.FLEE, dt);
        if (t >= mm.until) this.calm(mm);
        break;
      }
      default:
        break;
    }
  }

  private startLure(mm: Mimic, target: Member, t: number) {
    const clips = this.pick(target, false);
    if (!clips.length) { this.calm(mm); return; }
    mm.state = "lure";
    mm.lures++;
    mm.lastLure = clips[clips.length - 1];
    mm.pendingSay = { at: t + 300, clips };
    mm.until = t + 12_000;
  }

  /** Back to wandering, and wait a while before the next hunt. */
  private calm(mm: Mimic) {
    const t = this.now();
    mm.state = "wander";
    mm.target = null;
    mm.path = [];
    mm.pendingSay = null;
    mm.nextLure = Math.max(mm.nextLure, t + ((MIMIC.LURE_GAP_MIN + this.rnd() * (MIMIC.LURE_GAP_MAX - MIMIC.LURE_GAP_MIN)) * 1000) / this.fury() ** 2);
  }

  private take(mm: Mimic, target: Member, t: number) {
    target.taken = true;
    target.takenUntil = t + MIMIC.TAKEN_SEC * 1000;
    this.takenCount++;
    this.dropFuse(target);
    this.ev.event({ type: "taken", n: target.n, mimic: mm.id, lure: mm.lastLure });
    this.calm(mm);
    mm.nextLure = t + 25_000;
    this.pushMeta();
  }

  /** Torch held on a visible mimic for EXPOSE_SEC → it shrieks and runs. */
  private checkExposed(mm: Mimic, dt: number, t: number): boolean {
    for (const m of this.alive()) {
      const dx = mm.x - m.x, dz = mm.z - m.z;
      const d = Math.hypot(dx, dz);
      let lit = false;
      if (m.torch && d < MIMIC.EXPOSE_RANGE && d > 0.01) {
        const fx = -Math.sin(m.yaw), fz = -Math.cos(m.yaw);
        const cos = (fx * dx + fz * dz) / d;
        lit = cos > Math.cos(MIMIC.BEAM) && echoWallsBetween(m.x, m.z, mm.x, mm.z) === 0;
      }
      // only a mimic that is calling or hunting can be exposed; caught sneaking around, it just slips back into the dark
      const exposable = mm.state === "lure" || mm.state === "chase" || t < mm.speakingUntil + 3000;
      if (!exposable) {
        if (lit && d >= 6 && t > mm.slipUntil) { mm.slipUntil = t + 2500; mm.path = echoPath(this.tileOf(mm), this.farTile(6)); }
        continue;
      }
      const v = Math.max(0, (mm.expose.get(m.n) ?? 0) + (lit ? dt : -dt * 2));
      mm.expose.set(m.n, v);
      if (v >= MIMIC.EXPOSE_SEC) {
        mm.expose.clear();
        this.exposed++;
        this.ev.event({ type: "exposed", mimic: mm.id, by: m.n });
        mm.state = "flee";
        mm.target = null;
        mm.pendingSay = null;
        mm.until = t + MIMIC.FLEE_SEC * 1000;
        mm.nextLure = mm.until + 5000;
        mm.path = echoPath(this.tileOf(mm), this.farTile(12));
        this.pushMeta();
        return true;
      }
    }
    return false;
  }

  /**
   * Which voice pieces to play at `target`.
   * Voice: the friend they heard last (else whoever has most pieces). Only pieces the target's device holds, never reused.
   * Content: an answer to a question → "here"; otherwise their name + "come here", a call, "found it", or any short piece.
   */
  private pick(target: Member, answering: boolean, commit = true): string[] {
    const usable = [...this.clips.values()].filter((c) => !c.used && c.owner !== target.n && c.have.has(target.n) && this.members.some((m) => m.n === c.owner));
    if (!usable.length) return [];
    const byOwner = new Map<number, Clip[]>();
    for (const c of usable) byOwner.set(c.owner, [...(byOwner.get(c.owner) ?? []), c]);
    const recent = target.heard && this.now() - target.heard.at < 90_000 ? target.heard.n : null;
    const owner = recent !== null && byOwner.has(recent) ? recent : [...byOwner.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
    const pool = byOwner.get(owner)!;
    const has = (tag: ClipTag) => pool.filter((c) => c.tags.includes(tag));
    // the best "plain" pieces sound like a full short phrase: 0.9–2.6 s, the closer to 1.5 s the better
    const short = pool.filter((c) => c.ms >= 700).sort((a, b) => Math.abs(a.ms - 1500) - Math.abs(b.ms - 1500));
    let chosen: Clip[] = [];
    if (answering) chosen = [has("here")[0] ?? has("call")[0] ?? short[0]].filter(Boolean) as Clip[];
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

  // ───────── moving mimics ─────────
  private tileOf(mm: Mimic): [number, number] { return [echoTileOf(mm.x), echoTileOf(mm.z)]; }

  private walk(mm: Mimic, speed: number, dt: number) {
    let left = speed * dt;
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
    mm.x += (dx / d) * s;
    mm.z += (dz / d) * s;
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

  /**
   * Where to call from: out of the target's sight (behind a wall, or behind their back), 4–14 m away.
   * Closer spots win (louder, scarier), then spots near the mimic.
   */
  private hideSpot(target: Member, mm: Mimic): [number, number] | null {
    let best: [number, number] | null = null;
    let bestScore = Infinity;
    const fx = -Math.sin(target.yaw), fz = -Math.cos(target.yaw);
    for (let z = 0; z < ECHO_H; z++) for (let x = 0; x < ECHO_W; x++) {
      if (!mimicOpen(x, z)) continue;
      const cx = center(x), cz = center(z);
      const d = Math.hypot(cx - target.x, cz - target.z);
      if (d < 4 || d > 14) continue;
      const walled = echoWallsBetween(cx, cz, target.x, target.z) > 0;
      const behind = ((cx - target.x) * fx + (cz - target.z) * fz) / d < -0.2; // more than ~100° from where they look
      if (!walled && !behind) continue;
      if (this.members.some((m) => m !== target && Math.hypot(cx - m.x, cz - m.z) < 5)) continue;
      const score = d + Math.hypot(cx - mm.x, cz - mm.z) * 0.3;
      if (score < bestScore) { bestScore = score; best = [x, z]; }
    }
    return best;
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
      p: this.members.map((m) => [m.n, Math.round(m.x * 100), Math.round(m.y * 100), Math.round(m.z * 100), Math.round(m.yaw * 1000), Math.round(m.pitch * 1000), (m.torch ? 1 : 0) | (m.crouch ? 2 : 0) | (m.taken ? ECHO_TAKEN : 0) | (m.talk && !m.taken ? ECHO_TALK : 0)]),
      m: this.mimics.map((mm) => [mm.id, Math.round(mm.x * 100), Math.round(mm.z * 100), Math.round(mm.yaw * 1000), MIMIC_STATES.indexOf(mm.state), t < mm.speakingUntil ? 1 : 0]),
    };
  }

  /** Tests / debugging. */
  debug() { return { members: this.members, mimics: this.mimics, clips: this.clips }; }

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
