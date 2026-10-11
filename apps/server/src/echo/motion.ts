/**
 * v39 "Motion Mirror": the Copy learns to move from the real players in the match.
 *
 * Every player's own movement (position, where they look, crouching — never audio) is kept for a few minutes.
 * From it we take, per player:
 *   - how fast they really walk (their own speed habits, not a constant),
 *   - how they look around while they walk (the mouse: yaw/pitch offsets from where they are heading),
 *   - how often they stop, for how long, and how they turn their head while stopped.
 * When the Copy wears someone's face it replays short real snippets of THAT person's movement on top of its path,
 * so it walks, pauses and looks around the way they do (motion matching on live data). With no data yet it uses
 * a human-like default.
 */

export interface MotionSample { t: number; x: number; z: number; yaw: number; pitch: number; crouch: boolean }
export interface LookSnippet { yaw: number[]; pitch: number[] }
export interface StopSnippet { yaw: number[]; pitch: number[] }

const HZ = 10;
const STEP = 1000 / HZ;
const KEEP = HZ * 60 * 4; // four minutes
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class MotionStyle {
  private s: MotionSample[] = [];
  private last = 0;
  /** Cached analysis, refreshed every few seconds. */
  private cache: { at: number; speeds: number[]; walkIdx: number[]; stops: [number, number][]; meters: number } | null = null;

  add(m: MotionSample) {
    if (m.t - this.last < STEP) return;
    this.last = m.t;
    this.s.push(m);
    if (this.s.length > KEEP) this.s.splice(0, this.s.length - KEEP);
  }

  get size() { return this.s.length; }

  private analyse(now: number) {
    if (this.cache && now - this.cache.at < 4000) return this.cache;
    const s = this.s, speeds: number[] = [], walkIdx: number[] = [], stops: [number, number][] = [];
    let meters = 0, stopFrom = -1;
    for (let i = 1; i < s.length; i++) {
      const dt = (s[i].t - s[i - 1].t) / 1000;
      if (dt <= 0 || dt > 0.6) { stopFrom = -1; continue; }
      const d = Math.hypot(s[i].x - s[i - 1].x, s[i].z - s[i - 1].z), v = d / dt;
      if (v > 6) continue; // a respawn or teleport
      meters += d;
      if (v > 0.5) {
        speeds.push(v);
        walkIdx.push(i);
        if (stopFrom >= 0 && i - stopFrom >= 6 && i - stopFrom < 120) stops.push([stopFrom, i]);
        stopFrom = -1;
      } else if (stopFrom < 0) stopFrom = i;
    }
    this.cache = { at: now, speeds, walkIdx, stops, meters };
    return this.cache;
  }

  /** A walking speed this person really used (m/s), or null without enough data. */
  speed(now: number, rnd: () => number): number | null {
    const a = this.analyse(now);
    if (a.speeds.length < 30) return null;
    // their usual pace, not their dashes: from the middle of what they did
    const sorted = [...a.speeds].sort((x, y) => x - y);
    return sorted[Math.floor((0.2 + rnd() * 0.6) * (sorted.length - 1))];
  }

  /** How many stops per metre walked. */
  stopRate(now: number): number | null {
    const a = this.analyse(now);
    if (a.meters < 40) return null;
    return a.stops.length / a.meters;
  }

  /** 4 s of how they looked around while walking: yaw offsets from their heading, and pitch. */
  look(now: number, rnd: () => number): LookSnippet | null {
    const a = this.analyse(now), s = this.s;
    if (a.walkIdx.length < 60) return null;
    for (let tries = 0; tries < 6; tries++) {
      const start = a.walkIdx[Math.floor(rnd() * a.walkIdx.length)];
      const yaw: number[] = [], pitch: number[] = [];
      for (let i = start; i < Math.min(s.length, start + HZ * 4); i++) {
        const dx = s[i].x - s[i - 1].x, dz = s[i].z - s[i - 1].z;
        if (Math.hypot(dx, dz) < 0.02) break;
        const heading = Math.atan2(-dx, -dz);
        yaw.push(Math.max(-1.4, Math.min(1.4, wrap(s[i].yaw - heading))));
        pitch.push(s[i].pitch);
      }
      if (yaw.length >= HZ * 2) return { yaw: smooth(yaw), pitch: smooth(pitch) };
    }
    return null;
  }

  /** One real stop: how their view turned (relative to where they stopped) and pitched, 10 per second. */
  stop(now: number, rnd: () => number): StopSnippet | null {
    const a = this.analyse(now), s = this.s;
    if (!a.stops.length) return null;
    const [from, to] = a.stops[Math.floor(rnd() * a.stops.length)];
    const base = s[from].yaw, yaw: number[] = [], pitch: number[] = [];
    for (let i = from; i < to; i++) { yaw.push(wrap(s[i].yaw - base)); pitch.push(s[i].pitch); }
    return { yaw, pitch };
  }
}

function smooth(a: number[]) { return a.map((_, i) => { let s = 0, n = 0; for (let k = -1; k <= 1; k++) { const v = a[i + k]; if (v !== undefined) { s += v; n++; } } return s / n; }); }

/** Human-like defaults while nobody has walked enough yet. */
export function defaultLook(rnd: () => number): LookSnippet {
  const yaw: number[] = [], pitch: number[] = [];
  const a1 = 0.25 + rnd() * 0.35, f1 = 0.6 + rnd() * 0.6, p1 = rnd() * 6, a2 = 0.1 + rnd() * 0.15, f2 = 2 + rnd() * 2;
  for (let i = 0; i < HZ * 4; i++) { const t = i / HZ; yaw.push(a1 * Math.sin(t * f1 + p1) + a2 * Math.sin(t * f2)); pitch.push(-0.08 + 0.08 * Math.sin(t * 0.9 + p1)); }
  return { yaw, pitch };
}
export function defaultStop(rnd: () => number): StopSnippet {
  const n = Math.floor(HZ * (1 + rnd() * 2.5)), yaw: number[] = [], pitch: number[] = [];
  const side = rnd() < 0.5 ? -1 : 1, amp = 0.6 + rnd() * 0.9;
  for (let i = 0; i < n; i++) { const k = i / n; const e = k * k * (3 - 2 * k); yaw.push(side * amp * Math.sin(e * Math.PI)); pitch.push(-0.1 * Math.sin(e * Math.PI)); }
  return { yaw, pitch };
}
export const MOTION_HZ = HZ;
