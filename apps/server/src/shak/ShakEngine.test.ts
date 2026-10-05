import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dealShak, shakStarter, tileHas, DOUBLE_66, ALL_TILES, mulberry32, type ShakPublicState } from "@monumental/shared";
import { ShakEngine } from "./ShakEngine";

function table(seed = 1) {
  const states: ShakPublicState[] = [];
  const hands = new Map<string, number[]>();
  const t = new ShakEngine("TEST1", "h", { turnSec: 30, maxPerPlay: 0 }, {
    broadcast: (s) => states.push(JSON.parse(JSON.stringify(s))),
    sendHand: (id, tiles) => hands.set(id, [...tiles]),
    onIdle: () => {},
  }, () => Date.now(), mulberry32(seed), [5, 10]);
  return { t, states, hands, last: () => states[states.length - 1] };
}

/** Engine internals for white-box setup. */
const priv = (t: ShakEngine) => t as unknown as { seats: { id: string; hand: number[]; outRank: number | null; pendingExit: boolean }[]; turn: number };

describe("أشك dealing", () => {
  it("4 players get 7 tiles each, 3 players get 9 + 1 set aside", () => {
    const r4 = dealShak(4, mulberry32(3));
    expect(r4.hands.map((h) => h.length)).toEqual([7, 7, 7, 7]);
    expect(r4.excluded).toHaveLength(0);
    const r3 = dealShak(3, mulberry32(3));
    expect(r3.hands.map((h) => h.length)).toEqual([9, 9, 9]);
    expect(r3.excluded).toHaveLength(1);
    expect(new Set([...r3.hands.flat(), ...r3.excluded]).size).toBe(28);
  });
  it("5–7 players: 28 tiles split evenly, leftovers set aside", () => {
    for (const [n, per, aside] of [[5, 5, 3], [6, 4, 4], [7, 4, 0]]) {
      const r = dealShak(n, mulberry32(n));
      expect(r.hands.map((h) => h.length)).toEqual(Array(n).fill(per));
      expect(r.excluded).toHaveLength(aside);
      expect(new Set([...r.hands.flat(), ...r.excluded]).size).toBe(28);
    }
    expect(() => dealShak(8, mulberry32(1))).toThrow();
  });
  it("6|6 holder starts, else the largest double", () => {
    for (let s = 1; s < 400; s++) {
      const { hands, excluded } = dealShak(3, mulberry32(s));
      const seat = shakStarter(hands);
      if (excluded[0] !== DOUBLE_66) { expect(hands[seat]).toContain(DOUBLE_66); continue; }
      // 6|6 set aside: the starter holds the largest double that was dealt
      const doubles = hands.flat().filter((t) => ALL_TILES[t][0] === ALL_TILES[t][1]).map((t) => ALL_TILES[t][0]);
      const best = Math.max(...doubles);
      expect(hands[seat].some((t) => ALL_TILES[t][0] === best && ALL_TILES[t][1] === best)).toBe(true);
    }
  });
});

