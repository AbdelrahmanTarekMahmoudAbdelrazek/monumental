import {
  SQ,
  SQ_DASH_MULT,
  SQ_HEAL_PULSE,
  SQ_POWERS,
  SQ_POWER_SPOTS,
  SQ_ROLES,
  SQ_SHIELD,
  SQ_SPAWN,
  otherSqTeam,
  segCircle,
  sqFree,
  sqMove,
  sqRayBlock,
  type SqAction,
  type SqInput,
  type SqLife,
  type SqMeta,
  type SqPhase,
  type SqPower,
  type SqRole,
  type SqSettings,
  type SqSnap,
  type SqTeam,
  type SqUnit,
  type SqWire,
  encodeSnap,
} from "@monumental/shared";

interface Unit {
  id: string;
  /** Short number for the wire format. */
  n: number;
  nickname: string;
  isBot: boolean;
  connections: number;
  team: SqTeam;
  role: SqRole;
  nextRole: SqRole;
  ready: boolean;
  x: number; y: number; vx: number; vy: number;
  aim: number;
  input: SqInput;
  hp: number;
  life: SqLife;
  downHp: number;
  /** Bleed-out (down) or respawn (dead) time. */
  lifeAt: number;
  rev: number;
  revThisTick: boolean;
  ammo: number;
  reloadUntil: number;
  nextShot: number;
  abilityAt: number;
  actUntil: number;
  dashX: number; dashY: number;
  power: SqPower | null;
  powerUntil: number;
  bubble: number;
  lastDamageAt: number;
  knockedBy: Unit | null;
  /** Last time a client-reported position was accepted. */
  posAt: number;
  kills: number; knocks: number; deaths: number; revives: number; damage: number;
  bot: { think: number; strafe: number; seen: number; targetId: string | null; wander: number };
}

interface Bullet { id: number; owner: Unit; team: SqTeam; x: number; y: number; vx: number; vy: number; dist: number; range: number; dmg: number }
interface Power { id: number; x: number; y: number; kind: SqPower }

type R = { ok: boolean; error?: string };
const ok: R = { ok: true };
const no = (error: string): R => ({ ok: false, error });

export interface SqEvents {
  meta: (m: SqMeta) => void;
  snap: (s: SqWire) => void;
  onIdle: () => void;
}

const BOT_NAMES = ["Raven", "Atlas", "Viper", "Nova", "Bolt", "Echo", "Rook", "Ghost", "Blaze", "Titan", "Pixel", "Onyx"];
const ROLES: SqRole[] = ["healer", "tank", "fighter"];
const idle = (): SqInput => ({ mx: 0, my: 0, aim: 0, fire: false, ability: false, revive: false, reload: false, seq: 0 });
const angDiff = (a: number, b: number) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

/** Server-authoritative SQUAD RUSH match. 30 ticks/s while playing. */
export class SquadEngine {
  private units: Unit[] = [];
  private bullets: Bullet[] = [];
  private powers = new Map<number, Power>();
  private phase: SqPhase = "lobby";
  private score: Record<SqTeam, number> = { red: 0, blue: 0 };
  private endsAt = 0;
  private winner: SqTeam | "draw" | null = null;
  private mvpId: string | null = null;
  private feed: SqMeta["feed"] = [];
  private nextId = 1;
  private nextN = 1;
  private tickNo = 0;
  private nextPowerAt = 0;
  private loop: ReturnType<typeof setInterval> | null = null;
  private hostTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  // per-tick events
  private shots: number[] = [];
  private stops: number[] = [];
  private dmg: number[] = [];
  private pulses: number[] = [];

  constructor(
    readonly code: string,
    private hostId: string,
    private settings: SqSettings,
    private ev: SqEvents,
    private now: () => number = Date.now,
    private rnd: () => number = Math.random,
  ) {
    this.scheduleIdle();
  }

  // ───────────────────────── seats ─────────────────────────

