import type { LookSnippet, StopSnippet } from "./motion.js";

/**
 * v40 — the Copy's long memory. It survives between matches and server restarts (one JSON row in Postgres),
 * and gets better the more people play:
 *
 *  1. MOVES: anonymous movement clips harvested from every match (how real players walk, look around and stop —
 *     positions and view angles only, never voice, never names). Each clip has a weight; clips the Copy was using
 *     when it fooled someone gain weight, clips it was using when it got caught lose weight.
 *  2. NEW MOVES: when it draws a clip it often makes a new variation — mirrored, faster or slower, bigger or smaller,
 *     or two real clips stitched together — so it is not just replaying, and the good variations get saved back.
 *  3. TRICKS: a few of its choices are "arms" of a bandit (Thompson sampling). Every attempt is scored: did the
 *     attack land, did the stolen fuse stay hidden, did talking more lead to a grab? What works is chosen more.
 *
 * Nothing here can identify a player; players can switch it off in the lobby.
 */

export type MoveKind = "look" | "stop";
export interface MoveClip { id: number; k: MoveKind; yaw: number[]; pitch: number[]; w: number; n: number; born: number; made?: boolean }
interface Arm { n: number; w: number }
export type Decision = "attackAt" | "fuses" | "talk";
export const ARMS: Record<Decision, readonly string[]> = {
  /** How close it lets you get before it shows itself (m). */
  attackAt: ["2.4", "3.2", "4.0"],
  /** What it does with spare time: go for fuses (box first / loose first) or keep hunting. */
  fuses: ["box", "loose", "hunt"],
  /** How chatty it is in a friend's voice. */
  talk: ["quiet", "normal", "chatty"],
};

interface Saved { v: 1; nextId: number; matches: number; moves: MoveClip[]; speeds: number[]; stops: [number, number]; arms: Record<string, Arm> }