describe("أشك rules", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function started(seed = 1) {
    const x = table(seed);
    x.t.join("h", "Host"); x.t.join("a", "Ann"); x.t.join("b", "Ben"); x.t.join("c", "Cat");
    expect(x.t.start("h").ok).toBe(true);
    return x;
  }

  it("needs 3+ players; only the host starts", () => {
    const x = table();
    x.t.join("h", "Host"); x.t.join("a", "Ann");
    expect(x.t.start("h").ok).toBe(false);
    x.t.join("b", "Ben");
    expect(x.t.start("a").ok).toBe(false);
    expect(x.t.start("h").ok).toBe(true);
  });

  it("never leaks hands in the public state", () => {
    const x = started();
    const s = JSON.stringify(x.last());
    expect(x.last().players.every((p) => p.tiles === 7)).toBe(true);
    expect(s).not.toContain('"hand"');
    expect(x.hands.get("h")).toHaveLength(7);
  });

  it("truthful claim: the doubter takes the table; bluff: the player takes it and restarts", () => {
    const x = started(5);
    const p = priv(x.t);
    const starter = p.seats[p.turn];
    const n = 6; // the starter holds 6|6 (or the largest double) — play an honest 6
    const honest = starter.hand.find((t) => tileHas(t, n))!;
    expect(x.t.play(starter.id, [honest], n).ok).toBe(true);
    const doubter = p.seats[p.turn]; // next player
    expect(x.t.doubt(doubter.id).ok).toBe(true);
    let s = x.last();
    expect(s.phase).toBe("reveal");
    expect(s.reveal!.truthful).toBe(true);
    expect(s.reveal!.loserId).toBe(doubter.id);
    expect(p.seats.find((q) => q.id === doubter.id)!.hand.length).toBe(8);
    vi.advanceTimersByTime(5000);
    s = x.last();
    expect(s.phase).toBe("playing");
    expect(s.turnId).toBe(starter.id); // tile-player starts the new pile
    expect(s.number).toBeNull();

    // now a bluff
    const liar = p.seats[p.turn];
    const lie = liar.hand.find((t) => !tileHas(t, 0))!;
    expect(x.t.play(liar.id, [lie], 0).ok).toBe(true);
    const d2 = p.seats[p.turn];
    const before = liar.hand.length;
    expect(x.t.doubt(d2.id).ok).toBe(true);
    expect(x.last().reveal!.truthful).toBe(false);
    expect(liar.hand.length).toBe(before + 1);
    vi.advanceTimersByTime(5000);
    expect(x.last().turnId).toBe(d2.id); // caught a bluff → the doubter starts the new pile
  });

  it("doubt only targets the last play and closes after the next move", () => {
    const x = started(7);
    const p = priv(x.t);
    const a = p.seats[p.turn];
    x.t.play(a.id, [a.hand[0]], 3);
    const b = p.seats[p.turn];
    expect(x.t.doubt(a.id).ok).toBe(false); // can't doubt yourself
    x.t.pass(b.id);
    const c = p.seats[p.turn];
    expect(x.t.doubt(c.id).ok).toBe(false); // window closed by the pass
  });

  it("everyone passing removes the table for good", () => {
    const x = started(9);
    const p = priv(x.t);
    const a = p.seats[p.turn];
    x.t.play(a.id, [a.hand[0]], 2);
    for (let k = 0; k < 4; k++) { const s = p.seats[p.turn]; expect(x.t.pass(s.id).ok).toBe(true); }
    const s = x.last();
    expect(s.tableCount).toBe(0);
    expect(s.number).toBeNull();
    expect(s.log!.kind).toBe("clear");
  });

  it("last tile: out once the play survives; first out is king, last holder is the fool", () => {
    const x = started(11);
    const p = priv(x.t);
    // rig hands: current player has 1 tile, others plenty
    const a = p.seats[p.turn];
    a.hand = [a.hand[0]];
    x.t.play(a.id, a.hand.slice(), 4);
    expect(x.last().players.find((q) => q.id === a.id)!.pendingExit).toBe(true);
    const b = p.seats[p.turn];
    x.t.pass(b.id); // play survived
    const st = x.last().players.find((q) => q.id === a.id)!;
    expect(st.outRank).toBe(1);
    expect(st.crowns).toBe(1);
    // empty two more players → round ends with one fool
    for (const s of p.seats.filter((q) => q.id !== a.id).slice(0, 2)) s.hand = [s.hand[0]];
    let guard = 0;
    while (x.last().phase === "playing" && guard++ < 20) {
      const s = p.seats[p.turn];
      if (x.last().number === null) x.t.play(s.id, [s.hand[0]], 1);
      else if (s.hand.length === 1) x.t.play(s.id, [s.hand[0]]);
      else x.t.pass(s.id);
    }
    const r = x.last();
    expect(r.phase).toBe("finished");
    expect(r.result!.kingId).toBe(a.id);
    expect(r.result!.foolId).not.toBeNull();
    expect(r.result!.order).toHaveLength(4);
  });

  it("tables of 5–7 (bots) finish and reject an 8th seat", () => {
    for (const n of [5, 6, 7]) {
      const x = table(n);
      x.t.join("h", "Host");
      for (let i = 1; i < n; i++) expect(x.t.addBot("h").ok).toBe(true);
      if (n === 7) { expect(x.t.addBot("h").ok).toBe(false); expect(x.t.join("z", "Zed").ok).toBe(false); }
      expect(x.t.start("h").ok).toBe(true);
      expect(x.last().players.every((p) => p.tiles === Math.floor(28 / n))).toBe(true);
      let guard = 0;
      while (x.last().phase !== "finished" && guard++ < 3000) vi.advanceTimersByTime(1000);
      expect(x.last().phase, `n ${n}`).toBe("finished");
      expect(x.last().result!.order).toHaveLength(n);
      x.t.destroy();
    }
  });

  it("a whole table of bots (plus an idle human) always finishes", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const x = table(seed);
      x.t.join("h", "Host");
      x.t.addBot("h"); x.t.addBot("h"); x.t.addBot("h");
      expect(x.t.start("h").ok).toBe(true);
      let guard = 0;
      while (x.last().phase !== "finished" && guard++ < 2000) vi.advanceTimersByTime(1000);
      expect(x.last().phase, `seed ${seed}`).toBe("finished");
      expect(x.last().result!.order.length).toBeGreaterThanOrEqual(3);
      expect(x.last().result!.foolId, `fool seed ${seed}`).not.toBeNull();
      expect(x.last().result!.foolId).not.toBe(x.last().result!.kingId);
      x.t.destroy();
    }
  });
});
