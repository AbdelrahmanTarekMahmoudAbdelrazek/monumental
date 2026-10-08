/**
 * SQUAD RUSH — top-down team shooter.
 *  • Red vs Blue. Three roles: Healer (revives in 1 s, Heal Pulse), Tank (200 HP, Shield Wall), Fighter (fast, best gun, Dash).
 *  • At 0 HP you're KNOCKED DOWN: crawl, can't shoot. A teammate holds E next to you to revive you.
 *    Enemies can finish you; after 15 s you bleed out. Each elimination scores 1 for the team.
 *  • Power-ups spawn on the ground: Triple Shot, Speed, Medkit, Bubble Shield.
 */

export const SQ = {
  TICK_MS: 33,
  MAP_W: 2400,
  MAP_H: 1500,
  R: 20,
  DOWN_HP: 60,
  BLEED_MS: 15000,
  RESPAWN_MS: 5000,
  REVIVE_RANGE: 70,
  REVIVE_HP: 0.4,
  CRAWL_SPEED: 55,
  PICKUP_R: 34,
  BULLET_LIFE_MS: 1200,
  MAX_PLAYERS: 12,
  /** Seconds of no damage before slow health regen starts. */
  REGEN_DELAY: 5,
  REGEN_PER_S: 6,
} as const;

export type SqTeam = "red" | "blue";
export type SqRole = "healer" | "tank" | "fighter";
export const otherSqTeam = (t: SqTeam): SqTeam => (t === "red" ? "blue" : "red");

export interface SqWeapon {
  name: string;
  damage: number;
  /** ms between shots. */
  interval: number;
  speed: number;
  range: number;
  pellets: number;
  spread: number;
  mag: number;
  reloadMs: number;
}

export interface SqRoleDef {
  label: string;
  hp: number;
  speed: number;
  reviveMs: number;
  weapon: SqWeapon;
  ability: { name: string; key: string; cooldownMs: number; durationMs: number; info: string };
  accent: string;
  tagline: string;
}

export const SQ_ROLES: Record<SqRole, SqRoleDef> = {
  healer: {
    label: "Healer", hp: 100, speed: 235, reviveMs: 1000, accent: "#3DD68C",
    tagline: "Keeps the squad standing. Revives in 1 second.",
    weapon: { name: "Med Pistol", damage: 15, interval: 240, speed: 950, range: 700, pellets: 1, spread: 0.03, mag: 16, reloadMs: 1100 },
    ability: { name: "Heal Pulse", key: "RMB", cooldownMs: 12000, durationMs: 0, info: "+40 HP to nearby teammates" },
  },
  tank: {
    label: "Tank", hp: 200, speed: 185, reviveMs: 3000, accent: "#A9B6C6",
    tagline: "Big, slow, hard to drop. Shield the team.",
    weapon: { name: "Breacher Shotgun", damage: 10, interval: 720, speed: 820, range: 380, pellets: 6, spread: 0.32, mag: 6, reloadMs: 1700 },
    ability: { name: "Shield Wall", key: "RMB", cooldownMs: 15000, durationMs: 4000, info: "Blocks all bullets in front for 4s" },
  },
  fighter: {
    label: "Fighter", hp: 70, speed: 290, reviveMs: 3000, accent: "#FFB224",
    tagline: "Fast and deadly but fragile. Flank, strike, get out.",
    weapon: { name: "Striker Rifle", damage: 14, interval: 105, speed: 1250, range: 900, pellets: 1, spread: 0.05, mag: 30, reloadMs: 1400 },
    ability: { name: "Dash", key: "RMB", cooldownMs: 6000, durationMs: 180, info: "Burst forward" },
  },
};

export const SQ_HEAL_PULSE = { radius: 240, amount: 40 };
export const SQ_DASH_MULT = 4.2;
/** Shield wall: arc in front of the tank, radius & half-angle. */
export const SQ_SHIELD = { radius: 58, halfAngle: 1.1 };

export type SqPower = "triple" | "speed" | "medkit" | "bubble";
export const SQ_POWERS: Record<SqPower, { label: string; ms: number; color: string }> = {
  triple: { label: "Triple Shot", ms: 8000, color: "#FFB224" },
  speed: { label: "Speed", ms: 6000, color: "#7DD3FC" },
  medkit: { label: "Medkit", ms: 0, color: "#3DD68C" },
  bubble: { label: "Bubble", ms: 12000, color: "#C4B5FD" },
};

