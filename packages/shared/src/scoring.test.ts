import { describe, it, expect } from "vitest";
import { scoreRound, realPercent, clampGuess } from "./scoring";
import { LEVELS } from "./levels";
import { MONUMENTS, MONUMENT_MAP } from "./monuments";
import { eligiblePairs, pickSessionPairs } from "./pairing";
import { SILHOUETTES } from "./silhouettes";

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
      expect(SILHOUETTES[m.id], `missing silhouette for ${m.id}`).toBeDefined();
      expect(m.silhouette.w).toBeGreaterThan(0);
      expect(m.heightM).toBeGreaterThan(0);
      expect(m.heightNote.length).toBeGreaterThan(5);
    }
  });
  it("every level has a large pool of pairs", () => {
    for (const lvl of LEVELS) {
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
