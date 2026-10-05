import { getLevel, LEVELS } from "./levels";
import { DUEL_CATEGORIES, type DuelCategoryId } from "./duel";
import type { HelperLevel, LevelConfig } from "./types";

/**
 * Custom (host-run) rooms: no schedule. The host picks the settings, shares the
 * invite link and presses Start when everyone is in. Settings can be changed
 * between games.
 */
export interface CustomRoomSettings {
  /** Shown in the lobby, e.g. "Friday quiz". */
  name: string;
  /** "size" = drag-to-size rounds, "duel" = Which is more? */
  kind: "size" | "duel";
  /** Size games: one of the size levels (1–15) — sets the item pool and difficulty. */
  baseLevelId: number;
  /** Size games: on-screen helpers. */
  helpers: HelperLevel;
  /** Duel games: categories to mix. */
  duelCats: DuelCategoryId[];
  /** Seconds per round. */
  timerSec: number;
  /** Rounds per game. */
  rounds: number;
  /** Seconds the answer is shown before the next round. */
  revealSec: number;
}

export const CUSTOM_LIMITS = {
  timerSec: { min: 5, max: 90 },
  rounds: { min: 1, max: 30 },
  revealSec: { min: 3, max: 20 },
  name: { max: 40 },
} as const;

export const SIZE_LEVEL_CHOICES = LEVELS.filter((l) => l.kind !== "duel");
export const DUEL_CAT_CHOICES = Object.values(DUEL_CATEGORIES);
/** The template level duel rooms are based on (Duel Mix). */
export const DUEL_TEMPLATE_LEVEL = 25;

export const DEFAULT_CUSTOM_SETTINGS: CustomRoomSettings = {
  name: "",
  kind: "duel",
  baseLevelId: 12,
  helpers: "full",
  duelCats: ["movies", "celebs", "older", "area", "population", "rivers", "heavier"],
  timerSec: 10,
  rounds: 10,
  revealSec: 6,
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? n : lo)));

/** Validate + normalise settings coming from a client. Throws on unusable input. */
export function normaliseCustomSettings(input: Partial<CustomRoomSettings>): CustomRoomSettings {
  const d = DEFAULT_CUSTOM_SETTINGS;
  const kind = input.kind === "size" ? "size" : "duel";
  const baseLevelId = SIZE_LEVEL_CHOICES.some((l) => l.id === input.baseLevelId) ? (input.baseLevelId as number) : d.baseLevelId;
  const helpers: HelperLevel = (["full", "ruler", "none", "silhouette"] as const).includes(input.helpers as HelperLevel)
    ? (input.helpers as HelperLevel)
    : getLevel(baseLevelId).helpers;
  const duelCats = Array.isArray(input.duelCats)
    ? [...new Set(input.duelCats.filter((c): c is DuelCategoryId => c in DUEL_CATEGORIES))]
    : d.duelCats;
  if (kind === "duel" && duelCats.length === 0) throw new Error("Pick at least one category");
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ").slice(0, CUSTOM_LIMITS.name.max) : "";
  return {
    name,
    kind,
    baseLevelId,
    helpers,
    duelCats: duelCats.length ? duelCats : d.duelCats,
    timerSec: clamp(input.timerSec ?? d.timerSec, CUSTOM_LIMITS.timerSec.min, CUSTOM_LIMITS.timerSec.max),
    rounds: clamp(input.rounds ?? d.rounds, CUSTOM_LIMITS.rounds.min, CUSTOM_LIMITS.rounds.max),
    revealSec: clamp(input.revealSec ?? d.revealSec, CUSTOM_LIMITS.revealSec.min, CUSTOM_LIMITS.revealSec.max),
  };
}

/** The effective LevelConfig a custom room plays with. `id` stays the template level's id. */
export function buildCustomLevel(s: CustomRoomSettings): LevelConfig {
  if (s.kind === "duel") {
    const base = getLevel(DUEL_TEMPLATE_LEVEL);
    const label = s.duelCats.length === 1 ? DUEL_CATEGORIES[s.duelCats[0]].label : "Which is more?";
    return { ...base, name: s.name || label, tagline: s.duelCats.map((c) => DUEL_CATEGORIES[c].label).join(" · "), duelCats: s.duelCats, timerSec: s.timerSec, roundsPerSession: s.rounds };
  }
  const base = getLevel(s.baseLevelId);
  return { ...base, name: s.name || base.name, timerSec: s.timerSec, roundsPerSession: s.rounds, helpers: s.helpers };
}