  join(id: string, nickname: string): R {
    if (this.destroyed) return no("Room closed");
    let u = this.units.find((x) => x.id === id);
    if (!u) {
      if (this.units.filter((x) => !x.isBot).length >= SQ.MAX_PLAYERS) return no("Room is full");
      const team = this.smallerTeam();
      if (this.units.length >= SQ.MAX_PLAYERS) this.removeBot(team) || this.removeBot(otherSqTeam(team));
      u = this.newUnit(id, nickname, false, team, this.suggestRole(team));
      this.units.push(u);
      if (this.phase === "playing") { u.life = "dead"; u.lifeAt = this.now() + 1500; }
    }
    u.nickname = nickname;
    u.connections++;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    if (id === this.hostId && this.hostTimer) { clearTimeout(this.hostTimer); this.hostTimer = null; }
    this.pushMeta();
    return ok;
  }

  leave(id: string) {
    const u = this.units.find((x) => x.id === id);
    if (!u) return;
    u.connections = Math.max(0, u.connections - 1);
    if (u.connections === 0) {
      this.units = this.units.filter((x) => x !== u);
      this.bullets = this.bullets.filter((b) => b.owner !== u);
    }
    if (id === this.hostId && !this.hostTimer) {
      this.hostTimer = setTimeout(() => {
        this.hostTimer = null;
        if (this.units.some((x) => x.id === this.hostId && x.connections > 0)) return;
        const next = this.units.find((x) => !x.isBot && x.connections > 0);
        if (next) { this.hostId = next.id; this.pushMeta(); }
      }, 15_000);
    }
    if (!this.units.some((x) => !x.isBot && x.connections > 0)) {
      this.stopLoop();
      this.phase = "lobby";
      this.units = [];
      this.scheduleIdle();
    }
    this.pushMeta();
  }

  input(id: string, inp: SqInput) {
    const u = this.units.find((x) => x.id === id);
    if (!u || u.isBot) return;
    u.input = inp;
  }

  act(by: string, a: SqAction): R {
    if (this.destroyed) return no("Room closed");
    const me = this.units.find((x) => x.id === by);
    if (!me) return no("Join first");
    switch (a.type) {
      case "team":
        if (this.phase === "playing") return no("Switch teams between matches");
        if (this.units.filter((x) => x.team === a.team && !x.isBot).length >= 6) return no("That team is full");
        me.team = a.team;
        this.pushMeta();
        return ok;
      case "role":
        me.nextRole = a.role;
        if (this.phase !== "playing" || me.life === "dead") me.role = a.role;
        me.ready = true;
        this.pushMeta();
        return ok;
      case "settings":
        if (by !== this.hostId) return no("Only the host can change settings");
        if (this.phase === "playing") return no("Wait for the match to end");
        this.settings = { ...this.settings, ...a.settings };
        this.pushMeta();
        return ok;
      case "bot":
        return no("Bots fill the teams automatically — change the team size");
      case "start":
        if (by !== this.hostId) return no("Only the host can start");
        return this.start();
      case "to_lobby":
        if (by !== this.hostId) return no("Only the host can do that");
        this.stopLoop();
        this.phase = "lobby";
        this.units = this.units.filter((x) => !x.isBot);
        this.pushMeta();
        return ok;
    }
    return no("Unknown action");
  }

  // ───────────────────────── match flow ─────────────────────────

  private start(): R {
    if (this.phase === "playing") return no("Already playing");
    this.units = this.units.filter((x) => !x.isBot && x.connections > 0);
    if (!this.units.length) return no("Join first");
    for (const t of ["red", "blue"] as SqTeam[]) {
      while (this.units.filter((x) => x.team === t).length < this.settings.teamSize && this.units.length < SQ.MAX_PLAYERS) {
        const n = this.units.filter((x) => x.isBot).length;
        const u = this.newUnit(`bot:${n + 1}:${Math.floor(this.rnd() * 1e6)}`, BOT_NAMES[n % BOT_NAMES.length], true, t, this.suggestRole(t));
        u.connections = 1;
        this.units.push(u);
      }
    }
    for (const u of this.units) {
      Object.assign(u, { kills: 0, knocks: 0, deaths: 0, revives: 0, damage: 0 });
      u.role = u.nextRole;
      this.spawn(u);
    }
    this.score = { red: 0, blue: 0 };
    this.bullets = [];
    this.powers.clear();
    this.feed = [];
    this.winner = null;
    this.mvpId = null;
    this.phase = "playing";
    this.endsAt = this.now() + this.settings.minutes * 60_000;
    this.nextPowerAt = this.now() + 3000;
    this.addFeed("Match", null, "started —", `first to ${this.settings.target}`, null);
    this.startLoop();
    return ok;
  }

