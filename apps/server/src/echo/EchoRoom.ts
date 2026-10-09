import { ECHO, ECHO_COLORS, echoFree, echoSpawns, type EchoMeta, type EchoSnap, type EchoState } from "@monumental/shared";

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
  at: number;
  online: boolean;
}

export interface EchoEvents {
  meta: (m: EchoMeta) => void;
  snap: (s: EchoSnap) => void;
  onIdle: () => void;
}

/** One ECHO HALLS room (Phase 1): who is in it and where they stand. Clients move themselves; the server checks the moves are possible. */
export class EchoRoom {
  private members: Member[] = [];
  private nextN = 1;
  private loop: ReturnType<typeof setInterval> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(public readonly code: string, private hostId: string, private ev: EchoEvents, private now: () => number = Date.now) {
    this.scheduleIdle();
  }

  join(id: string, name: string): { ok: true; n: number; spawn: { x: number; z: number } } | { ok: false; error: string } {
    let m = this.members.find((x) => x.id === id);
    if (!m) {
      if (this.members.length >= ECHO.MAX_PLAYERS) return { ok: false, error: `Room is full (${ECHO.MAX_PLAYERS} players)` };
      const spawns = echoSpawns();
      const s = spawns[this.members.length % spawns.length];
      const used = new Set(this.members.map((x) => x.color));
      const color = ECHO_COLORS.find((c) => !used.has(c)) ?? ECHO_COLORS[0];
      m = { id, n: this.nextN++, name: name.slice(0, 20) || "Player", color, x: s.x, y: 0, z: s.z, yaw: 0, pitch: 0, torch: true, crouch: false, at: this.now(), online: true };
      this.members.push(m);
    } else {
      m.online = true;
      m.name = name.slice(0, 20) || m.name;
    }
    if (!this.members.some((x) => x.id === this.hostId)) this.hostId = id;
    this.clearIdle();
    this.startLoop();
    this.pushMeta();
    return { ok: true, n: m.n, spawn: { x: m.x, z: m.z } };
  }

  leave(id: string) {
    const i = this.members.findIndex((x) => x.id === id);
    if (i < 0) return;
    this.members.splice(i, 1);
    if (this.hostId === id && this.members.length) this.hostId = this.members[0].id;
    this.pushMeta();
    if (!this.members.length) { this.stopLoop(); this.scheduleIdle(); }
  }

  /** Wire number of a member, or undefined. */
  numberOf(id: string) { return this.members.find((x) => x.id === id)?.n; }
  idOf(n: number) { return this.members.find((x) => x.n === n)?.id; }

  /** A client's own position. Accepted when it is a believable move; otherwise ignored. */
  state(id: string, s: EchoState): boolean {
    const m = this.members.find((x) => x.id === id);
    if (!m) return false;
    const t = this.now();
    const dt = Math.min(1, Math.max(0.001, (t - m.at) / 1000));
    const dist = Math.hypot(s.x - m.x, s.z - m.z);
    m.yaw = s.yaw;
    m.pitch = Math.max(-1.6, Math.min(1.6, s.pitch));
    m.torch = s.torch;
    m.crouch = s.crouch;
    if (dist > ECHO.SPRINT * dt * 1.5 + 1 || !echoFree(s.x, s.z)) return false;
    m.x = s.x;
    m.y = Math.max(-0.5, Math.min(1, s.y));
    m.z = s.z;
    m.at = t;
    return true;
  }

  meta(): EchoMeta {
    return { code: this.code, hostId: this.hostId, players: this.members.map((m) => ({ id: m.id, n: m.n, name: m.name, color: m.color })), serverNow: this.now() };
  }

  snapshot(): EchoSnap {
    return {
      t: this.now(),
      p: this.members.map((m) => [m.n, Math.round(m.x * 100), Math.round(m.y * 100), Math.round(m.z * 100), Math.round(m.yaw * 1000), Math.round(m.pitch * 1000), (m.torch ? 1 : 0) | (m.crouch ? 2 : 0)]),
    };
  }

  get size() { return this.members.length; }

  private pushMeta() { if (!this.destroyed) this.ev.meta(this.meta()); }
  private startLoop() {
    if (this.loop || this.destroyed) return;
    this.loop = setInterval(() => { if (!this.destroyed) this.ev.snap(this.snapshot()); }, ECHO.SNAP_MS);
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