const MAX_PER_KIND = 700;
const q = (a: number[]) => a.map((x) => Math.round(x * 100) / 100);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class CopyBrain {
  private s: Saved = { v: 1, nextId: 1, matches: 0, moves: [], speeds: new Array(30).fill(0), stops: [0, 0], arms: {} };
  private db: { $executeRawUnsafe: (q: string, ...v: unknown[]) => Promise<unknown>; $queryRawUnsafe: <T>(q: string, ...v: unknown[]) => Promise<T> } | null = null;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Plug in the database (once at boot) and load what it learned before. */
  async load(db: unknown) {
    this.db = (db as typeof this.db) ?? null;
    if (!this.db) return;
    try {
      await this.db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS echo_brain (key text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
      const rows = await this.db.$queryRawUnsafe<{ data: Saved }[]>(`SELECT data FROM echo_brain WHERE key = 'copy'`);
      if (rows[0]?.data?.v === 1) this.s = { ...this.s, ...rows[0].data };
      console.log(`[echo brain] ${this.s.matches} matches, ${this.s.moves.length} moves`);
    } catch (e) { console.error("[echo brain] load failed:", (e as Error).message); }
  }

  private touch() {
    this.dirty = true;
    if (this.timer || !this.db) return;
    this.timer = setTimeout(() => { this.timer = null; void this.save(); }, 30_000);
    this.timer.unref?.();
  }
  async save() {
    if (!this.db || !this.dirty) return;
    this.dirty = false;
    try { await this.db.$executeRawUnsafe(`INSERT INTO echo_brain (key, data, updated_at) VALUES ('copy', $1::jsonb, now()) ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, JSON.stringify(this.s)); }
    catch (e) { console.error("[echo brain] save failed:", (e as Error).message); this.dirty = true; }
  }

  get stats() { return { matches: this.s.matches, moves: this.s.moves.length }; }

  // ───────── moves ─────────
  /** After a match: keep what real players did. */
  learnMatch(input: { looks: LookSnippet[]; stops: StopSnippet[]; speeds: number[]; stopCount: number; meters: number }, rnd: () => number, countMatch = true) {
    const t = Date.now();
    for (const l of input.looks) this.addMove({ k: "look", yaw: q(l.yaw), pitch: q(l.pitch), w: 1, n: 0, born: t }, rnd);
    for (const s of input.stops) this.addMove({ k: "stop", yaw: q(s.yaw), pitch: q(s.pitch), w: 1, n: 0, born: t }, rnd);
    for (const v of input.speeds) this.s.speeds[Math.max(0, Math.min(29, Math.floor(v * 10)))]++;
    this.s.stops[0] += input.stopCount; this.s.stops[1] += input.meters;
    if (countMatch) this.s.matches++;
    this.touch();
  }

  private addMove(m: Omit<MoveClip, "id">, rnd: () => number) {
    if (m.yaw.length < 8) return;
    const same = this.s.moves.filter((x) => x.k === m.k);
    if (same.length >= MAX_PER_KIND) {
      // forget one of the weakest (old, low weight) — the library keeps improving instead of just growing
      let worst = -1, ws = Infinity;
      for (let i = 0; i < 24; i++) { const c = same[Math.floor(rnd() * same.length)]; const sc = c.w - (Date.now() - c.born) / 864e5 * 0.05; if (sc < ws) { ws = sc; worst = c.id; } }
      this.s.moves = this.s.moves.filter((x) => x.id !== worst);
    }
    this.s.moves.push({ ...m, id: this.s.nextId++ });
  }

  /** A walking speed real players use (m/s), or null before anything was learned. */
  speed(rnd: () => number): number | null {
    const tot = this.s.speeds.reduce((a, b) => a + b, 0);
    if (tot < 200) return null;
    let r = rnd() * tot;
    for (let i = 0; i < 30; i++) { r -= this.s.speeds[i]; if (r <= 0) return (i + rnd()) / 10; }
    return null;
  }
  stopRate(): number | null { return this.s.stops[1] > 300 ? this.s.stops[0] / this.s.stops[1] : null; }

  /**
   * A move to use: weighted by how well it worked, and often a NEW variation of it. Returns the clip ids it is made
   * of (for credit later) and the curves.
   */
  move(k: MoveKind, rnd: () => number): { ids: number[]; yaw: number[]; pitch: number[] } | null {
    const pool = this.s.moves.filter((x) => x.k === k);
    if (pool.length < 10) return null;
    const pick = () => { const tot = pool.reduce((a, c) => a + Math.max(0.05, c.w), 0); let r = rnd() * tot; for (const c of pool) { r -= Math.max(0.05, c.w); if (r <= 0) return c; } return pool[pool.length - 1]; };
    const a = pick();
    a.n++;
    let yaw = a.yaw, pitch = a.pitch;
    const ids = [a.id];
    const roll = rnd();
    if (roll < 0.15) { yaw = yaw.map((y) => -y); } // mirrored: the same habit, the other way
    else if (roll < 0.3) { const f = 0.8 + rnd() * 0.45; [yaw, pitch] = [warp(yaw, f), warp(pitch, f)]; } // faster or slower
    else if (roll < 0.4) { const g = 0.75 + rnd() * 0.45; yaw = yaw.map((y) => y * g); } // bigger or smaller
    else if (roll < 0.55) {
      // two real moves stitched into one that nobody did
      const b = pick(); ids.push(b.id);
      const cut = Math.floor(yaw.length * (0.35 + rnd() * 0.3)), off = k === "stop" ? yaw[cut - 1] - (b.yaw[0] ?? 0) : 0;
      yaw = [...yaw.slice(0, cut), ...b.yaw.map((y) => wrap(y + off))]; pitch = [...pitch.slice(0, cut), ...b.pitch];
      yaw = blend(yaw, cut); pitch = blend(pitch, cut);
    }
    return { ids, yaw, pitch };
  }

  /** The Copy fooled someone (or got caught) while using these moves. Good stitched variations are kept as new moves. */
  credit(ids: number[], reward: number, made: { k: MoveKind; yaw: number[]; pitch: number[] } | null, rnd: () => number) {
    for (const id of ids) { const c = this.s.moves.find((x) => x.id === id); if (c) c.w = Math.max(0.05, Math.min(20, c.w + reward)); }
    if (made && reward > 0 && ids.length > 1) this.addMove({ k: made.k, yaw: q(made.yaw), pitch: q(made.pitch), w: 1 + reward, n: 0, born: Date.now(), made: true }, rnd);
    this.touch();
  }

  // ───────── tricks (Thompson sampling) ─────────
  choose(d: Decision, rnd: () => number): string {
    let best = ARMS[d][0], bv = -1;
    for (const a of ARMS[d]) {
      const arm = this.s.arms[`${d}:${a}`] ?? { n: 0, w: 0 };
      const v = beta(arm.w + 1, arm.n - arm.w + 1, rnd);
      if (v > bv) { bv = v; best = a; }
    }
    return best;
  }
  /** `win` from 0 to 1. */
  score(d: Decision, arm: string, win: number) {
    const k = `${d}:${arm}`;
    const a = this.s.arms[k] ?? { n: 0, w: 0 };
    // old results fade a little, so it keeps adapting as players learn its tricks
    a.n = a.n * 0.995 + 1; a.w = a.w * 0.995 + Math.max(0, Math.min(1, win));
    this.s.arms[k] = a;
    this.touch();
  }
  arms() { return this.s.arms; }
}

function warp(a: number[], f: number) { const n = Math.max(4, Math.round(a.length / f)), out: number[] = []; for (let i = 0; i < n; i++) { const x = (i * (a.length - 1)) / (n - 1), j = Math.floor(x), t = x - j; out.push(a[j] * (1 - t) + (a[Math.min(a.length - 1, j + 1)] ?? a[j]) * t); } return out; }
function blend(a: number[], at: number) { const out = [...a]; for (let k = -2; k <= 2; k++) { const i = at + k; if (i > 0 && i < out.length - 1) out[i] = (out[i - 1] + out[i] + out[i + 1]) / 3; } return out; }
/** A sample from Beta(a, b) — via two gamma draws. */
function beta(a: number, b: number, rnd: () => number) { const x = gamma(a, rnd), y = gamma(b, rnd); return x / (x + y); }
function gamma(k: number, rnd: () => number): number {
  if (k < 1) return gamma(k + 1, rnd) * Math.pow(rnd(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do { const u1 = Math.max(1e-9, rnd()), u2 = rnd(); x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); v = 1 + c * x; } while (v <= 0);
    v = v * v * v; const u = rnd();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** One brain for the whole server. */
export const copyBrain = new CopyBrain();