  private end() {
    this.phase = "ended";
    const { red, blue } = this.score;
    this.winner = red === blue ? "draw" : red > blue ? "red" : "blue";
    const rate = (u: Unit) => u.kills * 3 + u.knocks + u.revives * 3 + u.damage / 100;
    this.mvpId = [...this.units].sort((a, b) => rate(b) - rate(a))[0]?.id ?? null;
    this.bullets = [];
    this.pushMeta();
    this.sendSnap();
    this.stopLoop();
  }

  private spawn(u: Unit) {
    const s = SQ_SPAWN[u.team];
    const def = SQ_ROLES[u.role];
    let x = s.x, y = s.y0 + this.rnd() * (s.y1 - s.y0);
    [x, y] = sqMove(x, y, 0, 0);
    Object.assign(u, {
      x, y, vx: 0, vy: 0, aim: u.team === "red" ? 0 : Math.PI, hp: def.hp, life: "alive" as SqLife, downHp: 0, lifeAt: 0, rev: 0,
      ammo: def.weapon.mag, reloadUntil: 0, nextShot: 0, abilityAt: 0, actUntil: 0, power: null, powerUntil: 0, bubble: 0,
      lastDamageAt: 0, knockedBy: null, posAt: 0,
    });
    u.input = { ...u.input, px: undefined, py: undefined };
    // brief spawn protection: a 2-hit bubble for 3 seconds
    u.bubble = 2;
    u.power = "bubble";
    u.powerUntil = this.now() + 3000;
  }

  // ───────────────────────── simulation ─────────────────────────

  /** Advance dt seconds. Public for tests. */
  step(dt = SQ.TICK_MS / 1000) {
    this.tickNo++;
    if (this.phase !== "playing") return;
    const t = this.now();
    if (t >= this.endsAt) { this.end(); return; }
    for (const u of this.units) if (u.isBot && --u.bot.think <= 0) this.botThink(u, t);
    for (const u of this.units) u.revThisTick = false;
    for (const u of this.units) this.updateUnit(u, dt, t);
    for (const u of this.units) if (u.life === "down" && !u.revThisTick) u.rev = Math.max(0, u.rev - dt * 1.5);
    this.updateBullets(dt);
    if (t >= this.nextPowerAt) { this.spawnPower(); this.nextPowerAt = t + 7000 + this.rnd() * 5000; }
    if (this.tickNo % 3 !== 0) this.sendSnap();
  }