// ───────────────────────── map ─────────────────────────

export interface SqRect { x: number; y: number; w: number; h: number; kind: "wall" | "crate" }
export interface SqBush { x: number; y: number; r: number }

/** Left half of the "Dockyard" map; mirrored for the right so both teams get the same cover. */
const HALF: SqRect[] = [
  { x: 330, y: 230, w: 260, h: 34, kind: "wall" },
  { x: 330, y: 230, w: 34, h: 220, kind: "wall" },
  { x: 330, y: 1236, w: 260, h: 34, kind: "wall" },
  { x: 330, y: 1050, w: 34, h: 220, kind: "wall" },
  { x: 640, y: 560, w: 70, h: 70, kind: "crate" },
  { x: 640, y: 870, w: 70, h: 70, kind: "crate" },
  { x: 820, y: 330, w: 34, h: 250, kind: "wall" },
  { x: 820, y: 920, w: 34, h: 250, kind: "wall" },
  { x: 960, y: 700, w: 60, h: 60, kind: "crate" },
  { x: 1020, y: 180, w: 56, h: 56, kind: "crate" },
  { x: 1020, y: 1264, w: 56, h: 56, kind: "crate" },
];
const CENTER: SqRect[] = [
  { x: 1160, y: 640, w: 80, h: 80, kind: "crate" },
  { x: 1160, y: 780, w: 80, h: 80, kind: "crate" },
  { x: 1110, y: 420, w: 180, h: 34, kind: "wall" },
  { x: 1110, y: 1046, w: 180, h: 34, kind: "wall" },
];
export const SQ_OBSTACLES: SqRect[] = [
  ...HALF,
  ...HALF.map((r) => ({ ...r, x: SQ.MAP_W - r.x - r.w })),
  ...CENTER,
];
export const SQ_BUSHES: SqBush[] = [
  { x: 520, y: 750, r: 56 }, { x: 1880, y: 750, r: 56 },
  { x: 1200, y: 250, r: 60 }, { x: 1200, y: 1250, r: 60 },
  { x: 760, y: 1360, r: 46 }, { x: 1640, y: 140, r: 46 },
];
export const SQ_POWER_SPOTS: { x: number; y: number }[] = [
  { x: 1200, y: 560 }, { x: 1200, y: 940 }, { x: 900, y: 140 }, { x: 1500, y: 1360 },
  { x: 560, y: 470 }, { x: 1840, y: 1030 }, { x: 560, y: 1030 }, { x: 1840, y: 470 },
];
export const SQ_SPAWN: Record<SqTeam, { x: number; y0: number; y1: number }> = {
  red: { x: 120, y0: 560, y1: 940 },
  blue: { x: SQ.MAP_W - 120, y0: 560, y1: 940 },
};

// ───────────────────────── geometry (shared by server + client prediction) ─────────────────────────

/** Move a circle by (dx,dy), sliding along walls/crates and the map edge. */
export function sqMove(x: number, y: number, dx: number, dy: number, r = SQ.R): [number, number] {
  let nx = x + dx;
  for (const o of SQ_OBSTACLES) {
    if (y + r > o.y && y - r < o.y + o.h && nx + r > o.x && nx - r < o.x + o.w) nx = dx > 0 ? o.x - r : o.x + o.w + r;
  }
  nx = Math.min(SQ.MAP_W - r, Math.max(r, nx));
  let ny = y + dy;
  for (const o of SQ_OBSTACLES) {
    if (nx + r > o.x && nx - r < o.x + o.w && ny + r > o.y && ny - r < o.y + o.h) ny = dy > 0 ? o.y - r : o.y + o.h + r;
  }
  ny = Math.min(SQ.MAP_H - r, Math.max(r, ny));
  return [nx, ny];
}

/** Is a circle at (x,y) inside the map and clear of every wall/crate? */
export function sqFree(x: number, y: number, r = SQ.R - 1): boolean {
  if (x < r || y < r || x > SQ.MAP_W - r || y > SQ.MAP_H - r) return false;
  for (const o of SQ_OBSTACLES) {
    const cx = Math.max(o.x, Math.min(x, o.x + o.w)), cy = Math.max(o.y, Math.min(y, o.y + o.h));
    if ((cx - x) ** 2 + (cy - y) ** 2 < r * r) return false;
  }
  return true;
}

