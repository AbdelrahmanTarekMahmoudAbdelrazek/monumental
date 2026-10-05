import { describe, it, expect } from "vitest";
import { scoreRound, realPercent, clampGuess } from "./scoring";
import { LEVELS } from "./levels";
import { MONUMENTS, MONUMENT_MAP } from "./monuments";
import { eligiblePairs, pickSessionPairs } from "./pairing";
import { SILHOUETTES } from "./silhouettes";
import { SILHOUETTES2 } from "./silhouettes2";

describe("scoring", () => {
  it("computes real percentage", () => {
    expect(realPercent(138.5, 73)).toBeCloseTo(52.71, 1);
  });
  it("gives 3/1/1/0 by closeness", () => {
    const r = scoreRound(50, [
      { playerId: "a", guessPct: 60 }, // err 10
      { playerId: "b", guessPct: 49 }, // err 1  -> 1st
      { playerId: "c", guessPct: 55 }, // err 5  -> 2nd
      { playerId: "d", guessPct: 43 }, // err 7  -> 3rd
      { playerId: "e", guessPct: null },
    ]);
    const by = Object.fromEntries(r.map((x) => [x.playerId, x]));
    expect(by.b.points).toBe(3);
    expect(by.c.points).toBe(1);
    expect(by.d.points).toBe(1);
    expect(by.a.points).toBe(0);
    expect(by.e.points).toBe(0);
    expect(by.e.rank).toBeNull();
  });
  it("ties share rank and points", () => {
    const r = scoreRound(50, [
      { playerId: "a", guessPct: 52 },
      { playerId: "b", guessPct: 48 },
      { playerId: "c", guessPct: 55 },
    ]);
    const by = Object.fromEntries(r.map((x) => [x.playerId, x]));
    expect(by.a.points).toBe(3);
    expect(by.b.points).toBe(3);
    expect(by.c.rank).toBe(3);
    expect(by.c.points).toBe(1);
  });
  it("clamps garbage", () => {
    expect(clampGuess("x" as unknown)).toBeNull();
    expect(clampGuess(-5)).toBe(0.1);
    expect(clampGuess(Infinity)).toBeNull();
  });
});

describe("data integrity", () => {
  it("has at least 40 monuments with unique ids and silhouettes", () => {
    expect(MONUMENTS.length).toBeGreaterThanOrEqual(40);
    const ids = new Set(MONUMENTS.map((m) => m.id));
    expect(ids.size).toBe(MONUMENTS.length);
    for (const m of MONUMENTS) {
      expect(SILHOUETTES[m.id] ?? SILHOUETTES2[m.id], `missing silhouette for ${m.id}`).toBeDefined();
      expect(m.silhouette.w).toBeGreaterThan(0);
      expect(m.heightM).toBeGreaterThan(0);
      expect(m.heightNote.length).toBeGreaterThan(5);
    }
  });
  it("every level has a large pool of pairs", () => {
    for (const lvl of LEVELS.filter((l) => l.kind !== "duel")) {
      const pairs = eligiblePairs(lvl, MONUMENTS);
      expect(pairs.length, `level ${lvl.id}`).toBeGreaterThanOrEqual(30);
    }
  });
  it("session pairs are deterministic for a seed and avoid repeats", () => {
    const a = pickSessionPairs(LEVELS[0], MONUMENTS, 10, "seed-1");
    const b = pickSessionPairs(LEVELS[0], MONUMENTS, 10, "seed-1");
    expect(a).toEqual(b);
    const keys = new Set(a.map((p) => p.baseId + ">" + p.targetId));
    expect(keys.size).toBe(10);
    for (const p of a) expect(MONUMENT_MAP[p.baseId] && MONUMENT_MAP[p.targetId]).toBeTruthy();
  });
});

import { groupOf, sizeQuestion } from "./monuments";
describe("mixed mode", () => {
  it("mixed levels pair items from different groups", () => {
    for (const lvl of LEVELS.filter((l) => l.crossGroup)) {
      for (const p of eligiblePairs(lvl, MONUMENTS)) {
        expect(groupOf(MONUMENT_MAP[p.baseId])).not.toBe(groupOf(MONUMENT_MAP[p.targetId]));
      }
    }
  });
  it("classic levels stay monuments-only", () => {
    for (const lvl of LEVELS.filter((l) => l.mode === "classic" && l.kind !== "duel")) {
      for (const p of eligiblePairs(lvl, MONUMENTS).slice(0, 200)) {
        expect(groupOf(MONUMENT_MAP[p.baseId])).toBe("monuments");
        expect(groupOf(MONUMENT_MAP[p.targetId])).toBe("monuments");
      }
    }
  });
  it("words the question by measure", () => {
    expect(sizeQuestion(MONUMENT_MAP["earth"])).toBe("How wide is Earth?");
    expect(sizeQuestion(MONUMENT_MAP["giraffe"])).toMatch(/^How tall/);
  });
});

import { DUEL_ITEMS, DUEL_CATEGORIES, pickDuelPairs, scoreDuel, duelWinner, getDuelItem, fmtDuelValue } from "./duel";
describe("duel mode", () => {
  it("every duel level yields a full session of clear, non-repeating pairs", () => {
    for (const lvl of LEVELS.filter((l) => l.kind === "duel")) {
      const pairs = pickDuelPairs(lvl.duelCats!, lvl.tiers, lvl.roundsPerSession, "s" + lvl.id);
      expect(pairs.length, lvl.name).toBe(lvl.roundsPerSession);
      for (const p of pairs) {
        const a = getDuelItem(p.aId), b = getDuelItem(p.bId);
        expect(a.cat).toBe(b.cat);
        expect(DUEL_CATEGORIES[a.cat].minGap(a.value, b.value)).toBe(true);
      }
      expect(new Set(pairs.map((p) => [p.aId, p.bId].sort().join())).size).toBe(pairs.length);
    }
  });
  it("older means the earlier year wins", () => {
    expect(duelWinner(getDuelItem("older:great_pyramid"), getDuelItem("older:iphone"))).toBe("a");
    expect(duelWinner(getDuelItem("area:egypt"), getDuelItem("area:russia"))).toBe("b");
  });
  it("scores correct answers by speed: 3 / 2 / 2 / 1, wrong = 0", () => {
    const r = scoreDuel("a", [
      { playerId: "slow", pick: "a", ms: 5000 }, { playerId: "fast", pick: "a", ms: 900 },
      { playerId: "mid", pick: "a", ms: 2000 }, { playerId: "mid2", pick: "a", ms: 3000 },
      { playerId: "wrong", pick: "b", ms: 100 }, { playerId: "none", pick: null, ms: null },
    ]);
    const by = Object.fromEntries(r.map((x) => [x.playerId, x.points]));
    expect(by).toEqual({ fast: 3, mid: 2, mid2: 2, slow: 1, wrong: 0, none: 0 });
  });
  it("has unique ids and readable values", () => {
    expect(new Set(DUEL_ITEMS.map((d) => d.id)).size).toBe(DUEL_ITEMS.length);
    expect(fmtDuelValue("older", -2560)).toBe("2560 BC");
    expect(fmtDuelValue("population", 1451)).toBe("1.45 billion");
  });
});