  private updateUnit(u: Unit, dt: number, t: number) {
    const def = SQ_ROLES[u.role];
    const inp = u.input;
    if (u.life === "dead") {
      if (t >= u.lifeAt && (u.isBot || u.connections > 0)) { u.role = u.nextRole; this.spawn(u); }
      return;
    }
    if (u.power && u.powerUntil && t >= u.powerUntil) { if (u.power === "bubble") u.bubble = 0; u.power = null; }
    u.aim = Number.isFinite(inp.aim) ? inp.aim : u.aim;
    const len = Math.hypot(inp.mx, inp.my);
    const mx = len > 1 ? inp.mx / len : inp.mx, my = len > 1 ? inp.my / len : inp.my;
    const ox = u.x, oy = u.y;
    if (u.life === "down") {
      if (t >= u.lifeAt) { this.eliminate(u, u.knockedBy); return; }
      if (!this.acceptClientPos(u, SQ.CRAWL_SPEED, t)) [u.x, u.y] = sqMove(u.x, u.y, mx * SQ.CRAWL_SPEED * dt, my * SQ.CRAWL_SPEED * dt);
      u.vx = (u.x - ox) / dt; u.vy = (u.y - oy) / dt;
      return;
    }
    // ── alive ──
    let speed = def.speed * (u.power === "speed" ? 1.35 : 1);
    const shieldUp = u.role === "tank" && t < u.actUntil;
    if (shieldUp) speed *= 0.55;
    let dx = mx * speed * dt, dy = my * speed * dt;
    const dashing = u.role === "fighter" && t < u.actUntil + 150;
    if (u.role === "fighter" && t < u.actUntil) { dx = u.dashX * def.speed * SQ_DASH_MULT * dt; dy = u.dashY * def.speed * SQ_DASH_MULT * dt; }
    // humans move on their own screen (perfectly smooth); the server only checks the move is legal
    const maxSpeed = def.speed * (u.power === "speed" ? 1.35 : 1) * (dashing ? SQ_DASH_MULT : 1);
    if (!this.acceptClientPos(u, maxSpeed, t)) [u.x, u.y] = sqMove(u.x, u.y, dx, dy);
    u.vx = (u.x - ox) / dt; u.vy = (u.y - oy) / dt;

    if (u.lastDamageAt && t - u.lastDamageAt > SQ.REGEN_DELAY * 1000) u.hp = Math.min(def.hp, u.hp + SQ.REGEN_PER_S * dt);

    // reload
    if (u.reloadUntil && t >= u.reloadUntil) { u.reloadUntil = 0; u.ammo = def.weapon.mag; }
    if (inp.reload && !u.reloadUntil && u.ammo < def.weapon.mag) u.reloadUntil = t + def.weapon.reloadMs;

    // ability
    if (inp.ability && t >= u.abilityAt) {
      u.abilityAt = t + def.ability.cooldownMs;
      if (u.role === "healer") {
        this.pulses.push(Math.round(u.x), Math.round(u.y));
        for (const m of this.units) {
          if (m === u || m.team !== u.team || m.life !== "alive") continue;
          if (Math.hypot(m.x - u.x, m.y - u.y) <= SQ_HEAL_PULSE.radius) m.hp = Math.min(SQ_ROLES[m.role].hp, m.hp + SQ_HEAL_PULSE.amount);
        }
      } else if (u.role === "tank") {
        u.actUntil = t + def.ability.durationMs;
      } else {
        const l = Math.hypot(mx, my);
        u.dashX = l > 0.1 ? mx / l : Math.cos(u.aim);
        u.dashY = l > 0.1 ? my / l : Math.sin(u.aim);
        u.actUntil = t + def.ability.durationMs;
      }
    }

    // revive (hold) — the nearest downed teammate in range
    if (inp.revive) {
      let best: Unit | null = null, bd: number = SQ.REVIVE_RANGE;
      for (const m of this.units) {
        if (m.team !== u.team || m.life !== "down") continue;
        const d = Math.hypot(m.x - u.x, m.y - u.y);
        if (d <= bd) { bd = d; best = m; }
      }
      if (best) {
        best.revThisTick = true;
        best.rev = Math.min(1, best.rev + (dt * 1000) / def.reviveMs);
        if (best.rev >= 1) {
          best.life = "alive";
          best.hp = Math.round(SQ_ROLES[best.role].hp * SQ.REVIVE_HP);
          best.rev = 0;
          best.lifeAt = 0;
          best.lastDamageAt = t;
          u.revives++;
          this.addFeed(u.nickname, u.team, "revived", best.nickname, best.team);
        }
      }
    }

    // shooting (not while reviving or behind the shield wall)
    if (inp.fire && !inp.revive && !shieldUp && !u.reloadUntil && t >= u.nextShot) {
      if (u.ammo <= 0) { u.reloadUntil = t + def.weapon.reloadMs; }
      else {
        this.fire(u, def);
        u.ammo--;
        u.nextShot = t + def.weapon.interval;
        if (u.ammo <= 0) u.reloadUntil = t + def.weapon.reloadMs;
      }
    }

    // pickups
    for (const p of this.powers.values()) {
      if (Math.hypot(p.x - u.x, p.y - u.y) > SQ.PICKUP_R + SQ.R) continue;
      this.powers.delete(p.id);
      if (p.kind === "medkit") u.hp = Math.min(def.hp, u.hp + 50);
      else {
        u.power = p.kind;
        u.powerUntil = t + SQ_POWERS[p.kind].ms;
        if (p.kind === "bubble") u.bubble = 3;
      }
    }
  }