/** Does segment p→q cross the rect? Returns the fraction along the segment (0…1) of the first hit, or -1. */
export function segRect(px: number, py: number, qx: number, qy: number, o: { x: number; y: number; w: number; h: number }): number {
  const dx = qx - px, dy = qy - py;
  let t0 = 0, t1 = 1;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  if (clip(-dx, px - o.x) && clip(dx, o.x + o.w - px) && clip(-dy, py - o.y) && clip(dy, o.y + o.h - py)) return t0;
  return -1;
}

/** First obstacle hit along p→q (fraction), or -1. */
export function sqRayBlock(px: number, py: number, qx: number, qy: number): number {
  let best = -1;
  for (const o of SQ_OBSTACLES) {
    const t = segRect(px, py, qx, qy, o);
    if (t >= 0 && (best < 0 || t < best)) best = t;
  }
  return best;
}

/** Fraction along p→q where it first comes within r of point c, or -1. */
export function segCircle(px: number, py: number, qx: number, qy: number, cx: number, cy: number, r: number): number {
  const dx = qx - px, dy = qy - py, fx = px - cx, fy = py - cy;
  const a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  if (a === 0) return -1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

// ───────────────────────── settings & state ─────────────────────────

export interface SqSettings {
  /** Eliminations to win. */
  target: number;
  /** Match length in minutes. */
  minutes: number;
  /** Fill each team with bots up to this many players. */
  teamSize: number;
}
export const DEFAULT_SQ_SETTINGS: SqSettings = { target: 25, minutes: 6, teamSize: 4 };
export function normaliseSqSettings(s: Partial<SqSettings> | undefined): SqSettings {
  const c = (v: unknown, lo: number, hi: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  return {
    target: c(s?.target, 5, 100, DEFAULT_SQ_SETTINGS.target),
    minutes: c(s?.minutes, 2, 20, DEFAULT_SQ_SETTINGS.minutes),
    teamSize: c(s?.teamSize, 1, 6, DEFAULT_SQ_SETTINGS.teamSize),
  };
}

export type SqPhase = "lobby" | "playing" | "ended";
export type SqLife = "alive" | "down" | "dead";

export interface SqPlayerPublic {
  id: string;
  /** Short number used for this player in snapshots. */
  n: number;
  nickname: string;
  isBot: boolean;
  connected: boolean;
  team: SqTeam;
  role: SqRole;
  ready: boolean;
  kills: number;
  knocks: number;
  deaths: number;
  revives: number;
  damage: number;
}

export interface SqMeta {
  code: string;
  phase: SqPhase;
  hostId: string;
  settings: SqSettings;
  players: SqPlayerPublic[];
  score: Record<SqTeam, number>;
  endsAt: number;
  serverNow: number;
  winner: SqTeam | "draw" | null;
  mvpId: string | null;
  feed: { at: number; a: string; at_: SqTeam | null; verb: string; b: string; bt: SqTeam | null }[];
}

/** One unit in a tick snapshot (numbers rounded). */
export interface SqUnit {
  id: string;
  team: SqTeam;
  /** Role currently in play (the next one applies after respawning). */
  role: SqRole;
  x: number;
  y: number;
  /** Aim angle × 1000. */
  a: number;
  /** Velocity (px/s) — clients use it to extrapolate. */
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  life: SqLife;
  /** 0–100 while being revived. */
  rev: number;
  /** ms left: bleed-out when down, respawn when dead. */
  timer: number;
  ammo: number;
  reloading: boolean;
  /** ms until the ability is ready. */
  cd: number;
  /** Ability active (shield up / dashing). */
  act: boolean;
  power: SqPower | null;
  powerMs: number;
  /** Bubble hits left. */
  bubble: number;
}

export interface SqSnap {
  t: number;
  tick: number;
  units: SqUnit[];
  /** New bullets this tick: [id, x, y, angle×1000, speed, range, team(0 red/1 blue)] flattened. */
  shots?: number[];
  /** Bullets that stopped (hit something). Flat [id, x, y, kind] kind: 0 wall, 1 player, 2 shield. */
  stops?: number[];
  /** Damage numbers: flat [x, y, amount, targetIsMe? not used] */
  dmg?: number[];
  /** Heal pulses: flat [x, y] */
  pulses?: number[];
  powers: { id: number; x: number; y: number; kind: SqPower }[];
}

// ───────────────────────── compact wire format ─────────────────────────
// Snapshots go out 20×/s to every player, so units travel as short number arrays (≈5× smaller than JSON objects).

const ROLE_I: SqRole[] = ["healer", "tank", "fighter"];
const LIFE_I: SqLife[] = ["alive", "down", "dead"];
const POWER_I: SqPower[] = ["triple", "speed", "medkit", "bubble"];

/** Wire snapshot: `u` rows are [n, team, role, x×10, y×10, aim×1000, vx, vy, hp, maxHp, life, rev, timer/100, ammo, reloading, cd/100, act, power, powerMs/100, bubble]. */
export interface SqWire {
  t: number;
  k: number;
  u: number[][];
  s?: number[];
  st?: number[];
  d?: number[];
  pl?: number[];
  /** Power-ups: flat [id, x, y, kind]. */
  w: number[];
}

export function encodeSnap(s: SqSnap, nOf: (id: string) => number): SqWire {
  const w: SqWire = {
    t: s.t,
    k: s.tick,
    u: s.units.map((u) => [
      nOf(u.id), u.team === "red" ? 0 : 1, ROLE_I.indexOf(u.role), Math.round(u.x * 10), Math.round(u.y * 10), u.a, u.vx, u.vy,
      u.hp, u.maxHp, LIFE_I.indexOf(u.life), u.rev, Math.round(u.timer / 100), u.ammo, u.reloading ? 1 : 0, Math.round(u.cd / 100),
      u.act ? 1 : 0, u.power ? POWER_I.indexOf(u.power) : -1, Math.round(u.powerMs / 100), u.bubble,
    ]),
    w: s.powers.flatMap((p) => [p.id, p.x, p.y, POWER_I.indexOf(p.kind)]),
  };
  if (s.shots) w.s = s.shots;
  if (s.stops) w.st = s.stops;
  if (s.dmg) w.d = s.dmg;
  if (s.pulses) w.pl = s.pulses;
  return w;
}

export function decodeSnap(w: SqWire, idOf: (n: number) => string | undefined): SqSnap {
  const units: SqUnit[] = [];
  for (const r of w.u) {
    const id = idOf(r[0]) ?? `#${r[0]}`; // keep row order: shots refer to units by index
    units.push({
      id, team: r[1] === 0 ? "red" : "blue", role: ROLE_I[r[2]] ?? "fighter", x: r[3] / 10, y: r[4] / 10, a: r[5], vx: r[6], vy: r[7],
      hp: r[8], maxHp: r[9], life: LIFE_I[r[10]] ?? "alive", rev: r[11], timer: r[12] * 100, ammo: r[13], reloading: r[14] === 1,
      cd: r[15] * 100, act: r[16] === 1, power: r[17] >= 0 ? POWER_I[r[17]] : null, powerMs: r[18] * 100, bubble: r[19],
    });
  }
  const powers: SqSnap["powers"] = [];
  for (let i = 0; i + 3 < w.w.length; i += 4) powers.push({ id: w.w[i], x: w.w[i + 1], y: w.w[i + 2], kind: POWER_I[w.w[i + 3]] ?? "medkit" });
  return { t: w.t, tick: w.k, units, powers, shots: w.s, stops: w.st, dmg: w.d, pulses: w.pl };
}

export type SqAction =
  | { type: "start" }
  | { type: "settings"; settings: Partial<SqSettings> }
  | { type: "team"; team: SqTeam }
  | { type: "role"; role: SqRole }
  | { type: "bot"; team: SqTeam; op: "add" | "remove" }
  | { type: "to_lobby" };

/** Controls sent every time they change (and at most ~30×/s for aim). */
export interface SqInput {
  /** Move direction, −1…1 each. */
  mx: number;
  my: number;
  aim: number;
  fire: boolean;
  ability: boolean;
  revive: boolean;
  reload: boolean;
  seq: number;
  /** Where the player's own screen has them (client-side movement). The server accepts it if it's a legal move. */
  px?: number;
  py?: number;
}
