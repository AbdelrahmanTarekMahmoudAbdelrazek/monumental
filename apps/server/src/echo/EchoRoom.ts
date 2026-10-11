import { MotionStyle, defaultLook, defaultStop, MOTION_HZ, type LookSnippet, type StopSnippet } from "./motion";
import {
  COPY, ECHO, ECHO_ARMED, ECHO_COLORS, ECHO_HIDDEN, ECHO_LOCKERS, ECHO_RADIO, ECHO_ROOMS, GOAL, HIDE, RADIO, ECHO_TAKEN, ECHO_TALK, ECHO_H, ECHO_TEENS, ECHO_W, MIMIC, MIMIC_STATES, PERK, TEEN_LOOKS, cleanLook,
  lockerFront, echoFree, echoPassable, echoPath, echoSpawns, echoTile, echoTileOf, echoWallsBetween, mimicOpen, mimicRevealed,
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
  /** v36: when their last voice piece ended (the server hears no words without speech-to-text, only that they spoke). */
  spokeAt?: number;
  /** Sam has used his one escape this match. */
  freed: boolean;
  /** Times grabbed this match; at COPY.STRIKES they are gone. */
  strikes: number;
  gone: boolean;
  /** Fuses this player put in the box. */
  installed: number;
  /** Rode the lift with the Copy and was taken in it. */
  rode: boolean;
  /** Hiding in this locker (null = not hiding). */
  hidden: number | null;
  /** Last time they ran (footsteps carry). */
  loudAt: number;
  /** Shot by a friend this match. */
  shot: number;
}

interface Clip extends ClipInfo {
  at: number;
  have: Set<number>;
  used: boolean;
  /** v36: who heard this take live (they would recognise it), and how many fuses were in when it was said. */
  heardBy?: Set<number>;
  placedThen?: number;
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
  pendingSay: { at: number; clips: string[]; born?: number } | null;
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
  /** Moves like a body: a heading that turns at a human rate, a speed that builds and eases. */
  head: number;
  speed: number;
  /** This walk's pace (people don't all walk at exactly the same speed). */
  gait: number;
  /** v39: the real movement it is replaying (see motion.ts). */
  /** v39: a fuse it is going for (loose on the floor, or one already in the box). */
  fetch?: { fuse: number; box: boolean } | null;
  nextFetch?: number;
  mirror?: { look: LookSnippet; li: number; pace: number; paceUntil: number; stop: StopSnippet | null; si: number; stopYaw: number };
  /** Players it watched climb into a locker. */
  saw: Set<number>;
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
  /** Fuses it already moved (it doesn't keep shuffling the same one). */
  private moved = new Set<number>();
  private rode = false;
  private moments: { at: number; text: string; w: number }[] = [];
  private names = new Map<number, string>();
  private lifted = false;
  /** v39: every player's own movement habits (positions and view only), for the Copy to copy. */
  private styles = new Map<number, MotionStyle>();
  /** Practice alone: the Copy may wear your own face and use your own voice, the pistol never runs dry, nobody is gone for good. */
  practice = false;
  /** Can this Copy go after `m`? Normally never the one whose face it wears; in practice that is the only one there is. */
  private other(mm: Mimic, m: Member) { return this.practice || m.n !== mm.as; }

  constructor(public readonly code: string, private hostId: string, private ev: EchoEvents, private now: () => number = Date.now, private rnd: () => number = Math.random) {
    this.goal = this.newGoal();
    this.scheduleIdle();
  }

