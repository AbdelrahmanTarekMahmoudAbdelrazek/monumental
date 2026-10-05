import {
  NEON,
  NEON_ARENAS,
  NEON_COLORS,
  NEON_POWERS,
  aimTurn,
  type NeonAction,
  type NeonCarSnap,
  type NeonMeta,
  type NeonPhase,
  type NeonPower,
  type NeonSettings,
  type NeonSnap,
} from "@monumental/shared";

interface Pt { x: number; y: number }
interface Car {
  id: string;
  nickname: string;
  isBot: boolean;
  connections: number;
  color: number;
  x: number;
  y: number;
  a: number;
  turn: number;
  /** Mouse/touch steering target angle (null = keyboard turn). */
  aim: number | null;
  boost: boolean;
  fuel: number;
  alive: boolean;
  /** Oldest first, head last. */
  trail: Pt[];
  len: number;
  power: NeonPower | null;
  powerUntil: number;
  score: number;
  kills: number;
  wins: number;
  /** Bot brain: re-think counter. */
  think: number;
  /** Smoothed steering −1…1. */
  steer: number;
  /** When a crashed car comes back (0 = not waiting). */
  respawnAt: number;
  /** Kills in the current life, and the best trail length ever. */
  lifeKills: number;
  best: number;
}

interface Gas { id: number; x: number; y: number }
interface PowerUp { id: number; x: number; y: number; kind: NeonPower }

type R = { ok: boolean; error?: string };
const ok: R = { ok: true };
const no = (error: string): R => ({ ok: false, error });

export interface NeonEvents {
  meta: (m: NeonMeta) => void;
  snap: (s: NeonSnap) => void;
  onIdle: () => void;
}

const BOT_NAMES = ["Blaze", "Volt", "Nova", "Comet", "Rex", "Zippy", "Turbo Tom", "Pixel", "Bolt", "Echo"];
const CELL = 120;

/** Distance² from point p to segment ab. */
function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

/** Server-authoritative NEON DRIFT arena. Runs at 20 ticks/s while anyone is playing. */
export class NeonEngine {
  private cars: Car[] = [];
  private phase: NeonPhase = "lobby";
  private size: number;
  private round = 0;
  private winnerId: string | null = null;
  private roundEndsAt = 0;
  private feed: { at: number; text: string }[] = [];
  private gas = new Map<number, Gas>();
  private powers = new Map<number, PowerUp>();
  private gasAdd: number[] = [];
  private gasDel: number[] = [];
  private nextId = 1;
  private tickNo = 0;
  private loop: ReturnType<typeof setInterval> | null = null;
  private hostTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  /** Spatial hash of trail segments: cell → [carIndex, pointIndex] pairs. */
  private grid = new Map<number, number[]>();

  constructor(
    readonly code: string,
    private hostId: string,
    private settings: NeonSettings,
    private ev: NeonEvents,
    private now: () => number = Date.now,
    private rnd: () => number = Math.random,
  ) {
    this.size = NEON_ARENAS[settings.arena];
    this.scheduleIdle();
  }

  // ───────────────────────── seats ─────────────────────────

  join(id: string, nickname: string): R {
    if (this.destroyed) return no("Arena closed");
    let c = this.cars.find((x) => x.id === id);
    if (!c) {
      const humans = this.cars.filter((x) => !x.isBot).length;
      if (humans >= NEON.MAX_PLAYERS) return no("Arena is full");
      // a human replaces a bot if the arena is crowded
      if (this.cars.length >= NEON.MAX_PLAYERS) this.removeOneBot();
      c = this.newCar(id, nickname, false);
      if (this.phase === "playing") c.respawnAt = this.now() + 800;
      this.cars.push(c);
    }
    c.nickname = nickname;
    c.connections++;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    if (id === this.hostId && this.hostTimer) { clearTimeout(this.hostTimer); this.hostTimer = null; }
    this.pushMeta();
    if (this.phase !== "lobby") this.sendSnap(true);
    return ok;
  }

  leave(id: string) {
    const c = this.cars.find((x) => x.id === id);
    if (!c) return;
    c.connections = Math.max(0, c.connections - 1);
    if (c.connections === 0) {
      if (c.alive) this.kill(c, null, "left the arena");
      this.cars = this.cars.filter((x) => x !== c);
    }
    if (id === this.hostId && !this.hostTimer) {
      this.hostTimer = setTimeout(() => {
        this.hostTimer = null;
        if (this.cars.some((x) => x.id === this.hostId && x.connections > 0)) return;
        const next = this.cars.find((x) => !x.isBot && x.connections > 0);
        if (next) { this.hostId = next.id; this.pushMeta(); }
      }, 15_000);
    }
    if (!this.cars.some((x) => !x.isBot && x.connections > 0)) {
      this.stopLoop();
      this.phase = "lobby";
      this.scheduleIdle();
    }
    this.pushMeta();
  }