  /**
   * Accept the position the player's client reports if it's reachable from the last accepted one
   * at their max speed (+ some slack for network jitter) and not inside a wall. Returns false to
   * fall back to simulating the move here.
   */
  private acceptClientPos(u: Unit, maxSpeed: number, t: number): boolean {
    const { px, py } = u.input;
    if (u.isBot || px === undefined || py === undefined) return false;
    if (!u.posAt) u.posAt = t;
    const elapsed = Math.min(0.5, Math.max(SQ.TICK_MS / 1000, (t - u.posAt) / 1000));
    const d = Math.hypot(px - u.x, py - u.y);
    if (d > maxSpeed * elapsed * 1.35 + 12 || !sqFree(px, py)) return false;
    u.x = px; u.y = py;
    u.posAt = t;
    return true;
  }

  private fire(u: Unit, def = SQ_ROLES[u.role]) {
    const w = def.weapon;
    const lanes = u.power === "triple" ? [-0.16, 0, 0.16] : [0];
    const ui = this.units.indexOf(u);
    for (const lane of lanes) for (let p = 0; p < w.pellets; p++) {
      const spread = w.pellets > 1 ? (p / (w.pellets - 1) - 0.5) * w.spread * 2 : 0;
      const a = u.aim + lane + spread + (this.rnd() - 0.5) * w.spread * (w.pellets > 1 ? 0.5 : 1);
      const sx = u.x + Math.cos(u.aim) * (SQ.R + 6), sy = u.y + Math.sin(u.aim) * (SQ.R + 6);
      const b: Bullet = { id: this.nextId++, owner: u, team: u.team, x: sx, y: sy, vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed, dist: 0, range: w.range, dmg: w.damage };
      this.bullets.push(b);
      this.shots.push(b.id, Math.round(sx), Math.round(sy), Math.round(a * 1000), w.speed, w.range, u.team === "red" ? 0 : 1, ui);
    }
  }

  private updateBullets(dt: number) {
    const t = this.now();
    const keep: Bullet[] = [];
    for (const b of this.bullets) {
      const qx = b.x + b.vx * dt, qy = b.y + b.vy * dt;
      let hitT = sqRayBlock(b.x, b.y, qx, qy), hitKind = hitT >= 0 ? 0 : -1;
      let target: Unit | null = null;
      for (const u of this.units) {
        if (u.team === b.team || u.life === "dead") continue;
        // enemy tank shield wall: an arc in front of him
        if (u.role === "tank" && u.life === "alive" && t < u.actUntil) {
          const st = segCircle(b.x, b.y, qx, qy, u.x, u.y, SQ_SHIELD.radius);
          if (st >= 0 && (hitT < 0 || st < hitT)) {
            const hx = b.x + (qx - b.x) * st, hy = b.y + (qy - b.y) * st;
            if (Math.abs(angDiff(Math.atan2(hy - u.y, hx - u.x), u.aim)) <= SQ_SHIELD.halfAngle) { hitT = st; hitKind = 2; target = null; continue; }
          }
        }
        const ht = segCircle(b.x, b.y, qx, qy, u.x, u.y, SQ.R);
        if (ht >= 0 && (hitT < 0 || ht < hitT)) { hitT = ht; hitKind = 1; target = u; }
      }
      if (hitT >= 0) {
        const hx = b.x + (qx - b.x) * hitT, hy = b.y + (qy - b.y) * hitT;
        this.stops.push(b.id, Math.round(hx), Math.round(hy), hitKind);
        if (target) this.damage(target, b.dmg, b.owner, hx, hy);
        continue;
      }
      b.dist += Math.hypot(qx - b.x, qy - b.y);
      b.x = qx; b.y = qy;
      if (b.dist < b.range) keep.push(b);
    }
    this.bullets = keep;
  }

