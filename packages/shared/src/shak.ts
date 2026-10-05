/**
 * أشك (Shak) — the Egyptian dominoes bluffing game.
 * Rules (domono.net/how-to-play/shak):
 *  • 3–4 players. 4 players → 7 tiles each. 3 players → 9 each, 1 tile set aside face-down. No boneyard.
 *  • The holder of 6|6 starts (if it's the set-aside tile: the holder of the largest double).
 *  • The starter announces a number 0–6 and plays one or more tiles face-down, claiming every one
 *    carries that number (on either half).
 *  • On your turn: play one or more tiles claiming the same number, pass (always allowed), or say «أشك»
 *    to challenge ONLY the last play — valid until someone plays or passes after it.
 *  • Challenge: flip only that play. All carry the number → doubter takes every tile on the table.
 *    Any one doesn't → the player who made the play takes them. Then the tile-player starts a new pile
 *    with a fresh number (or the next player, if the tile-player's hand is empty).
 *  • Everyone with tiles passes in a row → table tiles are removed for good; the next player starts fresh.
 *  • A player who plays their last tile is out once that play survives (next play/pass, or a failed doubt).
 *    First out = king 👑, last one holding tiles = fool. No points.
 */

export type Tile = readonly [number, number];

/** All 28 tiles, id = index. */
export const ALL_TILES: Tile[] = (() => {
  const t: Tile[] = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) t.push([a, b] as const);
  return t;
})();

export const tileOf = (id: number): Tile => ALL_TILES[id];
export const tileHas = (id: number, n: number) => ALL_TILES[id][0] === n || ALL_TILES[id][1] === n;
export const isDouble = (id: number) => ALL_TILES[id][0] === ALL_TILES[id][1];
export const DOUBLE_66 = ALL_TILES.findIndex(([a, b]) => a === 6 && b === 6);

export interface ShakSettings {
  /** Seconds per turn before an automatic pass (or an automatic play when you must start a pile). */
  turnSec: number;
  /** Max tiles in one play (rules don't limit it; 0 = no limit). */
  maxPerPlay: number;
}
export const DEFAULT_SHAK_SETTINGS: ShakSettings = { turnSec: 30, maxPerPlay: 0 };
export const SHAK_LIMITS = { turnSec: { min: 10, max: 120 }, maxPerPlay: { min: 0, max: 9 } } as const;

export function normaliseShakSettings(s: Partial<ShakSettings> | undefined): ShakSettings {
  const c = (v: unknown, lo: number, hi: number, d: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  return {
    turnSec: c(s?.turnSec, SHAK_LIMITS.turnSec.min, SHAK_LIMITS.turnSec.max, DEFAULT_SHAK_SETTINGS.turnSec),
    maxPerPlay: c(s?.maxPerPlay, SHAK_LIMITS.maxPerPlay.min, SHAK_LIMITS.maxPerPlay.max, DEFAULT_SHAK_SETTINGS.maxPerPlay),
  };
}

/** Deal for 3 or 4 players. `rnd` returns [0,1). */
export function dealShak(players: number, rnd: () => number): { hands: number[][]; excluded: number[] } {
  if (players < 3 || players > 4) throw new Error("Shak needs 3 or 4 players");
  const ids = ALL_TILES.map((_, i) => i);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const per = players === 4 ? 7 : 9;
  const hands = Array.from({ length: players }, (_, p) => ids.slice(p * per, p * per + per).sort((x, y) => x - y));
  const excluded = ids.slice(players * per);
  return { hands, excluded };
}

/** Seat index of the starter: holder of 6|6, else holder of the largest double. */
export function shakStarter(hands: number[][]): number {
  for (let d = 6; d >= 0; d--) {
    const id = ALL_TILES.findIndex(([a, b]) => a === d && b === d);
    const seat = hands.findIndex((h) => h.includes(id));
    if (seat >= 0) return seat;
  }
  return 0;
}

/** A claim is true only if every played tile carries the number. */
export function claimIsTrue(tiles: number[], n: number) {
  return tiles.every((t) => tileHas(t, n));
}

// ───────────────────────── public / private state sent to clients ─────────────────────────

export type ShakPhase = "waiting" | "playing" | "reveal" | "finished";

export interface ShakPlayerPublic {
  id: string;
  nickname: string;
  isBot: boolean;
  connected: boolean;
  /** Tiles in hand (count only — never the faces). */
  tiles: number;
  /** 1 = king, 2, 3… once out; null while still playing. */
  outRank: number | null;
  /** Played their last tile; out once the play survives. */
  pendingExit: boolean;
  /** Kings won in this room. */
  crowns: number;
}

export interface ShakReveal {
  doubterId: string;
  playerId: string;
  number: number;
  tiles: number[];
  truthful: boolean;
  loserId: string;
  /** How many table tiles the loser picked up. */
  taken: number;
}

export interface ShakPublicState {
  code: string;
  phase: ShakPhase;
  hostId: string;
  settings: ShakSettings;
  players: ShakPlayerPublic[];
  turnId: string | null;
  turnEndsAt: number;
  serverNow: number;
  /** Announced number for the current pile; null = the turn player must start a pile. */
  number: number | null;
  tableCount: number;
  /** Plays on the current pile, oldest first. */
  plays: { by: string; count: number }[];
  /** True while «أشك» is allowed on the last play. */
  doubtOpen: boolean;
  /** Set aside face-down this round (3-player games). */
  excludedCount: number;
  round: number;
  reveal?: ShakReveal;
  /** Last notable event, for toasts. */
  log?: { kind: "pass" | "play" | "doubt" | "clear" | "out" | "start"; by?: string; text: string; at: number };
  result?: { order: string[]; kingId: string; foolId: string | null; hands: { id: string; tiles: number[] }[] };
}
