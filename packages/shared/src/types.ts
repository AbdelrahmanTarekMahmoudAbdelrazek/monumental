export type MonumentCategory =
  | "ancient"
  | "religious"
  | "tower"
  | "statue"
  | "skyscraper"
  | "bridge"
  | "landmark";

/** 1 = world-famous, 2 = well known, 3 = lesser known, 4 = obscure */
export type DifficultyTier = 1 | 2 | 3 | 4;

export interface Silhouette {
  /** Width of the silhouette box in the same units as its height (height is always 100). */
  w: number;
  /** SVG path data in a `0..w` × `0..100` box. y=100 is the ground line. */
  d: string;
}

export interface Monument {
  id: string;
  name: string;
  country: string;
  /** Height in metres (see heightNote for what is / isn't included). */
  heightM: number;
  heightNote: string;
  category: MonumentCategory;
  tier: DifficultyTier;
  funFact: string;
  /** Original silhouette drawn for this project. */
  silhouette: Silhouette;
  /** Optional public-domain image (Wikimedia Commons) with attribution. */
  image?: { url: string; attribution: string };
}

export type HelperLevel = "full" | "ruler" | "none" | "silhouette";

export interface LevelConfig {
  id: number;
  name: string;
  tagline: string;
  /** Round timer in seconds. */
  timerSec: number;
  /** Which monument tiers can appear. */
  tiers: DifficultyTier[];
  /** Allowed |log2(ratio)| band — how different the two heights may be. */
  ratioBand: { minLog2: number; maxLog2: number };
  helpers: HelperLevel;
  roundsPerSession: number;
  /** Lock-in required to score? If false, the last drag position counts. */
  unlockToPlay?: number; // minimum points to unlock (0 = free)
}

export interface RoundPair {
  baseId: string;
  targetId: string;
  /** target/base height ratio * 100 — only ever sent AFTER the round. */
}

export type RoomPhase = "lobby" | "round" | "reveal" | "finished";

export interface PlayerPublic {
  id: string;
  nickname: string;
  locked: boolean;
  totalPoints: number;
  isGuest: boolean;
  connected: boolean;
}

export interface RoundResultEntry {
  playerId: string;
  nickname: string;
  guessPct: number | null;
  errorPct: number | null;
  points: number;
  rank: number | null;
}

export interface RoundResult {
  roundIndex: number;
  baseId: string;
  targetId: string;
  realPct: number;
  entries: RoundResultEntry[];
  leaderboard: { playerId: string; nickname: string; totalPoints: number }[];
}

export interface SessionResult {
  sessionId: string;
  levelId: number;
  leaderboard: { playerId: string; nickname: string; totalPoints: number; avgError: number }[];
  winnerId: string | null;
}

export interface RoomState {
  roomId: string;
  levelId: number;
  phase: RoomPhase;
  /** Server epoch ms when the current phase ends. */
  phaseEndsAt: number;
  /** Server epoch ms "now" when the snapshot was taken (for clock sync). */
  serverNow: number;
  roundIndex: number;
  roundsPerSession: number;
  sessionId: string;
  players: PlayerPublic[];
  /** Present only during round/reveal. */
  round?: { baseId: string; targetId: string; timerSec: number; roundId: string };
  /** Present only during reveal. */
  result?: RoundResult;
  sessionResult?: SessionResult;
  tournament?: { id: string; name: string; stage: number; stageName: string };
}