  private damage(u: Unit, amount: number, from: Unit, hx: number, hy: number) {
    const t = this.now();
    if (u.bubble > 0 && u.life === "alive") {
      u.bubble--;
      if (u.bubble === 0 && u.power === "bubble") u.power = null;
      this.dmg.push(Math.round(hx), Math.round(hy), 0);
      return;
    }
    this.dmg.push(Math.round(hx), Math.round(hy), amount);
    if (from.team !== u.team) from.damage += amount;
    if (u.life === "alive") {
      u.hp -= amount;
      u.lastDamageAt = t;
      if (u.hp <= 0) {
        u.hp = 0;
        u.life = "down";
        u.downHp = SQ.DOWN_HP;
        u.lifeAt = t + SQ.BLEED_MS;
        u.rev = 0;
        u.reloadUntil = 0;
        u.actUntil = 0;
        u.power = null;
        u.knockedBy = from;
        from.knocks++;
        this.addFeed(from.nickname, from.team, "knocked down", u.nickname, u.team);
        // whole team down → they can't be revived: eliminate them all
        if (!this.units.some((m) => m.team === u.team && m.life === "alive")) {
          for (const m of this.units) if (m.team === u.team && m.life === "down") this.eliminate(m, m.knockedBy);
        }
      }
    } else if (u.life === "down") {
      u.downHp -= amount;
      if (u.downHp <= 0) this.eliminate(u, from);
    }
  }

  private eliminate(u: Unit, by: Unit | null) {
    if (u.life === "dead") return;
    u.life = "dead";
    u.lifeAt = this.now() + SQ.RESPAWN_MS;
    u.deaths++;
    u.rev = 0;
    const scorer = by && by.team !== u.team ? by : null;
    if (scorer) scorer.kills++;
    this.score[otherSqTeam(u.team)]++;
    this.addFeed(scorer?.nickname ?? "—", scorer?.team ?? null, "eliminated", u.nickname, u.team);
    if (this.score[otherSqTeam(u.team)] >= this.settings.target) this.end();
  }

  private spawnPower() {
    if (this.powers.size >= 4) return;
    const free = SQ_POWER_SPOTS.filter((s) => ![...this.powers.values()].some((p) => p.x === s.x && p.y === s.y));
    if (!free.length) return;
    const s = free[Math.floor(this.rnd() * free.length)];
    const kinds: SqPower[] = ["triple", "speed", "medkit", "bubble", "medkit"];
    const id = this.nextId++;
    this.powers.set(id, { id, x: s.x, y: s.y, kind: kinds[Math.floor(this.rnd() * kinds.length)] });
  }

  // ───────────────────────── bots ─────────────────────────