  input(id: string, turn: number, boost: boolean, aim: number | null = null) {
    const c = this.cars.find((x) => x.id === id);
    if (!c || c.isBot) return;
    c.turn = turn < 0 ? -1 : turn > 0 ? 1 : 0;
    c.aim = aim !== null && Number.isFinite(aim) ? aim : null;
    c.boost = !!boost;
  }

  act(by: string, a: NeonAction): R {
    if (this.destroyed) return no("Arena closed");
    if (!this.cars.some((x) => x.id === by)) return no("Join first");
    if (by !== this.hostId) return no("Only the host can do that");
    switch (a.type) {
      case "start": return this.start();
      case "settings":
        if (this.phase !== "lobby") return no("Go back to the lobby to change settings");
        this.settings = { ...this.settings, ...a.settings };
        this.size = NEON_ARENAS[this.settings.arena];
        this.pushMeta();
        return ok;
      case "to_lobby":
        this.stopLoop();
        this.phase = "lobby";
        this.cars = this.cars.filter((x) => !x.isBot);
        this.pushMeta();
        return ok;
    }
    return no("Unknown action");
  }

  // ───────────────────────── session ─────────────────────────

  /** Endless arena: no rounds — crash, wait a moment, respawn. */
  private start(): R {
    if (this.phase !== "lobby") return no("Already racing");
    this.cars = this.cars.filter((x) => !x.isBot && x.connections > 0);
    const want = Math.min(this.settings.bots, NEON.MAX_PLAYERS - this.cars.length);
    for (let i = 0; i < want; i++) this.addBot();
    if (this.cars.length < 1) return no("Join first");
    for (const c of this.cars) { c.score = 0; c.kills = 0; c.wins = 0; c.best = 0; }
    this.round = 1;
    this.feed = [];
    this.phase = "playing";
    this.gas.clear();
    this.powers.clear();
    this.rebuildGrid();
    for (const c of this.cars) this.respawn(c);
    this.topUpGas(true);
    this.addFeed("🏁 Arena open — grab gas and trap your friends!");
    this.pushMeta();
    this.sendSnap(true);
    this.startLoop();
    return ok;
  }

  private respawn(c: Car) {
    const others = this.cars.filter((o) => o !== c && o.alive).map((o) => ({ x: o.x, y: o.y }));
    const p = this.spawnPoint(others);
    Object.assign(c, {
      x: p.x, y: p.y, a: Math.atan2(this.size / 2 - p.y, this.size / 2 - p.x) + (this.rnd() - 0.5) * 0.8,
      turn: 0, steer: 0, aim: null, boost: false, fuel: 1, alive: true, trail: [{ x: p.x, y: p.y }], len: NEON.START_LEN,
      power: "shield" as NeonPower, powerUntil: this.now() + NEON.SPAWN_SHIELD_MS, respawnAt: 0, lifeKills: 0,
    });
  }

  // ───────────────────────── simulation ─────────────────────────

  /** Advance the world by dt seconds. Public for tests. */
  step(dt = NEON.TICK_MS / 1000) {
    this.tickNo++;
    const t = this.now();
    if (this.phase === "playing") {
      for (const c of this.cars) {
        if (!c.alive) {
          if (c.respawnAt && t >= c.respawnAt && (c.isBot || c.connections > 0)) this.respawn(c);
          continue;
        }
        if (c.power && t >= c.powerUntil) c.power = null;
        const boosting = c.boost && c.fuel > 0.02;
        c.fuel = Math.min(1, Math.max(0, c.fuel + (boosting ? -NEON.BOOST_DRAIN : NEON.BOOST_REFILL) * dt));
        const v = NEON.SPEED * (boosting ? NEON.BOOST_MULT : 1) * (c.power === "turbo" ? NEON.TURBO_MULT : 1);
        // ease steering in and out so curves are smooth instead of snapping
        const want = c.aim !== null ? aimTurn(c.a, c.aim) : c.turn;
        c.steer += (want - c.steer) * Math.min(1, dt * NEON.STEER_EASE);
        c.a += c.steer * NEON.TURN * dt;
        c.x += Math.cos(c.a) * v * dt;
        c.y += Math.sin(c.a) * v * dt;
        c.trail.push({ x: c.x, y: c.y });
        this.trim(c);
      }
      {
        this.rebuildGrid();
        this.collide();
        for (const c of this.cars) if (c.alive && c.isBot && --c.think <= 0) this.botThink(c);
        this.pickups();
        this.topUpGas(false);
        if (this.tickNo % 60 === 0 && this.powers.size < 3 + Math.floor(this.cars.length / 3)) this.spawnPower();
      }
    }
    this.sendSnap(this.tickNo % NEON.FULL_EVERY === 0);
  }

