import type { LevelConfig, MonumentCategory } from "./types";

const M: MonumentCategory[] = ["ancient", "religious", "tower", "statue", "skyscraper", "bridge", "landmark"];

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
  { id: 1, name: "Tourist", tagline: "World icons, huge gaps, all the help you need", timerSec: 30, tiers: [1], ratioBand: { minLog2: 1.5, maxLog2: 3.5 }, helpers: "full", roundsPerSession: 10, mode: "classic", categories: M },
  { id: 2, name: "Backpacker", tagline: "Still famous, a little closer in size", timerSec: 30, tiers: [1], ratioBand: { minLog2: 1.0, maxLog2: 3.0 }, helpers: "full", roundsPerSession: 10, mode: "classic", categories: M },
  { id: 3, name: "Explorer", tagline: "Well-known landmarks join the pool", timerSec: 25, tiers: [1, 2], ratioBand: { minLog2: 0.8, maxLog2: 2.5 }, helpers: "ruler", roundsPerSession: 10, mode: "classic", categories: M },
  { id: 4, name: "Guide", tagline: "No grid lines — just a ruler", timerSec: 25, tiers: [1, 2], ratioBand: { minLog2: 0.5, maxLog2: 2.0 }, helpers: "ruler", roundsPerSession: 10, mode: "classic", categories: M },
  { id: 5, name: "Surveyor", tagline: "Ruler gone. Eyes only.", timerSec: 20, tiers: [1, 2, 3], ratioBand: { minLog2: 0.4, maxLog2: 1.8 }, helpers: "none", roundsPerSession: 10, mode: "classic", categories: M },
  { id: 6, name: "Architect", tagline: "Lesser-known monuments, tighter ratios", timerSec: 20, tiers: [2, 3], ratioBand: { minLog2: 0.25, maxLog2: 1.5 }, helpers: "none", roundsPerSession: 10, mode: "classic", categories: M },
  { id: 7, name: "Historian", tagline: "Nearly equal heights — can you tell?", timerSec: 15, tiers: [2, 3], ratioBand: { minLog2: 0.1, maxLog2: 1.0 }, helpers: "none", roundsPerSession: 10, mode: "classic", categories: M },
  { id: 8, name: "Cartographer", tagline: "Silhouettes only, extreme scale jumps", timerSec: 15, tiers: [1, 2, 3, 4], ratioBand: { minLog2: 3.5, maxLog2: 8 }, helpers: "silhouette", roundsPerSession: 10, mode: "classic", categories: M },
  { id: 9, name: "Colossus", tagline: "Obscure monuments, razor-thin margins", timerSec: 10, tiers: [3, 4], ratioBand: { minLog2: 0.05, maxLog2: 0.7 }, helpers: "silhouette", roundsPerSession: 10, mode: "classic", categories: M },
  { id: 10, name: "Monumental", tagline: "Everything. Tiny vs. titanic. 10 seconds.", timerSec: 10, tiers: [1, 2, 3, 4], ratioBand: { minLog2: 0.05, maxLog2: 8 }, helpers: "silhouette", roundsPerSession: 10, mode: "classic", categories: M },
  { id: 11, name: "Legend", tagline: "Bonus: near-equal AND extreme, no mercy", timerSec: 8, tiers: [3, 4], ratioBand: { minLog2: 0.03, maxLog2: 8 }, helpers: "silhouette", roundsPerSession: 12, mode: "classic", categories: M },

  // ───────── Mixed mode: monuments, animals, nature, vehicles and space together ─────────
  { id: 12, name: "Mix: Starter", tagline: "Animals, mountains, rockets and monuments — famous ones, big gaps", timerSec: 30, tiers: [1, 2], ratioBand: { minLog2: 1.0, maxLog2: 3.5 }, helpers: "full", roundsPerSession: 10, mode: "mixed", crossGroup: true },
  { id: 13, name: "Mix: Explorer", tagline: "Everything mixed, closer sizes, only a ruler", timerSec: 25, tiers: [1, 2, 3], ratioBand: { minLog2: 0.4, maxLog2: 3 }, helpers: "ruler", roundsPerSession: 10, mode: "mixed", crossGroup: true },
  { id: 14, name: "Mix: Expert", tagline: "Obscure picks, wild scale jumps, no helpers", timerSec: 15, tiers: [1, 2, 3, 4], ratioBand: { minLog2: 0.15, maxLog2: 7 }, helpers: "none", roundsPerSession: 10, mode: "mixed", crossGroup: true },
  { id: 15, name: "Cosmic", tagline: "Moons, planets and stars — from Halley's Comet to Betelgeuse", timerSec: 20, tiers: [1, 2, 3, 4], ratioBand: { minLog2: 0.1, maxLog2: 8 }, helpers: "ruler", roundsPerSession: 10, mode: "mixed", categories: ["space"] },
];

