import type { LevelConfig, Monument, RoundPair } from "./types";
import { groupOf } from "./monuments";

/** Small deterministic PRNG (mulberry32) so rounds can be reproduced from a seed. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** All (base, target) ordered pairs that satisfy the level's tier + ratio constraints. */
export function eligiblePairs(level: LevelConfig, monuments: Monument[]): RoundPair[] {
  const pool = monuments.filter(
    (m) => level.tiers.includes(m.tier) && (!level.categories || level.categories.includes(m.category)),
  );
  const out: RoundPair[] = [];
  for (const base of pool) {
    for (const target of pool) {
      if (base.id === target.id) continue;
      if (level.crossGroup && groupOf(base) === groupOf(target)) continue;
      const l = Math.abs(Math.log2(target.heightM / base.heightM));
      if (l >= level.ratioBand.minLog2 && l <= level.ratioBand.maxLog2) {
        out.push({ baseId: base.id, targetId: target.id });
      }
    }
  }
  return out;
}

/**
 * Pick `count` pairs for a session, avoiding repeated bases and repeated
 * targets as far as the pool allows, and never repeating an exact pair.
 */
export function pickSessionPairs(
  level: LevelConfig,
  monuments: Monument[],
  count: number,
  seed: string,
): RoundPair[] {
  const rnd = mulberry32(hashSeed(seed));
  const pairs = eligiblePairs(level, monuments);
  if (pairs.length === 0) throw new Error(`Level ${level.id} has no eligible pairs`);
  // shuffle
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
  }
  const chosen: RoundPair[] = [];
  const usedBase = new Set<string>();
  const usedTarget = new Set<string>();
  const usedKey = new Set<string>();

  // pass 1: fresh base + fresh target
  for (const p of pairs) {
    if (chosen.length >= count) break;
    if (usedBase.has(p.baseId) || usedTarget.has(p.targetId)) continue;
    chosen.push(p); usedBase.add(p.baseId); usedTarget.add(p.targetId); usedKey.add(p.baseId + ">" + p.targetId);
  }
  // pass 2: allow repeats of base/target but not the same pair
  for (const p of pairs) {
    if (chosen.length >= count) break;
    const k = p.baseId + ">" + p.targetId;
    if (usedKey.has(k)) continue;
    chosen.push(p); usedKey.add(k);
  }
  // pass 3: pool exhausted → cycle
  let i = 0;
  while (chosen.length < count) chosen.push(pairs[i++ % pairs.length]);
  return chosen;
}