  private trim(c: Car) {
    let total = 0;
    for (let i = c.trail.length - 1; i > 0; i--) {
      const a = c.trail[i], b = c.trail[i - 1];
      total += Math.hypot(a.x - b.x, a.y - b.y);
      if (total > c.len) { c.trail.splice(0, i - 1); return; }
    }
  }

  private rebuildGrid() {
    this.grid.clear();
    this.cars.forEach((c, ci) => {
      if (!c.alive) return;
      for (let i = 1; i < c.trail.length; i++) {
        const a = c.trail[i - 1], b = c.trail[i];
        const x0 = Math.floor(Math.min(a.x, b.x) / CELL), x1 = Math.floor(Math.max(a.x, b.x) / CELL);
        const y0 = Math.floor(Math.min(a.y, b.y) / CELL), y1 = Math.floor(Math.max(a.y, b.y) / CELL);
        for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
          const k = gx * 10007 + gy;
          let cell = this.grid.get(k);
          if (!cell) { cell = []; this.grid.set(k, cell); }
          cell.push(ci, i);
        }
      }
    });
  }

  /** Returns the index of the car whose trail is hit near (x,y) within radius r, or -1. */
  private trailHit(x: number, y: number, r: number, self: number): number {
    const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL);
    const r2 = r * r;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const cell = this.grid.get((gx + dx) * 10007 + gy + dy);
      if (!cell) continue;
      for (let k = 0; k < cell.length; k += 2) {
        const ci = cell[k], i = cell[k + 1];
        const car = this.cars[ci];
        if (!car || !car.alive) continue;
        const tr = car.trail;
        const a = tr[i - 1], b = tr[i];
        if (!a || !b) continue;
        // your own trail is safe — you can cut across it freely
        if (ci === self) continue;
        if (segDist2(x, y, a.x, a.y, b.x, b.y) < r2) return ci;
      }
    }
    return -1;
  }

  private collide() {
    const S = this.size;
    const dead: [Car, Car | null, string][] = [];
    this.cars.forEach((c, ci) => {
      if (!c.alive) return;
      if (c.x < NEON.CAR_R || c.y < NEON.CAR_R || c.x > S - NEON.CAR_R || c.y > S - NEON.CAR_R) { dead.push([c, null, "hit the wall"]); return; }
      if (c.power === "shield") return;
      const hit = this.trailHit(c.x, c.y, NEON.CAR_R * 0.75 + NEON.TRAIL_W / 2, ci);
      if (hit >= 0) dead.push([c, this.cars[hit], ""]);
    });
    // head-on
    for (let i = 0; i < this.cars.length; i++) for (let j = i + 1; j < this.cars.length; j++) {
      const a = this.cars[i], b = this.cars[j];
      if (!a.alive || !b.alive) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) < NEON.CAR_R * 1.8) {
        if (a.power !== "shield") dead.push([a, b, "crashed head-on"]);
        if (b.power !== "shield") dead.push([b, a, "crashed head-on"]);
      }
    }
    for (const [c, k, why] of dead) if (c.alive) this.kill(c, k, why);
  }

  private kill(c: Car, killer: Car | null, why: string) {
    c.alive = false;
    c.respawnAt = this.now() + NEON.RESPAWN_MS;
    c.best = Math.max(c.best, Math.round(c.len));
    if (killer && killer !== c) {
      killer.kills++;
      killer.lifeKills++;
      killer.score++;
      if (killer.lifeKills === 3) this.addFeed(`🔥 ${killer.nickname} is on a rampage (3 kills)!`);
      this.addFeed(`💥 ${killer.nickname} took out ${c.nickname}${why ? ` (${why})` : ""}`);
    } else {
      this.addFeed(`💥 ${c.nickname} ${why || "crashed"}`);
    }
    // drop gas along the wreck's trail
    for (let i = 0; i < c.trail.length; i += 4) {
      const p = c.trail[i];
      if (this.gas.size > 400) break;
      this.addGas(p.x + (this.rnd() - 0.5) * 16, p.y + (this.rnd() - 0.5) * 16);
    }
    c.trail = [];
  }

  private pickups() {
    const t = this.now();
    for (const c of this.cars) {
      if (!c.alive) continue;
      const magnet = c.power === "magnet";
      for (const g of this.gas.values()) {
        const d = Math.hypot(g.x - c.x, g.y - c.y);
        if (d < NEON.CAR_R + NEON.GAS_R + 4) {
          c.len = Math.min(NEON.MAX_LEN, c.len + NEON.GAS_LEN);
          c.best = Math.max(c.best, Math.round(c.len));
          this.gas.delete(g.id);
          this.gasDel.push(g.id);
        } else if (magnet && d < NEON.MAGNET_R) {
          // pull toward the car (client sees the new position via a del+add)
          g.x += ((c.x - g.x) / d) * 14;
          g.y += ((c.y - g.y) / d) * 14;
          this.gasDel.push(g.id);
          this.gasAdd.push(g.id, Math.round(g.x), Math.round(g.y));
        }
      }
      for (const p of this.powers.values()) {
        if (Math.hypot(p.x - c.x, p.y - c.y) < NEON.CAR_R + NEON.POWER_R) {
          c.power = p.kind;
          c.powerUntil = t + NEON_POWERS[p.kind].ms;
          this.powers.delete(p.id);
          this.addFeed(`${NEON_POWERS[p.kind].icon} ${c.nickname} grabbed ${NEON_POWERS[p.kind].label}`);
        }
      }
    }
  }

  private topUpGas(initial: boolean) {
    const target = Math.round((this.size * this.size) / 50_000);
    let n = initial ? target : Math.min(3, target - this.gas.size);
    while (n-- > 0 && this.gas.size < target) this.addGas(60 + this.rnd() * (this.size - 120), 60 + this.rnd() * (this.size - 120));
  }

  private addGas(x: number, y: number) {
    const id = this.nextId++;
    const g = { id, x: Math.round(x), y: Math.round(y) };
    this.gas.set(id, g);
    this.gasAdd.push(id, g.x, g.y);
  }

  private spawnPower() {
    const kinds: NeonPower[] = ["shield", "turbo", "magnet"];
    const kind = kinds[Math.floor(this.rnd() * kinds.length)];
    const id = this.nextId++;
    this.powers.set(id, { id, kind, x: Math.round(150 + this.rnd() * (this.size - 300)), y: Math.round(150 + this.rnd() * (this.size - 300)) });
  }

  private spawnPoint(placed: Pt[]): Pt {
    const m = Math.min(300, this.size * 0.15);
    let best: Pt = { x: this.size / 2, y: this.size / 2 }, bestD = -1;
    for (let k = 0; k < 30; k++) {
      const p = { x: m + this.rnd() * (this.size - 2 * m), y: m + this.rnd() * (this.size - 2 * m) };
      const d = placed.length ? Math.min(...placed.map((q) => Math.hypot(q.x - p.x, q.y - p.y))) : 1e9;
      if (d > bestD) { best = p; bestD = d; }
      if (d > 400) break;
    }
    return best;
  }

  // ───────────────────────── bots ─────────────────────────

  private botThink(c: Car) {
    c.think = 2 + Math.floor(this.rnd() * 2);
    const ci = this.cars.indexOf(c);
    const look = 200 + (c.boost ? 80 : 0);
    const options = [-1, 0, 1] as const;
    const angles = [-0.9, -0.45, 0, 0.45, 0.9];
    const clear = angles.map((da) => this.clearance(c, ci, c.a + da, look));
    // score each turn choice: clearance on that side + pull toward the nearest gas
    // chase the nearest gas that is roughly in front (gas behind/beside us would make us circle forever)
    const norm = (d: number) => { while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
    let diff = 0, td = 1e9;
    for (const g of this.gas.values()) {
      const d = Math.hypot(g.x - c.x, g.y - c.y);
      if (d > 700 || d >= td) continue;
      const da = norm(Math.atan2(g.y - c.y, g.x - c.x) - c.a);
      if (Math.abs(da) > 1.1 && d < 260) continue;
      td = d; diff = da;
    }
    // head back toward the middle when near a wall
    const m = 220;
    if (c.x < m || c.y < m || c.x > this.size - m || c.y > this.size - m) diff = norm(Math.atan2(this.size / 2 - c.y, this.size / 2 - c.x) - c.a);
    let bestTurn: -1 | 0 | 1 = 0, best = -1e9;
    for (const t of options) {
      const side = t === -1 ? Math.min(clear[0], clear[1]) * 0.5 + clear[1] * 0.5 : t === 1 ? Math.min(clear[3], clear[4]) * 0.5 + clear[3] * 0.5 : clear[2];
      let s = side;
      if (side > 150) s += (Math.sign(diff) === t ? 60 : 0) + (t === 0 && Math.abs(diff) < 0.2 ? 60 : 0);
      s += this.rnd() * 15;
      if (s > best) { best = s; bestTurn = t; }
    }
    c.turn = bestTurn;
    c.boost = clear[2] > 190 && this.rnd() < 0.15;
  }

  /** How far a ray goes before hitting a wall or a trail (up to max). */
  private clearance(c: Car, ci: number, ang: number, max: number) {
    const cos = Math.cos(ang), sin = Math.sin(ang);
    for (let d = 20; d <= max; d += 20) {
      const x = c.x + cos * d, y = c.y + sin * d;
      if (x < 15 || y < 15 || x > this.size - 15 || y > this.size - 15) return d;
      if (this.trailHit(x, y, NEON.CAR_R + NEON.TRAIL_W, ci) >= 0) return d;
    }
    return max + 40;
  }

  private addBot() {
    const n = this.cars.filter((x) => x.isBot).length;
    const c = this.newCar(`bot:${n + 1}:${Math.floor(this.rnd() * 1e6)}`, `🤖 ${BOT_NAMES[n % BOT_NAMES.length]}`, true);
    c.connections = 1;
    this.cars.push(c);
  }

  private removeOneBot() {
    const i = this.cars.findIndex((x) => x.isBot);
    if (i >= 0) this.cars.splice(i, 1);
  }

  private newCar(id: string, nickname: string, isBot: boolean): Car {
    const used = new Set(this.cars.map((c) => c.color));
    let color = 0;
    while (used.has(color) && color < NEON_COLORS.length - 1) color++;
    return {
      id, nickname, isBot, connections: 0, color, x: 0, y: 0, a: 0, turn: 0, boost: false, fuel: 1,
      alive: false, trail: [], len: NEON.START_LEN, power: null, powerUntil: 0, score: 0, kills: 0, wins: 0, think: 0,
      steer: 0, respawnAt: 0, lifeKills: 0, best: 0, aim: null,
    };
  }

  // ───────────────────────── output ─────────────────────────

  meta(): NeonMeta {
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      settings: this.settings,
      size: this.size,
      players: this.cars.map((c) => ({ id: c.id, nickname: c.nickname, isBot: c.isBot, connected: c.connections > 0, color: c.color, score: c.score, kills: c.kills, wins: c.wins, best: c.best })),
      round: this.round,
      winnerId: this.winnerId,
      roundEndsAt: this.roundEndsAt,
      serverNow: this.now(),
      feed: this.feed.slice(-6),
    };
  }

  snapshot(full: boolean): NeonSnap {
    const t = this.now();
    const cars: NeonCarSnap[] = this.cars.map((c) => ({
      id: c.id, x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10, a: Math.round(c.a * 1000), st: Math.round(c.steer * 100), len: Math.round(c.len),
      alive: c.alive, boosting: c.alive && c.boost && c.fuel > 0.02, fuel: Math.round(c.fuel * 100),
      power: c.power, powerMs: c.power ? Math.max(0, c.powerUntil - t) : 0,
      respawnMs: !c.alive && c.respawnAt ? Math.max(0, c.respawnAt - t) : 0,
    }));
    const s: NeonSnap = { t, tick: this.tickNo, cars, powers: [...this.powers.values()] };
    if (full) {
      s.trails = Object.fromEntries(this.cars.map((c) => [c.id, c.trail.flatMap((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10])]));
      s.gas = [...this.gas.values()].flatMap((g) => [g.id, g.x, g.y]);
    } else {
      if (this.gasAdd.length) s.gasAdd = this.gasAdd;
      if (this.gasDel.length) s.gasDel = this.gasDel;
    }
    this.gasAdd = [];
    this.gasDel = [];
    return s;
  }

  private sendSnap(full: boolean) {
    if (!this.destroyed) this.ev.snap(this.snapshot(full));
  }
  private pushMeta() {
    if (!this.destroyed) this.ev.meta(this.meta());
  }
  private addFeed(text: string) {
    this.feed.push({ at: this.now(), text });
    if (this.feed.length > 20) this.feed.shift();
    this.pushMeta();
  }
  private startLoop() {
    this.stopLoop();
    this.loop = setInterval(() => this.step(), NEON.TICK_MS);
  }
  private stopLoop() {
    if (this.loop) { clearInterval(this.loop); this.loop = null; }
  }
  private scheduleIdle() {
    if (this.idleTimer) return;
    this.idleTimer = setTimeout(() => this.ev.onIdle(), 10 * 60_000);
  }
  destroy() {
    this.destroyed = true;
    this.stopLoop();
    if (this.hostTimer) clearTimeout(this.hostTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
  }
}
