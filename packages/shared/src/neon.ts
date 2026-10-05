/**
 * NEON DRIFT — cars leave a glowing trail. Touch someone else's trail and you crash (your own is safe).
 *  • Grab ⛽ gas to make your trail longer (it follows you like a snake's body).
 *  • Cut in front of rivals so they hit your trail. Each crash into your trail = +1 kill.
 *  • Endless arena: no rounds. Crash → respawn 3 s later with a fresh short trail (and 2 s of spawn shield).
 *  • Power-ups last a few seconds: 🛡 Shield (drive through trails), ⚡ Turbo (free speed), 🧲 Magnet (pull gas).
 */

export const NEON = {
  /** 30 ticks per second. */
  TICK_MS: 33,
  CAR_R: 11,
  TRAIL_W: 8,
  SPEED: 230,
  BOOST_MULT: 1.75,
  TURBO_MULT: 1.6,
  TURN: 3.3,
  START_LEN: 260,
  GAS_LEN: 45,
  /** Trails stop growing here (keeps the arena playable and packets small). */
  MAX_LEN: 4000,
  GAS_R: 9,
  POWER_R: 16,
  MAGNET_R: 220,
  BOOST_DRAIN: 0.45,
  BOOST_REFILL: 0.12,
  RESPAWN_MS: 3000,
  /** Spawn protection. */
  SPAWN_SHIELD_MS: 2000,
  /** How quickly steering eases in/out (per second). */
  STEER_EASE: 14,
  /** Full trail resync every N ticks (~2 s). */
  FULL_EVERY: 60,
  /** Client renders this far in the past to always have two snapshots to blend. */
  INTERP_MS: 100,
  MAX_PLAYERS: 12,
} as const;

export const NEON_ARENAS = { small: 1800, medium: 2600, large: 3400 } as const;
export type NeonArena = keyof typeof NEON_ARENAS;

export type NeonPower = "shield" | "turbo" | "magnet";
export const NEON_POWERS: Record<NeonPower, { icon: string; label: string; ms: number }> = {
  shield: { icon: "🛡️", label: "Shield", ms: 5000 },
  turbo: { icon: "⚡", label: "Turbo", ms: 5000 },
  magnet: { icon: "🧲", label: "Magnet", ms: 8000 },
};

/** Car colours: body + bright trail. */
export const NEON_COLORS = [
  { car: "#ef4444", trail: "#ff7a7a" },
  { car: "#3b82f6", trail: "#7cc4ff" },
  { car: "#22c55e", trail: "#7dffaa" },
  { car: "#eab308", trail: "#fff07a" },
  { car: "#a855f7", trail: "#d9a6ff" },
  { car: "#ec4899", trail: "#ff9bd2" },
  { car: "#14b8a6", trail: "#6ffff0" },
  { car: "#f97316", trail: "#ffb36b" },
  { car: "#84cc16", trail: "#d4ff6b" },
  { car: "#06b6d4", trail: "#8af3ff" },
  { car: "#f43f5e", trail: "#ff9aac" },
  { car: "#e5e7eb", trail: "#ffffff" },
];

export interface NeonSettings {
  arena: NeonArena;
  bots: number;
}
export const DEFAULT_NEON_SETTINGS: NeonSettings = { arena: "medium", bots: 3 };

export function normaliseNeonSettings(s: Partial<NeonSettings> | undefined): NeonSettings {
  const arena: NeonArena = s?.arena === "small" || s?.arena === "large" ? s.arena : "medium";
  const b = Math.round(Number(s?.bots));
  return { arena, bots: Number.isFinite(b) ? Math.min(8, Math.max(0, b)) : DEFAULT_NEON_SETTINGS.bots };
}

export type NeonPhase = "lobby" | "playing" | "roundover";

export interface NeonPlayerPublic {
  id: string;
  nickname: string;
  isBot: boolean;
  connected: boolean;
  color: number;
  score: number;
  kills: number;
  wins: number;
  /** Longest trail this session. */
  best: number;
}

/** Slow-changing room info (sent on change). */
export interface NeonMeta {
  code: string;
  phase: NeonPhase;
  hostId: string;
  settings: NeonSettings;
  size: number;
  players: NeonPlayerPublic[];
  round: number;
  winnerId: string | null;
  roundEndsAt: number;
  serverNow: number;
  feed: { at: number; text: string }[];
}

/** One car in a tick snapshot. Numbers are rounded to keep packets small. */
export interface NeonCarSnap {
  id: string;
  x: number;
  y: number;
  /** Angle × 100. */
  a: number;
  /** Trail length budget. */
  len: number;
  alive: boolean;
  boosting: boolean;
  /** Boost fuel 0–100. */
  fuel: number;
  power: NeonPower | null;
  /** ms of power left. */
  powerMs: number;
  /** ms until respawn (crashed cars). */
  respawnMs: number;
}

export interface NeonSnap {
  t: number;
  tick: number;
  cars: NeonCarSnap[];
  /** Full trails (only on resync ticks): id → flat [x0,y0,x1,y1,…] oldest first. */
  trails?: Record<string, number[]>;
  /** Full gas list (resync) or diffs. Flat [id,x,y,…]. */
  gas?: number[];
  gasAdd?: number[];
  gasDel?: number[];
  powers?: { id: number; x: number; y: number; kind: NeonPower }[];
}

export type NeonAction =
  | { type: "start" }
  | { type: "settings"; settings: Partial<NeonSettings> }
  | { type: "to_lobby" };
