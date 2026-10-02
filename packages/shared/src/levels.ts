import type { LevelConfig } from "./types";

/**
 * Difficulty rises through five dials:
 *  1. tiers       – famous monuments first, obscure ones later
 *  2. ratioBand   – |log2(target/base)|: big gaps are easy, near-equal is hard,
 *                   extreme (>4 = 16×) needs zoom-to-fit and is hardest to eyeball
 *  3. timerSec    – 30s down to 10s
 *  4. helpers     – full (grid + ruler) → ruler → none → silhouette only
 *  5. extremes    – top levels mix near-equal AND extreme ratios
 */
export const LEVELS: LevelConfig[] = [
  { id: 1, name: "Tourist", tagline: "World icons, huge gaps, all the help you need", timerSec: 30, tiers: [1], ratioBand: { minLog2: 1.5, maxLog2: 3.5 }, helpers: "full", roundsPerSession: 10 },
  { id: 2, name: "Backpacker", tagline: "Still famous, a little closer in size", timerSec: 30, tiers: [1], ratioBand: { minLog2: 1.0, maxLog2: 3.0 }, helpers: "full", roundsPerSession: 10 },
  { id: 3, name: "Explorer", tagline: "Well-known landmarks join the pool", timerSec: 25, tiers: [1, 2], ratioBand: { minLog2: 0.8, maxLog2: 2.5 }, helpers: "ruler", roundsPerSession: 10 },
  { id: 4, name: "Guide", tagline: "No grid lines — just a ruler", timerSec: 25, tiers: [1, 2], ratioBand: { minLog2: 0.5, maxLog2: 2.0 }, helpers: "ruler", roundsPerSession: 10 },
  { id: 5, name: "Surveyor", tagline: "Ruler gone. Eyes only.", timerSec: 20, tiers: [1, 2, 3], ratioBand: { minLog2: 0.4, maxLog2: 1.8 }, helpers: "none", roundsPerSession: 10 },
  { id: 6, name: "Architect", tagline: "Lesser-known monuments, tighter ratios", timerSec: 20, tiers: [2, 3], ratioBand: { minLog2: 0.25, maxLog2: 1.5 }, helpers: "none", roundsPerSession: 10 },
  { id: 7, name: "Historian", tagline: "Nearly equal heights — can you tell?", timerSec: 15, tiers: [2, 3], ratioBand: { minLog2: 0.1, maxLog2: 1.0 }, helpers: "none", roundsPerSession: 10 },
  { id: 8, name: "Cartographer", tagline: "Silhouettes only, extreme scale jumps", timerSec: 15, tiers: [1, 2, 3, 4], ratioBand: { minLog2: 3.5, maxLog2: 8 }, helpers: "silhouette", roundsPerSession: 10 },
  { id: 9, name: "Colossus", tagline: "Obscure monuments, razor-thin margins", timerSec: 10, tiers: [3, 4], ratioBand: { minLog2: 0.05, maxLog2: 0.7 }, helpers: "silhouette", roundsPerSession: 10 },
  { id: 10, name: "Monumental", tagline: "Everything. Tiny vs. titanic. 10 seconds.", timerSec: 10, tiers: [1, 2, 3, 4], ratioBand: { minLog2: 0.05, maxLog2: 8 }, helpers: "silhouette", roundsPerSession: 10 },
  { id: 11, name: "Legend", tagline: "Bonus: near-equal AND extreme, no mercy", timerSec: 8, tiers: [3, 4], ratioBand: { minLog2: 0.03, maxLog2: 8 }, helpers: "silhouette", roundsPerSession: 12 },
];

export const LOBBY_SECONDS = 12;
export const REVEAL_SECONDS = 8;
export const INTERMISSION_SECONDS = 15; // between sessions

export function getLevel(id: number): LevelConfig {
  const lvl = LEVELS.find((l) => l.id === id);
  if (!lvl) throw new Error(`Unknown level ${id}`);
  return lvl;
}