export const DUEL_LEVELS: LevelConfig[] = [
  { id: 20, name: "Movies", tagline: "Which film has the higher IMDb rating?", timerSec: 10, tiers: [1, 2, 3], ratioBand: { minLog2: 0, maxLog2: 99 }, helpers: "none", roundsPerSession: 10, mode: "duel", kind: "duel", duelCats: ["movies"] },
  { id: 21, name: "Who is taller?", tagline: "Athletes, actors, singers and history's famous names", timerSec: 10, tiers: [1, 2, 3], ratioBand: { minLog2: 0, maxLog2: 99 }, helpers: "none", roundsPerSession: 10, mode: "duel", kind: "duel", duelCats: ["celebs"] },
  { id: 22, name: "Which is older?", tagline: "Pyramids, inventions, apps and brands — which came first?", timerSec: 10, tiers: [1, 2, 3], ratioBand: { minLog2: 0, maxLog2: 99 }, helpers: "none", roundsPerSession: 10, mode: "duel", kind: "duel", duelCats: ["older"] },
  { id: 23, name: "Bigger country", tagline: "Which country covers more land?", timerSec: 10, tiers: [1, 2, 3], ratioBand: { minLog2: 0, maxLog2: 99 }, helpers: "none", roundsPerSession: 10, mode: "duel", kind: "duel", duelCats: ["area"] },
  { id: 24, name: "More people", tagline: "Which country has the bigger population?", timerSec: 10, tiers: [1, 2, 3], ratioBand: { minLog2: 0, maxLog2: 99 }, helpers: "none", roundsPerSession: 10, mode: "duel", kind: "duel", duelCats: ["population"] },
  { id: 26, name: "Longer river", tagline: "From the Nile to the Thames — which river runs longer?", timerSec: 10, tiers: [1, 2, 3], ratioBand: { minLog2: 0, maxLog2: 99 }, helpers: "none", roundsPerSession: 10, mode: "duel", kind: "duel", duelCats: ["rivers"] },
  { id: 27, name: "Which is heavier?", tagline: "Blue whales, hippos, house cats — which weighs more?", timerSec: 10, tiers: [1, 2, 3], ratioBand: { minLog2: 0, maxLog2: 99 }, helpers: "none", roundsPerSession: 10, mode: "duel", kind: "duel", duelCats: ["heavier"] },
  { id: 25, name: "Duel Mix", tagline: "Every duel shuffled, 7 seconds each", timerSec: 7, tiers: [1, 2, 3], ratioBand: { minLog2: 0, maxLog2: 99 }, helpers: "none", roundsPerSession: 12, mode: "duel", kind: "duel", duelCats: ["movies", "celebs", "older", "area", "population", "rivers", "heavier"] },
];
LEVELS.push(...DUEL_LEVELS);

export const LOBBY_SECONDS = 12;
export const REVEAL_SECONDS = 8;
export const INTERMISSION_SECONDS = 15; // between sessions

export function getLevel(id: number): LevelConfig {
  const lvl = LEVELS.find((l) => l.id === id);
  if (!lvl) throw new Error(`Unknown level ${id}`);
  return lvl;
}