  private botThink(u: Unit, t: number) {
    u.bot.think = 3;
    const inp = u.input;
    inp.fire = false; inp.ability = false; inp.revive = false; inp.reload = false;
    const def = SQ_ROLES[u.role];
    if (u.life === "dead") { inp.mx = inp.my = 0; return; }
    const mates = this.units.filter((m) => m !== u && m.team === u.team);
    if (u.life === "down") {
      // crawl toward the closest standing teammate
      const m = mates.filter((x) => x.life === "alive").sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y))[0];
      if (m) this.steer(u, m.x, m.y); else inp.mx = inp.my = 0;
      return;
    }
    // revive a downed teammate when it's safe-ish (healers always try)
    const downed = mates.filter((m) => m.life === "down").sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y))[0];
    const enemies = this.units.filter((e) => e.team !== u.team && e.life !== "dead");
    const visible = enemies
      .map((e) => ({ e, d: Math.hypot(e.x - u.x, e.y - u.y) }))
      .filter((v) => v.d < 950 && sqRayBlock(u.x, u.y, v.e.x, v.e.y) < 0)
      .sort((a, b) => (a.e.life === "alive" ? 0 : 1) - (b.e.life === "alive" ? 0 : 1) || a.d - b.d);
    const near = visible[0];
    if (downed && (u.role === "healer" || !near || near.d > 420) && Math.hypot(downed.x - u.x, downed.y - u.y) < 700) {
      const d = Math.hypot(downed.x - u.x, downed.y - u.y);
      if (d > SQ.REVIVE_RANGE * 0.7) this.steer(u, downed.x, downed.y);
      else { inp.mx = inp.my = 0; inp.revive = true; }
      if (near) inp.aim = Math.atan2(near.e.y - u.y, near.e.x - u.x);
      return;
    }
    if (u.ammo <= 0 || (!near && u.ammo < def.weapon.mag * 0.5)) inp.reload = true;
    if (near) {
      if (u.bot.targetId !== near.e.id) { u.bot.targetId = near.e.id; u.bot.seen = t; }
      const e = near.e;
      // lead the target a little, with some human-like error
      const tt = near.d / def.weapon.speed;
      const ax = e.x + e.vx * tt * 0.6, ay = e.y + e.vy * tt * 0.6;
      inp.aim = Math.atan2(ay - u.y, ax - u.x) + (this.rnd() - 0.5) * 0.14;
      inp.fire = t - u.bot.seen > 280 && near.d < def.weapon.range * 0.95;
      const want = u.role === "tank" ? 170 : u.role === "fighter" ? 320 : 430;
      const toward = near.d > want + 60 ? 1 : near.d < want - 80 ? -1 : 0;
      if (this.rnd() < 0.06) u.bot.strafe = -u.bot.strafe || 1;
      const ux = (e.x - u.x) / near.d, uy = (e.y - u.y) / near.d;
      const mx = ux * toward + -uy * u.bot.strafe * 0.8, my = uy * toward + ux * u.bot.strafe * 0.8;
      inp.mx = mx; inp.my = my;
      // abilities
      if (u.role === "tank" && u.hp < def.hp * 0.65 && near.d < 450) inp.ability = true;
      if (u.role === "fighter" && (u.hp < def.hp * 0.4 || (near.d > 360 && near.d < 600)) && this.rnd() < 0.3) inp.ability = true;
      if (u.role === "healer" && mates.some((m) => m.life === "alive" && m.hp < SQ_ROLES[m.role].hp * 0.7 && Math.hypot(m.x - u.x, m.y - u.y) < SQ_HEAL_PULSE.radius)) inp.ability = true;
      return;
    }
    u.bot.targetId = null;
    // nothing in sight: grab a nearby power-up, else push toward the enemy side
    const p = [...this.powers.values()].map((q) => ({ q, d: Math.hypot(q.x - u.x, q.y - u.y) })).sort((a, b) => a.d - b.d)[0];
    if (p && p.d < 380) { this.steer(u, p.q.x, p.q.y); return; }
    const target = enemies.sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y))[0];
    if (t > u.bot.wander) u.bot.wander = t + 2500 + this.rnd() * 2000;
    const gx = target ? target.x : SQ_SPAWN[otherSqTeam(u.team)].x, gy = target ? target.y : SQ.MAP_H / 2;
    this.steer(u, gx, gy + Math.sin(u.bot.wander / 900) * 140);
    inp.aim = Math.atan2(gy - u.y, gx - u.x);
  }

  /** Move toward (gx,gy), trying rotated directions when a wall is in the way. */
  private steer(u: Unit, gx: number, gy: number) {
    const base = Math.atan2(gy - u.y, gx - u.x);
    const step = 40;
    for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) {
      const a = base + off * (u.bot.strafe || 1);
      const [nx, ny] = sqMove(u.x, u.y, Math.cos(a) * step, Math.sin(a) * step);
      if (Math.hypot(nx - u.x, ny - u.y) > step * 0.7) { u.input.mx = Math.cos(a); u.input.my = Math.sin(a); return; }
    }
    u.input.mx = Math.cos(base); u.input.my = Math.sin(base);
  }

  // ───────────────────────── helpers ─────────────────────────

  private smallerTeam(): SqTeam {
    const r = this.units.filter((x) => x.team === "red" && !x.isBot).length;
    const b = this.units.filter((x) => x.team === "blue" && !x.isBot).length;
    return r <= b ? "red" : "blue";
  }

  private suggestRole(team: SqTeam): SqRole {
    const count = (r: SqRole) => this.units.filter((x) => x.team === team && x.nextRole === r).length;
    return [...ROLES].sort((a, b) => count(a) - count(b) || (a === "fighter" ? -1 : 1))[0];
  }

  private removeBot(team: SqTeam) {
    const i = this.units.findIndex((x) => x.isBot && x.team === team);
    if (i < 0) return false;
    this.units.splice(i, 1);
    return true;
  }

  private newUnit(id: string, nickname: string, isBot: boolean, team: SqTeam, role: SqRole): Unit {
    return {
      n: this.nextN++,
      id, nickname, isBot, connections: 0, team, role, nextRole: role, ready: isBot,
      x: 0, y: 0, vx: 0, vy: 0, aim: 0, input: idle(), hp: SQ_ROLES[role].hp, life: "dead", downHp: 0, lifeAt: 0, rev: 0, revThisTick: false,
      ammo: SQ_ROLES[role].weapon.mag, reloadUntil: 0, nextShot: 0, abilityAt: 0, actUntil: 0, dashX: 0, dashY: 0,
      power: null, powerUntil: 0, bubble: 0, lastDamageAt: 0, knockedBy: null, posAt: 0,
      kills: 0, knocks: 0, deaths: 0, revives: 0, damage: 0,
      bot: { think: 0, strafe: this.rnd() < 0.5 ? 1 : -1, seen: 0, targetId: null, wander: 0 },
    };
  }

  private addFeed(a: string, at: SqTeam | null, verb: string, b: string, bt: SqTeam | null) {
    this.feed.push({ at: this.now(), a, at_: at, verb, b, bt });
    if (this.feed.length > 20) this.feed.shift();
    this.pushMeta();
  }

  meta(): SqMeta {
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      settings: this.settings,
      players: this.units.map((u) => ({
        id: u.id, n: u.n, nickname: u.nickname, isBot: u.isBot, connected: u.connections > 0, team: u.team, role: u.nextRole, ready: u.ready,
        kills: u.kills, knocks: u.knocks, deaths: u.deaths, revives: u.revives, damage: Math.round(u.damage),
      })),
      score: { ...this.score },
      endsAt: this.endsAt,
      serverNow: this.now(),
      winner: this.winner,
      mvpId: this.mvpId,
      feed: this.feed.slice(-6),
    };
  }

  snapshot(): SqSnap {
    const t = this.now();
    const units: SqUnit[] = this.units.map((u) => ({
      id: u.id, team: u.team, role: u.role, x: Math.round(u.x * 10) / 10, y: Math.round(u.y * 10) / 10, a: Math.round(u.aim * 1000),
      vx: Math.round(u.vx), vy: Math.round(u.vy), hp: Math.ceil(u.life === "down" ? u.downHp : u.hp), maxHp: u.life === "down" ? SQ.DOWN_HP : SQ_ROLES[u.role].hp,
      life: u.life, rev: Math.round(u.rev * 100), timer: u.life !== "alive" ? Math.max(0, u.lifeAt - t) : 0,
      ammo: u.ammo, reloading: !!u.reloadUntil, cd: Math.max(0, u.abilityAt - t), act: t < u.actUntil,
      power: u.power, powerMs: u.power ? Math.max(0, u.powerUntil - t) : 0, bubble: u.bubble,
    }));
    const s: SqSnap = { t, tick: this.tickNo, units, powers: [...this.powers.values()] };
    if (this.shots.length) s.shots = this.shots;
    if (this.stops.length) s.stops = this.stops;
    if (this.dmg.length) s.dmg = this.dmg;
    if (this.pulses.length) s.pulses = this.pulses;
    this.shots = []; this.stops = []; this.dmg = []; this.pulses = [];
    return s;
  }

  private sendSnap() {
    if (this.destroyed) return;
    const s = this.snapshot();
    this.ev.snap(encodeSnap(s, (id) => this.units.find((u) => u.id === id)?.n ?? -1));
  }
  private pushMeta() { if (!this.destroyed) this.ev.meta(this.meta()); }
  private startLoop() { this.stopLoop(); this.loop = setInterval(() => this.step(), SQ.TICK_MS); }
  private stopLoop() { if (this.loop) { clearInterval(this.loop); this.loop = null; } }
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