  // ───────── players ─────────
  join(id: string, name: string): { ok: true; n: number; spawn: { x: number; z: number } } | { ok: false; error: string } {
    let m = this.members.find((x) => x.id === id);
    if (!m) {
      if (this.practice) return { ok: false, error: "This is a practice room for one — start your own" };
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
        strikes: 0, gone: false, installed: 0, rode: false, hidden: null, loudAt: 0, shot: 0,
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
    this.dropGun(gone);
    this.unhide(gone, false);
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
    const [gx, gy, gz] = GOAL.GUN_SPOTS[Math.floor(this.rnd() * GOAL.GUN_SPOTS.length)];
    return {
      fuses, placed: 0, power: false, startedAt: 0, endsAt: 0, inLift: [], need: 0, result: null, endedAt: 0, pry: [], calledAt: 0, liftAt: 0, gone: [], summary: null,
      gun: { x: gx, y: gy, z: gz, by: null, ammo: GOAL.AMMO }, hidden: [],
    };
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
  private dropGun(m: Member) {
    const g = this.goal.gun;
    if (g.by !== m.n) return;
    Object.assign(g, { by: null, x: m.x, y: 0.06, z: m.z });
    this.pushMeta();
  }
  /** Out of the locker (or pulled out). `event`: tell everyone. */
  private unhide(m: Member, event = true) {
    if (m.hidden === null) return;
    const locker = m.hidden;
    m.hidden = null;
    this.goal.hidden = this.goal.hidden.filter((h) => h[0] !== m.n);
    for (const mm of this.mimics) mm.saw.delete(m.n);
    const f = lockerFront(locker);
    if (echoFree(f.x, f.z)) { m.x = f.x; m.z = f.z; }
    m.at = this.now();
    if (event) this.ev.event({ type: "unhide", n: m.n, locker, x: m.x, z: m.z });
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
    if (a.type === "practice") {
      if (this.members.length !== 1) return { ok: false, error: "Practice is for one player alone" };
      if (g.startedAt) return { ok: false, error: "The match has already started" };
      this.practice = true;
      this.wakeSec = Math.min(this.wakeSec, 15);
      this.armPractice(m);
      this.pushMeta();
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
    if (a.type === "unhide") {
      if (m.hidden === null) return { ok: false, error: "You're not hiding" };
      this.unhide(m);
      return { ok: true };
    }
    if (m.hidden !== null) return { ok: false, error: "Get out of the locker first" };
    if (a.type === "hide") {
      const L = ECHO_LOCKERS[a.locker];
      if (!L) return { ok: false, error: "No locker there" };
      const f = lockerFront(a.locker);
      if (Math.hypot(f.x - m.x, f.z - m.z) > HIDE.REACH + 0.4) return { ok: false, error: "Too far from the locker" };
      if (g.hidden.some((h) => h[1] === a.locker)) return { ok: false, error: "Someone is already in there" };
      g.pry = g.pry.filter((p) => p[0] !== m.n);
      m.hidden = a.locker;
      m.x = L[0]; m.z = L[1]; m.at = t;
      g.hidden.push([m.n, a.locker]);
      // a Copy that watched you climb in remembers the locker
      for (const mm of this.mimics) if (this.los(mm.x, mm.z, f.x, f.z, HIDE.SEEN_RANGE)) mm.saw.add(m.n);
      this.ev.event({ type: "hide", n: m.n, locker: a.locker });
      this.pushMeta();
      return { ok: true };
    }
    if (a.type === "gun") {
      const gun = g.gun;
      if (gun.by !== null) return { ok: false, error: "Someone has it" };
      if (Math.hypot(gun.x - m.x, gun.z - m.z) > GOAL.REACH + 0.3) return { ok: false, error: "Too far" };
      gun.by = m.n;
      this.ev.event({ type: "gun", n: m.n });
      this.moment(t, `${m.name} took the pistol off a dead officer in ${the(roomName(gun.x, gun.z))}. ${gun.ammo} bullet${gun.ammo === 1 ? "" : "s"} left.`, 1);
      this.pushMeta();
      return { ok: true };
    }
    if (a.type === "shoot") {
      const gun = g.gun;
      if (gun.by !== m.n) return { ok: false, error: "You have no gun" };
      if (gun.ammo <= 0) return { ok: false, error: "Click. It's empty." };
      if (!Number.isFinite(a.yaw) || !Number.isFinite(a.pitch)) return { ok: false, error: "Invalid" };
      if (!this.practice) gun.ammo--;
      this.shoot(m, a.yaw, Math.max(-1.5, Math.min(1.5, a.pitch)), t);
      this.pushMeta();
      return { ok: true };
    }
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
        if ((mm.state === "wander" || mm.state === "search") && mm.carry === null && this.other(mm, m) && Math.hypot(mm.x - m.x, mm.z - m.z) < 25) this.hunt(mm, m, t);
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

  /** A shot along (yaw, pitch) from the shooter's eye: the first Copy or player in the line, or the wall. */
  private shoot(m: Member, yaw: number, pitch: number, t: number) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), eye = m.crouch ? ECHO.CROUCH_EYE : ECHO.EYE, slope = Math.tan(pitch);
    // where the bullet stops: a wall, the floor or the ceiling
    let end = GOAL.GUN_RANGE;
    for (let d = 0.25; d <= GOAL.GUN_RANGE; d += 0.25) {
      const x = m.x + fx * d, z = m.z + fz * d, y = eye + slope * d;
      if (y < 0 || y > ECHO.WALL_H + 0.2 || !echoFree(x, z) || echoWallsBetween(m.x, m.z, x, z) > 0) { end = d - 0.25; break; }
    }
    type Hit = { d: number; copy?: Mimic; who?: Member };
    const hits: Hit[] = [];
    const test = (x: number, z: number, top: number) => {
      const dx = x - m.x, dz = z - m.z, along = dx * fx + dz * fz;
      if (along < 0.3 || along > end + 0.4) return null;
      const side = Math.abs(dx * fz - dz * fx), y = eye + slope * along;
      return side < 0.42 && y > 0.05 && y < top ? along : null;
    };
    for (const mm of this.mimics) { const d = test(mm.x, mm.z, mm.crouch ? 1.3 : 1.95); if (d !== null) hits.push({ d, copy: mm }); }
    for (const o of this.members) { if (o === m || !o.entered || o.taken || o.gone || o.hidden !== null) continue; const d = test(o.x, o.z, o.crouch ? 1.25 : 1.85); if (d !== null) hits.push({ d, who: o }); }
    hits.sort((a, b) => a.d - b.d);
    const h = hits[0];
    const dist = h ? h.d : end;
    const base = { type: "shot" as const, n: m.n, x: m.x, z: m.z, hx: m.x + fx * dist, hz: m.z + fz * dist, hy: Math.max(0.05, Math.min(ECHO.WALL_H, eye + slope * dist)), ammo: this.goal.gun.ammo };
    if (h?.copy) {
      const mm = h.copy, revealed = mimicRevealed(mm.state);
      this.ev.event({ ...base, hit: { copy: mm.id } });
      this.exposed++;
      if (!revealed) this.ev.event({ type: "reveal", mimic: mm.id, as: mm.as });
      this.moment(t, revealed ? `${m.name} shot the creature in ${the(roomName(mm.x, mm.z))}. It ran.` : `${m.name} shot "${this.nameOf(mm.as)}" in ${the(roomName(mm.x, mm.z))}. It wasn't ${this.nameOf(mm.as)}. Its face came apart and it ran.`, 3);
      this.dropCopyFuse(mm);
      this.flee(mm, t, COPY.FLEE_SEC + 15);
      mm.nextHunt = mm.until + 10_000;
    } else if (h?.who) {
      const o = h.who;
      o.strikes++;
      o.shot++;
      const gone = o.strikes >= COPY.STRIKES;
      if (gone) {
        o.gone = true; o.taken = true; o.takenUntil = Infinity;
        this.goal.gone = [...new Set([...this.goal.gone, o.n])];
        this.dropFuse(o); this.dropGun(o);
        this.goal.pry = this.goal.pry.filter((p) => p[0] !== o.n);
      }
      this.ev.event({ ...base, hit: { n: o.n, gone } });
      this.moment(t, `${m.name} shot ${o.name} in ${the(roomName(o.x, o.z))}. It really was ${o.name}.${gone ? ` ${o.name} didn't get up.` : ""}`, 3);
    } else this.ev.event({ ...base, hit: null });
    // the bang carries through the whole wing: every Copy that hears it comes to look
    for (const mm of this.mimics) {
      if (mimicRevealed(mm.state) || mm.carry !== null || mm === h?.copy) continue;
      if (Math.hypot(mm.x - m.x, mm.z - m.z) > GOAL.GUN_HEAR) continue;
      if (this.other(mm, m) && (mm.state === "wander" || mm.state === "search")) this.hunt(mm, m, t);
    }
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
    if (g.gun.by !== null) { const c = this.members.find((m) => m.n === g.gun.by); if (c) { g.gun.x = c.x; g.gun.z = c.z; } }
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
        const pickN = inLift[Math.floor(this.rnd() * inLift.length)];
        const victim = this.members.find((m) => m.n === pickN)!;
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
  /** Practice: the pistol starts in your hand, full. */
  private armPractice(m: Member | undefined) {
    if (!this.practice || !m) return;
    Object.assign(this.goal.gun, { by: m.n, ammo: 99 });
  }

  private restart(t: number) {
    this.goal = this.newGoal();
    this.liftHold = 0; this.lifted = false;
    this.mimics = []; this.awake = false; this.exposed = 0; this.takenCount = 0; this.nextRadio = 0;
    this.faces.clear(); this.voices.clear(); this.stolen = 0; this.moved.clear(); this.rode = false; this.moments = [];
    this.wakeAt = 0;
    for (const mm of this.clips.values()) mm.used = false;
    const sp = echoSpawns();
    const spawns: [number, number, number][] = [];
    this.members.forEach((m, i) => {
      const s = sp[i % sp.length];
      Object.assign(m, { x: s.x, z: s.z, y: 0, taken: false, takenUntil: 0, carry: null, freed: false, strikes: 0, gone: false, installed: 0, rode: false, at: t, hidden: null, loudAt: 0, shot: 0 });
      spawns.push([m.n, s.x, s.z]);
    });
    if (this.members.some((m) => m.entered)) { this.goal.startedAt = t; this.goal.endsAt = t + this.matchSec * 1000; }
    this.armPractice(this.members[0]);
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
    // inside a locker you can look through the slits, not walk
    if (m.hidden !== null) { m.torch = false; m.at = t; return false; }
    if (dist / dt > ECHO.WALK * 1.3 && dist < 3) m.loudAt = t;
    if (dist > ECHO.SPRINT * dt * 1.5 + 1 || !echoFree(s.x, s.z) || !echoPassable(m.x, m.z, s.x, s.z)) return false;
    m.x = s.x;
    m.y = Math.max(-0.5, Math.min(1, s.y));
    m.z = s.z;
    m.at = t;
    let st = this.styles.get(m.n); if (!st) { st = new MotionStyle(); this.styles.set(m.n, st); }
    st.add({ t, x: m.x, z: m.z, yaw: m.yaw, pitch: m.pitch, crouch: m.crouch });
    return true;
  }

  // ───────── voice pieces (labels only) ─────────
  /** The owner's device cut a new piece of their speech. */
  clip(id: string, pieceId: number, ms: number, tags: ClipTag[]) {
    const m = this.members.find((x) => x.id === id);
    if (!m) return;
    const key = `${m.n}:${pieceId}`;
    if (this.clips.has(key)) return;
    const heardBy = new Set(this.members.filter((o) => o !== m && Math.hypot(o.x - m.x, o.z - m.z) <= ECHO.VOICE_RANGE).map((o) => o.n));
    this.clips.set(key, { key, owner: m.n, ms, tags, at: this.now(), have: new Set([m.n]), used: false, heardBy, placedThen: this.goal.placed });
    if (this.clips.size > 400) { const oldest = [...this.clips.values()].sort((a, b) => a.at - b.at)[0]; this.clips.delete(oldest.key); }
    for (const o of this.members) {
      if (o.n === m.n) continue;
      if (Math.hypot(o.x - m.x, o.z - m.z) <= ECHO.VOICE_RANGE) o.heard = { n: m.n, at: this.now() };
    }
    if (tags.includes("question")) m.askedAt = this.now();
    m.spokeAt = this.now();
  }

  /** Speech-to-text finished for a piece: better labels. */
  tag(id: string, pieceId: number, tags: ClipTag[]) {
    const m = this.members.find((x) => x.id === id);
    const c = m && this.clips.get(`${m.n}:${pieceId}`);
    if (!m || !c) return;
    c.tags = [...new Set([...c.tags, ...tags])];
    if (tags.includes("question")) m.askedAt = this.now();
    this.nameCalled(m, c, tags);
  }

  /**
   * v36: somebody calls the name of the friend a Copy is wearing. If it is close enough to have heard, and the real
   * friend is not in earshot to answer, it answers — at the speed a person would (about half a second), plus a hair.
   */
  private nameCalled(m: Member, c: Clip, tags: ClipTag[]) {
    const t = this.now();
    if (this.goal.result || t - c.at > 1500) return; // the moment has passed: a late "yes?" gives it away
    for (const tag of tags) {
      if (!tag.startsWith("name:")) continue;
      const who = Number(tag.slice(5));
      for (const mm of this.mimics) {
        if (mm.as !== who || mimicRevealed(mm.state) || mm.pendingSay || mm.carry !== null || t < mm.speakingUntil + 2000) continue;
        if (Math.hypot(m.x - mm.x, m.z - mm.z) > ECHO.VOICE_RANGE) continue;
        const real = this.members.find((o) => o.n === who && !o.taken && !o.gone);
        if (!this.practice && real && (real === m || Math.hypot(real.x - m.x, real.z - m.z) < ECHO.VOICE_RANGE + 3)) continue;
        if (this.rnd() < 0.15) continue; // people don't always answer
        const clips = this.pick(m, who, "answer", true, mm);
        if (!clips.length) continue;
        const g = Math.sqrt(-2 * Math.log(Math.max(1e-6, this.rnd()))) * Math.cos(2 * Math.PI * this.rnd());
        const lat = Math.min(1300, Math.max(300, Math.exp(Math.log(550) + 0.35 * g))) + 250;
        this.say(mm, t, clips, Math.max(0, lat - (t - c.at)));
        return;
      }
    }
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
    if (this.wakeAt || this.members.length < (this.practice ? 1 : 2) || !this.goal.startedAt) return;
    this.wakeAt = this.now() + this.wakeSec * 1000;
  }

  private wake(t: number) {
    if (this.awake || !this.wakeAt || t < this.wakeAt) return;
    this.awake = true;
    // the building is big now: two of them once there are three of you
    const count = this.members.length >= 3 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const [tx, tz] = this.farTile(12);
      const mm: Mimic = {
        id: i + 1, x: center(tx), z: center(tz), yaw: 0, pitch: 0, state: "wander", path: [], target: null, until: 0, nextHunt: t + 8_000 + i * 12_000,
        as: 0, crouch: false, torch: true, speakingUntil: 0, pendingSay: null, lit: new Map(), slipUntil: 0, windUp: 0, followSince: 0,
        look: { kind: "sweep", base: 0, from: t, to: t }, carry: null, stealTo: null, stealFrom: "", head: 0, speed: 0, gait: 1, calledAt: 0, crouchAt: 0, lastPry: 0,
        saw: new Set(),
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
  /** Players out in the open (not shut in a locker): they can watch, and be hunted. */
  private open() { return this.alive().filter((m) => m.hidden === null); }
  /** Can this Copy go after `m`? Not if they're hidden, unless it knows where. */
  private findable(mm: Mimic, m: Member) { return m.hidden === null || mm.saw.has(m.n); }
  private los(ax: number, az: number, bx: number, bz: number, range: number) {
    return Math.hypot(ax - bx, az - bz) < range && echoWallsBetween(ax, az, bx, bz) === 0;
  }
  /** Anyone (but `except`) could see this spot. */
  private watched(x: number, z: number, range = 20, except?: Member) {
    return this.open().some((m) => m !== except && this.los(m.x, m.z, x, z, range));
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
    for (const o of this.open()) {
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
    if (prey.n === mm.as && !this.practice) {
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
    mm.pendingSay = { at: t + delayMs, clips, born: t };
  }

  private think(mm: Mimic, dt: number, t: number) {
    // v36 turn-taking: never over the person it talks to, never while the real owner of that voice is talking where someone could hear both
    if (mm.pendingSay && t >= mm.pendingSay.at && !this.practice) {
      const owner = this.members.find((m) => m.n === mm.as && !m.taken && !m.gone);
      const tgt = this.members.find((m) => m.n === mm.target);
      if (owner?.talk && this.open().some((l) => l !== owner && Math.hypot(l.x - owner.x, l.z - owner.z) < ECHO.VOICE_RANGE + 3 && Math.hypot(l.x - mm.x, l.z - mm.z) < ECHO.VOICE_RANGE + 3)) mm.pendingSay = null;
      else if (tgt?.talk) {
        if (t - (mm.pendingSay.born ?? t) > 4000) mm.pendingSay = null; // the moment has passed
        else mm.pendingSay.at = t + 350 + this.rnd() * 300; // let them finish, then a human-sized gap
      }
    }
    if (mm.pendingSay && t >= mm.pendingSay.at) {
      const ms = 220 + mm.pendingSay.clips.reduce((a, k) => a + (this.clips.get(k)?.ms ?? 0) + 350, 0); // matches the client: a short lead-in and a breath between phrases
      mm.speakingUntil = t + ms;
      for (const k of mm.pendingSay.clips) { const c = this.clips.get(k); if (c) this.voices.set(c.owner, (this.voices.get(c.owner) ?? 0) + 1); }
      this.ev.event({ type: "say", mimic: mm.id, clips: mm.pendingSay.clips });
      mm.pendingSay = null;
    }
    if (mm.state !== "flee" && this.torchCheck(mm, dt, t)) return;
    this.listen(mm, t);
    // a face nobody plays any more: swap it when unseen
    if (!mimicRevealed(mm.state) && (!mm.as || !this.members.some((m) => m.n === mm.as)) && this.canChangeFace(mm)) this.disguise(mm, this.members.find((m) => m.n === mm.target) ?? null);
    // the lift is coming: every Copy goes to stand with the group
    if (this.goal.calledAt && (mm.state === "wander" || mm.state === "search")) { mm.state = "lift"; mm.path = []; mm.target = null; this.dropCopyFuse(mm); }

    const target = this.members.find((m) => m.n === mm.target && !m.taken && !m.gone);
    // they climbed into a locker: if it saw which one, it goes and tears it open; if not, it has lost them
    if (target && target.hidden !== null && (mm.state === "stalk" || mm.state === "follow" || mm.state === "chase" || mm.state === "lift")) {
      if (!mm.saw.has(target.n)) { this.lose(mm, t); return; }
      this.goYank(mm, target, dt, t);
      return;
    }
    const crouchTo = (c: boolean) => { if (mm.crouch !== c && t >= mm.crouchAt) { mm.crouch = c; mm.crouchAt = t + 800; } };

    switch (mm.state) {
      case "wander": {
        mm.pitch = 0;
        crouchTo(false);
        if (t >= mm.nextHunt && mm.carry === null) {
          const prey = this.alive().filter((m) => this.other(mm, m) && this.findable(mm, m) && !this.mimics.some((o) => o !== mm && o.target === m.n) && this.loneliness(m) > 6).sort((a, b) => this.loneliness(b) - this.loneliness(a))[0];
          if (prey) { this.hunt(mm, prey, t); if ((mm.state as MimicState) === "stalk") break; }
          mm.nextHunt = t + 5000;
        }
        // v39: it goes for fuses — a loose one nobody is guarding, or one already in the box when nobody is near it
        if (this.fetchStep(mm, t, dt)) break;
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
              this.moved.add(f.id);
              this.moment(t, `The Copy, wearing ${this.nameOf(mm.as)}'s face, carried a fuse out of ${the(from)} and hid it in ${the(roomName(f.x, f.z))}.`, 2);
              this.pushMeta();
            } else this.dropCopyFuse(mm);
            mm.stealTo = null;
          } else this.startSearch(mm, t);
          break;
        }
        // v39: out of sight but within earshot it talks like a player calling out to the others
        if (!mm.pendingSay && t > mm.speakingUntil + 14_000 && this.rnd() < dt / 5) {
          const ear = this.open().filter((m) => this.other(mm, m) && Math.hypot(m.x - mm.x, m.z - mm.z) < 16 && !this.los(m.x, m.z, mm.x, mm.z, 16)).sort((a, b) => Math.hypot(a.x - mm.x, a.z - mm.z) - Math.hypot(b.x - mm.x, b.z - mm.z))[0];
          if (ear) this.say(mm, t, this.pick(ear, mm.as, "call", true, mm), 200);
        }
        // hurries only where nobody can see it
        this.walk(mm, this.watched(mm.x, mm.z, 22) ? COPY.WALK : COPY.HURRY, dt);
        break;
      }
      case "search": {
        // a player looking for fuses: looks around, crouches to check under things, turns in a slow circle
        const k = Math.min(1, (t - mm.look.from) / Math.max(1, mm.look.to - mm.look.from));
        // eased, so the turn starts and stops like a person's
        const e = k * k * (3 - 2 * k);
        mm.yaw = mm.look.kind === "circle" ? mm.look.base + e * Math.PI * 2 : mm.look.base + Math.sin(e * Math.PI * 2) * 0.9;
        mm.head = mm.yaw;
        mm.speed = Math.max(0, mm.speed - 5 * dt);
        mm.pitch = mm.crouch ? -0.35 : -0.15;
        // a loose fuse here and nobody watching: it takes it to hide somewhere else
        if (mm.carry === null && this.stolen < COPY.STEALS && this.goal.startedAt && k > 0.5) {
          const f = this.goal.fuses.find((x) => !x.placed && x.by === null && !this.moved.has(x.id) && !this.goal.pry.some((p) => p[1] === x.id) && Math.hypot(x.x - mm.x, x.z - mm.z) < 2.2);
          if (f && !this.watched(mm.x, mm.z, 18)) { this.carryAway(mm, f); crouchTo(false); break; }
        }
        if (t >= mm.look.to) {
          // a locker right here: sometimes it opens it
          const inside = this.alive().find((m) => m.hidden !== null && Math.hypot(ECHO_LOCKERS[m.hidden][0] - mm.x, ECHO_LOCKERS[m.hidden][1] - mm.z) < HIDE.CHECK_RANGE);
          if (inside && this.rnd() < HIDE.CHECK_CHANCE) { mm.saw.add(inside.n); mm.state = "stalk"; mm.target = inside.n; mm.until = t + 30_000; mm.path = []; break; }
          mm.state = "wander"; mm.path = []; crouchTo(false);
        }
        break;
      }
      case "stalk": {
        if (!target || t > mm.until) { this.calm(mm, t); break; }
        const d = Math.hypot(target.x - mm.x, target.z - mm.z);
        const seen = this.los(target.x, target.z, mm.x, mm.z, 30);
        // close and in sight: walk up like a friend would
        if (d < 8 && seen) { mm.state = "follow"; mm.followSince = t; mm.path = []; break; }
        // calls out in the stolen voice from around the corner
        if (!seen && d < 16 && !mm.pendingSay && t > mm.speakingUntil + 5000) this.say(mm, t, this.pick(target, mm.as, "call", true, mm), 300);
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
        const real = this.practice ? undefined : this.alive().find((m) => m.n === mm.as);
        if (real && this.los(real.x, real.z, mm.x, mm.z, 16)) { this.calm(mm, t); mm.path = echoPath(this.tileOf(mm), this.farTile(10)); break; }
        if (!this.practice && t - mm.followSince > COPY.PATIENCE_SEC * 1000) { this.calm(mm, t); mm.path = echoPath(this.tileOf(mm), this.farTile(10)); break; }
        // their back is turned and nobody else is watching: it closes in, quietly
        const away = this.lookAway(target, mm.x, mm.z);
        const witness = this.open().some((m) => m !== target && this.los(m.x, m.z, mm.x, mm.z, 14));
        const ready = t - mm.followSince > COPY.FOLLOW_MIN_SEC * 1000 && !witness;
        // practice: you came to be hunted — after a few seconds at your side it goes for you even face to face
        if (ready && (away > 1.75 || (this.practice && t - mm.followSince > 8000))) {
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
          this.nudge(mm, mm.x - (target.x - mm.x), mm.z - (target.z - mm.z), 0.6, dt);
        }
        crouchTo(target.crouch);
        // mostly watches them; now and then looks around the room like anyone would
        const toward = Math.atan2(-(target.x - mm.x), -(target.z - mm.z));
        const glance = Math.sin(t / 1700) > 0.7 ? Math.sin(t / 900) * 1.2 : 0;
        this.face(mm, toward + glance, dt, 3);
        mm.pitch = 0;
        // they asked something: a late answer in the friend's voice
        if (target.askedAt > t - 1500 && !mm.pendingSay && t > mm.speakingUntil + 1500) {
          this.say(mm, t, this.pick(target, mm.as, "answer", true, mm), (MIMIC.REPLY_MIN + this.rnd() * (MIMIC.REPLY_MAX - MIMIC.REPLY_MIN)) * 1000);
          target.askedAt = 0;
        } else if ((target.spokeAt ?? 0) > t - 900 && !target.talk && !mm.pendingSay && t > mm.speakingUntil + 4500) {
          // v36: they said something (no words known): it answers, the way a friend says "yeah" back (decided once per thing said)
          if (this.rnd() < (this.practice ? 0.75 : 0.6)) this.say(mm, t, this.pick(target, mm.as, "answer", true, mm), 450 + this.rnd() * 500);
          target.spokeAt = 0;
        } else if (!target.talk && !mm.pendingSay && t > mm.speakingUntil + 11_000 && t - (target.spokeAt || 0) > 2500 && this.rnd() < dt / 4) {
          // v39: a friend walking with you talks now and then on their own ("come on", "this way", your name)
          this.say(mm, t, this.pick(target, mm.as, "call", true, mm), 200);
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
          if (near) this.face(mm, Math.atan2(-(near.x - mm.x), -(near.z - mm.z)) + Math.sin(t / 1300) * 0.5, dt, 2.5);
        }
        // someone wanders off alone while waiting: easy prey
        const lone = this.open().find((m) => this.other(mm, m) && this.loneliness(m) > 10 && Math.hypot(m.x - mm.x, m.z - mm.z) < 6 && this.lookAway(m, mm.x, mm.z) > 1.75);
        if (lone && !this.open().some((m) => m !== lone && this.los(m.x, m.z, mm.x, mm.z, 14))) this.reveal(mm, lone, t);
        break;
      }
      case "chase": {
        if (!target) { this.flee(mm, t, 8); break; }
        const d = Math.hypot(target.x - mm.x, target.z - mm.z);
        if (t < mm.windUp) { this.face(mm, Math.atan2(-(target.x - mm.x), -(target.z - mm.z)), dt, 12); mm.speed = 0; break; }
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

  /** Listening: someone talking inside a locker close by, or running nearby, draws it in. */
  private listen(mm: Mimic, t: number) {
    if ((mm.state !== "wander" && mm.state !== "search") || mm.carry !== null) return;
    for (const m of this.alive()) {
      if (!this.other(mm, m)) continue;
      const d = Math.hypot(m.x - mm.x, m.z - mm.z);
      if (d > 16) continue;
      const walls = echoWallsBetween(mm.x, mm.z, m.x, m.z);
      if (m.hidden !== null) {
        if (m.talk && d < HIDE.HEAR && walls <= 1) { mm.saw.add(m.n); mm.state = "stalk"; mm.target = m.n; mm.until = t + 30_000; mm.path = []; return; }
        continue;
      }
      if (t - m.loudAt < 400 && walls <= 1 && t >= mm.nextHunt - 20_000) { this.hunt(mm, m, t); if ((mm.state as MimicState) === "stalk") return; }
    }
  }

  /** It lost sight of its prey (into a locker it didn't see): looks around where it is, then wanders off. */
  private lose(mm: Mimic, t: number) {
    mm.target = null;
    mm.pendingSay = null;
    mm.state = "search";
    mm.look = { kind: this.rnd() < 0.5 ? "circle" : "sweep", base: mm.yaw, from: t, to: t + 3500 + this.rnd() * 2500 };
    mm.path = [];
    mm.nextHunt = Math.max(mm.nextHunt, t + 15_000);
  }

  /** Walk to the locker it saw them get into, and tear it open. */
  private goYank(mm: Mimic, target: Member, dt: number, t: number) {
    const locker = target.hidden!;
    const f = lockerFront(locker, 0.7);
    const d = Math.hypot(f.x - mm.x, f.z - mm.z);
    if (d < 1.1) {
      this.ev.event({ type: "yank", n: target.n, mimic: mm.id, locker });
      this.moment(t, `${mm.as && !mimicRevealed(mm.state) ? `"${this.nameOf(mm.as)}"` : "The creature"} tore open a locker in ${the(roomName(f.x, f.z))}. ${target.name} was inside.`, 3);
      this.unhide(target);
      if (!mimicRevealed(mm.state)) this.ev.event({ type: "reveal", mimic: mm.id, as: mm.as });
      this.take(mm, target, t);
      return;
    }
    if (this.clearLine(mm.x, mm.z, f.x, f.z) && d < 6) { mm.path = []; this.stepTo(mm, f.x, f.z, COPY.WALK, dt); return; }
    const goal: [number, number] = [echoTileOf(f.x), echoTileOf(f.z)];
    const last = mm.path[mm.path.length - 1];
    if (!last || last[0] !== goal[0] || last[1] !== goal[1]) mm.path = echoPath(this.tileOf(mm), goal);
    this.walk(mm, this.watched(mm.x, mm.z, 22) ? COPY.WALK : COPY.HURRY * this.fury(), dt);
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

  /** Take fuse `f` and walk it somewhere far from the box to hide it. */
  private carryAway(mm: Mimic, f: EchoGoal["fuses"][number]) {
    f.by = -mm.id; mm.carry = f.id;
    mm.stealFrom = roomName(f.x, f.z);
    const far = GOAL.SPOTS.filter(([x, , z]) => Math.hypot(x - f.x, z - f.z) > 12 && roomName(x, z) !== mm.stealFrom && Math.hypot(x - GOAL.BOX.x, z - GOAL.BOX.z) > 12 && !this.goal.fuses.some((o) => o !== f && Math.hypot(o.x - x, o.z - z) < 1));
    const [sx, , sz] = far.length ? far[Math.floor(this.rnd() * far.length)] : GOAL.SPOTS[0];
    mm.stealTo = [echoTileOf(sx), echoTileOf(sz)];
    mm.path = echoPath(this.tileOf(mm), mm.stealTo);
    mm.state = "wander";
    mm.fetch = null;
    this.pushMeta();
  }

  /** v39: choose a fuse to go for, walk to it, and take it when nobody is watching. True while busy with it. */
  private fetchStep(mm: Mimic, t: number, dt: number): boolean {
    const g = this.goal;
    if (mm.carry !== null || mm.stealTo || !g.startedAt || this.stolen >= COPY.STEALS) { mm.fetch = null; return false; }
    if (!mm.fetch) {
      if (t < (mm.nextFetch ?? 0)) return false;
      mm.nextFetch = t + 6000 + this.rnd() * 6000;
      const near = (x: number, z: number, r: number) => this.open().some((m) => Math.hypot(m.x - x, m.z - z) < r);
      const loose = g.fuses.filter((f) => !f.placed && f.by === null && !g.pry.some((p) => p[1] === f.id) && !near(f.x, f.z, 7));
      const boxed = !g.power && !near(GOAL.BOX.x, GOAL.BOX.z, 12) && !this.watched(GOAL.BOX.x, GOAL.BOX.z, 16) ? g.fuses.filter((f) => f.placed) : [];
      const pick = [...loose.map((f) => ({ f, box: false })), ...boxed.map((f) => ({ f, box: true }))]
        .map((o) => ({ ...o, d: Math.hypot(o.f.x - mm.x, o.f.z - mm.z) + (o.box ? -15 : 0) })) // the box is the cruellest place to take one from
        .filter((o) => o.d < 45).sort((a, b) => a.d - b.d)[0];
      if (!pick || this.rnd() < 0.35) return false;
      mm.fetch = { fuse: pick.f.id, box: pick.box };
      mm.path = echoPath(this.tileOf(mm), [echoTileOf(pick.f.x), echoTileOf(pick.f.z)]);
    }
    const f = g.fuses[mm.fetch.fuse];
    // gone, picked up, or (for the box) someone is there now: give up
    if (!f || f.by !== null || f.placed !== mm.fetch.box || (mm.fetch.box && g.power)) { mm.fetch = null; return false; }
    const d = Math.hypot(f.x - mm.x, f.z - mm.z);
    if (d > 1.3) {
      if (!mm.path.length) mm.path = echoPath(this.tileOf(mm), [echoTileOf(f.x), echoTileOf(f.z)]);
      if (!mm.path.length) { mm.fetch = null; return false; }
      this.walk(mm, this.watched(mm.x, mm.z, 22) ? COPY.WALK : COPY.HURRY, dt);
      return true;
    }
    if (this.watched(mm.x, mm.z, 14)) { mm.fetch = null; mm.nextFetch = t + 8000; return false; } // someone can see: not now
    if (mm.fetch.box) {
      Object.assign(f, { placed: false, x: GOAL.BOX.x, y: 0.05, z: GOAL.BOX.z });
      g.placed = Math.max(0, g.placed - 1);
      this.ev.event({ type: "unplug", fuse: f.id });
      this.moment(t, `The Copy, wearing ${this.nameOf(mm.as)}'s face, pulled a fuse back out of the box and hid it.`, 3);
    }
    this.carryAway(mm, f);
    return true;
  }

  private startSearch(mm: Mimic, t: number) {
    mm.gait = 0.9 + this.rnd() * 0.16;
    // where it goes next: usually a place a fuse could be, sometimes just another room
    const spots = GOAL.SPOTS.filter(([x, , z]) => { const d = Math.hypot(x - mm.x, z - mm.z); return d > 6 && d < 34; });
    let dest: [number, number];
    const lockers = ECHO_LOCKERS.map((_, i) => lockerFront(i)).filter((f) => { const d = Math.hypot(f.x - mm.x, f.z - mm.z); return d > 6 && d < 30; });
    const r = this.rnd();
    if (spots.length && r < 0.55) { const [x, , z] = spots[Math.floor(this.rnd() * spots.length)]; dest = [echoTileOf(x), echoTileOf(z)]; }
    else if (lockers.length && r < 0.75) { const f = lockers[Math.floor(this.rnd() * lockers.length)]; dest = [echoTileOf(f.x), echoTileOf(f.z)]; }
    else dest = this.farTile(6);
    const here = GOAL.SPOTS.find(([x, , z]) => Math.hypot(x - mm.x, z - mm.z) < 2.5);
    // first look around where it stands (if it just arrived somewhere)
    if (mm.look.to < t - 1000) {
      const dur = 2500 + this.rnd() * 3000;
      const circle = this.rnd() < 0.3;
      mm.look = { kind: circle ? "circle" : "sweep", base: mm.yaw, from: t, to: t + dur };
      mm.crouch = !!here && here[1] < 0.9 ? this.rnd() < 0.8 : this.rnd() < 0.3;
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
    const gone = !this.practice && (forGood || target.strikes >= COPY.STRIKES);
    target.takenUntil = gone ? Infinity : t + COPY.BACK_SEC * 1000;
    if (gone) { target.gone = true; this.goal.gone = [...new Set([...this.goal.gone, target.n])]; }
    this.takenCount++;
    this.dropFuse(target);
    if (!this.practice) this.dropGun(target);
    this.unhide(target, false);
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
    for (const m of this.open()) {
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
        const witness = this.open().some((o) => o !== m && this.los(o.x, o.z, mm.x, mm.z, 14));
        if (d < 5 && !witness && this.other(mm, m)) { this.reveal(mm, m, t); return true; }
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
  private pick(target: Member, owner: number, kind: "call" | "answer", commit = true, from?: { x: number; z: number }): string[] {
    // v36: everyone close enough to hear it must hold the piece — a friend beside the target must not see a mouth move in silence
    const ears = from ? this.open().filter((m) => m === target || Math.hypot(m.x - from.x, m.z - from.z) < ECHO.VOICE_RANGE + 2) : [target];
    const pool = [...this.clips.values()].filter((c) => (!c.used || this.practice) && c.owner === owner && (this.practice || c.owner !== target.n) && ears.every((e) => c.have.has(e.n)));
    if (!pool.length) return [];
    // v36: score every piece for what it has to do, and stay quiet rather than play a bad one
    const t = this.now();
    const W: Record<string, number> = kind === "answer" ? { here: 4, short: 2, call: 1, question: -3, panic: -2, laugh: -2 } : { call: 3, found: 2, here: 1, question: 1, panic: -1, laugh: -2 };
    const ideal = kind === "answer" ? 900 : 1500;
    const score = (c: Clip) => {
      let v = 0;
      for (const tag of c.tags) v += W[tag] ?? 0;
      if (c.tags.includes(`name:${target.n}`)) v += kind === "call" ? 4 : 1;
      if (c.tags.some((x) => x.startsWith("name:") && x !== `name:${target.n}`)) v -= 2; // talking to somebody else
      if (c.tags.includes(`name:${owner}`)) v -= 3; // people rarely say their own name
      v -= Math.abs(c.ms - ideal) / 600;
      const age = (t - c.at) / 1000;
      if (c.heardBy?.has(target.n) && !this.practice) v -= age < 60 ? 3 : 1; // they heard that exact take
      v += age > 20 && age < 240 ? 1 : age > 480 ? -1 : 0;
      if (c.used) v -= 2.5; // practice may reuse pieces, but not the same one every time
      if (c.tags.includes("found") && (c.placedThen ?? 0) < this.goal.placed) v -= 2; // old news
      if (c.tags.includes("found") && this.goal.placed >= GOAL.FUSES) v -= 3;
      return v + this.rnd() * 0.6;
    };
    const ranked = pool.map((c) => ({ c, v: score(c) })).sort((a, b) => b.v - a.v);
    const best = ranked[0];
    if (!best || best.v < (this.practice ? -99 : -1.5)) return [];
    let chosen: Clip[] = [best.c];
    // a name and a call said in the same breath can be joined (same moment, same mood); never two unrelated takes
    if (kind === "call") {
      const name = ranked.find((r) => r.v > 1 && r.c.tags.includes(`name:${target.n}`) && !r.c.tags.includes("call"))?.c;
      const call = name ? ranked.find((r) => r.v > 1 && r.c !== name && r.c.tags.includes("call") && Math.abs(r.c.at - name.at) < 20_000 && name.ms + r.c.ms < 4000)?.c : null;
      if (name && call) chosen = [name, call];
    }
    if (commit) chosen.forEach((c) => { c.used = true; });
    return chosen.map((c) => c.key);
  }

  // ───────── moving ─────────
  private tileOf(mm: Mimic): [number, number] { return [echoTileOf(mm.x), echoTileOf(mm.z)]; }

  /** Where in a tile it aims for: not dead centre (nobody walks the exact middle of every room), but steady per tile. */
  private pt(mm: Mimic, [tx, tz]: [number, number]): [number, number] {
    const h = Math.imul(tx * 73856093 ^ tz * 19349663 ^ mm.id * 83492791, 2654435761) >>> 0;
    const jx = ((h & 0xffff) / 0xffff - 0.5) * 1.3, jz = ((h >>> 16) / 0xffff - 0.5) * 1.3;
    const x = center(tx) + jx, z = center(tz) + jz;
    return echoFree(x, z) && echoTileOf(x) === tx && echoTileOf(z) === tz ? [x, z] : [center(tx), center(tz)];
  }

  /** A body (0.35 m each side) could walk this straight line: no wall, and not shaving a door frame. */
  private clearLine(ax: number, az: number, bx: number, bz: number) {
    const d = Math.hypot(bx - ax, bz - az);
    if (d < 0.01) return true;
    const ox = (-(bz - az) / d) * 0.35, oz = ((bx - ax) / d) * 0.35;
    return echoWallsBetween(ax, az, bx, bz) === 0 && echoWallsBetween(ax + ox, az + oz, bx + ox, bz + oz) === 0 && echoWallsBetween(ax - ox, az - oz, bx - ox, bz - oz) === 0;
  }

  /** v39: the movement it replays — the face it wears decides whose habits. */
  private mirrorOf(mm: Mimic, t: number) {
    const st = this.styles.get(mm.as);
    if (!mm.mirror) mm.mirror = { look: st?.look(t, this.rnd) ?? defaultLook(this.rnd), li: 0, pace: 0, paceUntil: 0, stop: null, si: 0, stopYaw: 0 };
    const mr = mm.mirror;
    if (t >= mr.paceUntil) { mr.pace = Math.max(1.1, Math.min(3, st?.speed(t, this.rnd) ?? 1.7 + this.rnd() * 0.8)); mr.paceUntil = t + 2500 + this.rnd() * 4000; }
    return mr;
  }

  /** Follow the path like a person: cut corners when the way is clear, glide through doors, ease into the last step. */
  private walk(mm: Mimic, speed: number, dt: number) {
    const t = this.now();
    // v39: in a friend's skin it walks, pauses and looks around the way that friend really does
    const human = !mimicRevealed(mm.state);
    const mr = human ? this.mirrorOf(mm, t) : null;
    if (mr?.stop) {
      const i = Math.floor(mr.si);
      mm.speed = Math.max(0, mm.speed - 6 * dt);
      if (i >= mr.stop.yaw.length || mm.state !== "wander" && mm.state !== "search") { mr.stop = null; mm.head = mm.yaw; }
      else { mm.yaw = Math.atan2(Math.sin(mr.stopYaw + mr.stop.yaw[i]), Math.cos(mr.stopYaw + mr.stop.yaw[i])); mm.pitch = mr.stop.pitch[i]; mr.si += dt * MOTION_HZ; return; }
    }
    if (mr && speed <= COPY.WALK * 1.05) speed = mr.pace;
    while (mm.path.length >= 2) {
      const [nx, nz] = this.pt(mm, mm.path[1]);
      if (!this.clearLine(mm.x, mm.z, nx, nz)) break;
      mm.path.shift();
    }
    if (!mm.path.length) { mm.speed = Math.max(0, mm.speed - 5 * dt); return; }
    const last = mm.path.length === 1;
    const [px, pz] = this.pt(mm, mm.path[0]);
    if (Math.hypot(px - mm.x, pz - mm.z) < (last ? 0.25 : 0.8)) { mm.path.shift(); if (!mm.path.length) return; }
    const [qx, qz] = this.pt(mm, mm.path[0]);
    this.steer(mm, qx, qz, speed * mm.gait, dt, mm.path.length === 1 ? 1.4 : 0);
    if (mr) {
      // the view wanders off the heading like a real player's mouse (less of it when hurrying)
      const i = Math.floor(mr.li), k = speed > COPY.WALK * 1.2 ? 0.35 : 1;
      if (i >= mr.look.yaw.length) { mr.look = this.styles.get(mm.as)?.look(t, this.rnd) ?? defaultLook(this.rnd); mr.li = 0; }
      else { mm.yaw = Math.atan2(Math.sin(mm.head + mr.look.yaw[i] * k), Math.cos(mm.head + mr.look.yaw[i] * k)); mm.pitch = mr.look.pitch[i] * k; mr.li += dt * MOTION_HZ; }
      // and now and then it stops to look around, as often as that friend stops
      if ((mm.state === "wander" || mm.state === "search") && mm.carry === null) {
        const rate = this.styles.get(mm.as)?.stopRate(t) ?? 1 / 22;
        if (this.rnd() < Math.min(0.2, rate * mm.speed * dt)) { mr.stop = this.styles.get(mm.as)?.stop(t, this.rnd) ?? defaultStop(this.rnd); mr.si = 0; mr.stopYaw = mm.yaw; }
      }
    }
  }

  /** Head for (x, z) like a body: turns at a human rate (slowing for sharp turns), speeds up and eases off. */
  private steer(mm: Mimic, x: number, z: number, speed: number, dt: number, arrive = 0) {
    const dx = x - mm.x, dz = z - mm.z, d = Math.hypot(dx, dz);
    if (d < 0.02) { mm.speed = Math.max(0, mm.speed - 5 * dt); return; }
    const want = Math.atan2(-dx, -dz);
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const rate = speed > 4 ? 7.5 : 4.5;
    mm.head += Math.max(-rate * dt, Math.min(rate * dt, wrap(want - mm.head)));
    mm.head = wrap(mm.head);
    const align = Math.cos(wrap(want - mm.head));
    let target = (mm.crouch ? Math.min(speed, ECHO.CROUCH) : speed) * Math.max(0.12, align);
    if (arrive > 0 && d < arrive) target = Math.min(target, speed * (d / arrive) + 0.25);
    const acc = target > mm.speed ? (speed > 4 ? 7 : 3) : 6;
    mm.speed += Math.max(-acc * dt, Math.min(acc * dt, target - mm.speed));
    const s = Math.min(d, mm.speed * dt);
    let nx = mm.x - Math.sin(mm.head) * s, nz = mm.z - Math.cos(mm.head) * s;
    if (!echoPassable(mm.x, mm.z, nx, nz) || !echoFree(nx, nz)) {
      // the curve would clip a wall: straight at the target instead
      nx = mm.x + (dx / d) * s; nz = mm.z + (dz / d) * s;
      if (!echoPassable(mm.x, mm.z, nx, nz) || !echoFree(nx, nz)) { mm.speed *= 0.5; return; }
      mm.head = want;
    }
    mm.x = nx;
    mm.z = nz;
    mm.yaw = mm.head;
  }

  /** Turn the body toward an angle at `rate` rad/s. */
  private face(mm: Mimic, yaw: number, dt: number, rate: number) {
    const d = Math.atan2(Math.sin(yaw - mm.yaw), Math.cos(yaw - mm.yaw));
    mm.yaw += Math.max(-rate * dt, Math.min(rate * dt, d));
    mm.head = mm.yaw;
  }

  /** Straight at a point (chasing, closing the gap). */
  private stepTo(mm: Mimic, x: number, z: number, speed: number, dt: number) { this.steer(mm, x, z, speed, dt, 0.8); }

  /** A small step without turning (backing off a little). */
  private nudge(mm: Mimic, x: number, z: number, speed: number, dt: number) {
    const dx = x - mm.x, dz = z - mm.z, d = Math.hypot(dx, dz);
    if (d < 1e-3) return;
    const s = Math.min(d, speed * dt), nx = mm.x + (dx / d) * s, nz = mm.z + (dz / d) * s;
    if (echoPassable(mm.x, mm.z, nx, nz) && echoFree(nx, nz)) { mm.x = nx; mm.z = nz; }
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
      practice: this.practice || undefined,
    };
  }

  snapshot(): EchoSnap2 {
    const t = this.now();
    return {
      t,
      p: this.members.map((m) => [m.n, Math.round(m.x * 100), Math.round(m.y * 100), Math.round(m.z * 100), Math.round(m.yaw * 1000), Math.round(m.pitch * 1000), (m.torch ? 1 : 0) | (m.crouch ? 2 : 0) | (m.taken ? ECHO_TAKEN : 0) | (m.talk && !m.taken ? ECHO_TALK : 0) | (m.radio && !m.taken ? ECHO_RADIO : 0) | (m.hidden !== null ? ECHO_HIDDEN : 0) | (this.goal.gun.by === m.n ? ECHO_ARMED : 0)]),
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
