import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { containsWord, mulberry32, SMUGGLE_WORDS, type SmugglePublicState } from "@monumental/shared";
import { SmuggleEngine } from "./SmuggleEngine";

function table(seed = 1, settings = { laps: 2, turnSec: 30, wordsPer: 1 as 1 | 2 }) {
  const states: SmugglePublicState[] = [];
  const secrets = new Map<string, string[]>();
  const t = new SmuggleEngine("TEST1", "h", settings, {
    broadcast: (s) => states.push(JSON.parse(JSON.stringify(s))),
    sendSecret: (id, w) => secrets.set(id, w),
    onIdle: () => {},
  }, () => Date.now(), mulberry32(seed));
  return { t, states, secrets, last: () => states[states.length - 1] };
}
function started(seed = 1, settings?: Parameters<typeof table>[1]) {
  const x = table(seed, settings);
  for (const [id, n] of [["h", "Hana"], ["a", "Adam"], ["b", "Bella"]]) x.t.join(id, n);
  expect(x.t.act("h", { type: "start" }).ok).toBe(true);
  return x;
}

describe("SMUGGLERS words", () => {
  it("whole-word matching with plurals", () => {
    expect(containsWord("Is that a giraffe?", "GIRAFFE")).toBe(true);
    expect(containsWord("Two GIRAFFES walked in", "GIRAFFE")).toBe(true);
    expect(containsWord("the pirate's hat", "PIRATE")).toBe(true);
    expect(containsWord("piratical behaviour", "PIRATE")).toBe(false);
    expect(containsWord("sunflowerseed", "SUNFLOWER")).toBe(false);
    expect(SMUGGLE_WORDS.length).toBeGreaterThan(100);
  });
});

describe("SMUGGLERS rules", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("needs 3 players; secrets only go to their owners", () => {
    const x = table();
    x.t.join("h", "Hana"); x.t.join("a", "Adam");
    expect(x.t.act("h", { type: "start" }).ok).toBe(false);
    x.t.join("b", "Bella");
    expect(x.t.act("a", { type: "start" }).ok).toBe(false);
    expect(x.t.act("h", { type: "start" }).ok).toBe(true);
    for (const id of ["h", "a", "b"]) expect(x.secrets.get(id)).toHaveLength(1);
    const all = [...x.secrets.values()].flat();
    expect(new Set(all).size).toBe(3);
    const pub = JSON.stringify(x.last());
    for (const w of all) expect(pub.includes(`"${w}"`)).toBe(false); // options are hidden while writing
    expect(x.last().story).toHaveLength(1); // opener
  });

  it("turns go in order, only the current writer may write, laps end in guessing", () => {
    const x = started(2);
    const order = x.last().order;
    expect(x.t.act(order[1], { type: "write", text: "Not my turn yet" }).ok).toBe(false);
    for (let lap = 0; lap < 2; lap++) for (const id of order) {
      expect(x.last().turnId).toBe(id);
      expect(x.t.act(id, { type: "write", text: `Line by ${id} in lap ${lap}` }).ok).toBe(true);
    }
    expect(x.last().phase).toBe("guessing");
    expect(x.last().story).toHaveLength(1 + 2 * 3);
    expect(x.last().options.length).toBeGreaterThanOrEqual(3 + 4);
    for (const w of [...x.secrets.values()].flat()) expect(x.last().options).toContain(w);
  });

  it("a silent writer is skipped when the timer runs out", () => {
    const x = started(3);
    const first = x.last().turnId;
    vi.advanceTimersByTime(31_000);
    expect(x.last().turnId).not.toBe(first);
    expect(x.last().story[1].skipped).toBe(true);
  });

  it("scoring: smuggled +2, undetected +3, each correct guess +1", () => {
    const x = started(4);
    const order = x.last().order;
    const w = (id: string) => x.secrets.get(id)![0];
    const [p1, p2, p3] = order;
    for (let lap = 0; lap < 2; lap++) {
      x.t.act(p1, { type: "write", text: lap === 0 ? `Suddenly a ${w(p1).toLowerCase()} appeared.` : "Everyone gasped." });
      x.t.act(p2, { type: "write", text: lap === 0 ? `Then the ${w(p2)}s came.` : "It was late." });
      x.t.act(p3, { type: "write", text: "Nothing happened." }); // p3 never smuggles
    }
    expect(x.last().phase).toBe("guessing");
    // p2 and p3 both catch p1; nobody catches p2
    const wrong = x.last().options.find((o) => ![w(p1), w(p2), w(p3)].includes(o))!;
    x.t.act(p1, { type: "guess", guesses: { [p2]: wrong, [p3]: w(p3) } });
    x.t.act(p2, { type: "guess", guesses: { [p1]: w(p1), [p3]: wrong } });
    expect(x.last().phase).toBe("guessing");
    x.t.act(p3, { type: "guess", guesses: { [p1]: w(p1), [p2]: wrong } });
    const s = x.last();
    expect(s.phase).toBe("reveal");
    const r = (id: string) => s.results!.find((q) => q.playerId === id)!;
    expect(r(p1).smuggled).toEqual([true]);
    expect(r(p1).caughtBy.sort()).toEqual([p2, p3].sort());
    expect(r(p1).points).toBe(2 + 1); // smuggled, caught; +1 for catching p3
    expect(r(p2).points).toBe(2 + 3 + 1); // smuggled, undetected, caught p1
    expect(r(p3).smuggled).toEqual([false]);
    expect(r(p3).points).toBe(1); // only the detective point
    expect(s.players.find((p) => p.id === p2)!.score).toBe(6);
    expect(s.guesses![p1][p3]).toBe(w(p3));
  });

  it("guessing times out into the reveal; play again keeps scores", () => {
    const x = started(5);
    for (let i = 0; i < 6; i++) x.t.act(x.last().turnId!, { type: "write", text: "Some sentence here." });
    expect(x.last().phase).toBe("guessing");
    vi.advanceTimersByTime(80_000);
    expect(x.last().phase).toBe("reveal");
    expect(x.t.act("h", { type: "start" }).ok).toBe(true);
    expect(x.last().game).toBe(2);
    expect(x.last().phase).toBe("writing");
  });

  it("two secret words each", () => {
    const x = started(6, { laps: 2, turnSec: 30, wordsPer: 2 });
    expect(x.secrets.get("h")).toHaveLength(2);
  });
});
