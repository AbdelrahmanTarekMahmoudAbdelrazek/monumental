import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkClue, makeOwBoard, mulberry32, OW_WORDS, type OwColor, type OwPublicState } from "@monumental/shared";
import { OneWordEngine } from "./OneWordEngine";

function table(seed = 1, timerSec = 0) {
  const states: OwPublicState[] = [];
  const keys = new Map<string, OwColor[] | null>();
  const t = new OneWordEngine("TEST1", "h", { timerSec, pack: "standard" }, {
    broadcast: (s) => states.push(JSON.parse(JSON.stringify(s))),
    sendKey: (id, k) => keys.set(id, k),
    onIdle: () => {},
  }, () => Date.now(), mulberry32(seed));
  return { t, states, keys, last: () => states[states.length - 1] };
}

/** Host + 3: red spymaster h, red guesser a, blue spymaster b, blue guesser c. */
function ready(seed = 1, timerSec = 0) {
  const x = table(seed, timerSec);
  for (const [id, n] of [["h", "Host"], ["a", "Ann"], ["b", "Ben"], ["c", "Cat"]]) x.t.join(id, n);
  expect(x.t.act("h", { type: "join_team", team: "red", role: "spymaster" }).ok).toBe(true);
  expect(x.t.act("a", { type: "join_team", team: "red", role: "operative" }).ok).toBe(true);
  expect(x.t.act("b", { type: "join_team", team: "blue", role: "spymaster" }).ok).toBe(true);
  expect(x.t.act("c", { type: "join_team", team: "blue", role: "operative" }).ok).toBe(true);
  return x;
}
const spy = (t: "red" | "blue") => (t === "red" ? "h" : "b");
const guesser = (t: "red" | "blue") => (t === "red" ? "a" : "c");

describe("ONE WORD board", () => {
  it("9 / 8 / 7 / 1 split with unique words", () => {
    for (let s = 1; s < 50; s++) {
      const b = makeOwBoard("standard", "blue", mulberry32(s));
      expect(new Set(b.words).size).toBe(25);
      const count = (c: OwColor) => b.key.filter((k) => k === c).length;
      expect([count("blue"), count("red"), count("neutral"), count("bomb")]).toEqual([9, 8, 7, 1]);
    }
    expect(OW_WORDS.standard.length).toBeGreaterThan(200);
    expect(OW_WORDS.easy.length).toBeGreaterThan(150);
  });
  it("clue must be one word and not on the board", () => {
    expect(checkClue("ocean", ["WAVE"])).toBeNull();
    expect(checkClue("deep sea", ["WAVE"])).toMatch(/One word/);
    expect(checkClue("wave", ["WAVE"])).toMatch(/board/);
    expect(checkClue("waves", ["WAVE"])).toMatch(/close/);
    expect(checkClue("", [])).toBeTruthy();
  });
});

describe("ONE WORD rules", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("needs a spymaster and a guesser per team; only one spymaster per team", () => {
    const x = table();
    x.t.join("h", "Host"); x.t.join("a", "Ann");
    expect(x.t.start("h").ok).toBe(false);
    x.t.act("h", { type: "join_team", team: "red", role: "spymaster" });
    expect(x.t.act("a", { type: "join_team", team: "red", role: "spymaster" }).ok).toBe(false);
    const y = ready();
    expect(y.t.act("a", { type: "start" }).ok).toBe(false); // not host
    expect(y.t.act("h", { type: "start" }).ok).toBe(true);
  });

  it("key goes only to spymasters; public state hides unrevealed colours", () => {
    const x = ready();
    x.t.start("h");
    expect(x.keys.get("h")).toHaveLength(25);
    expect(x.keys.get("b")).toHaveLength(25);
    expect(x.keys.get("a") ?? null).toBeNull();
    expect(x.keys.get("c") ?? null).toBeNull();
    expect(x.last().cards.every((c) => c.color === null)).toBe(true);
    expect(x.last().remaining[x.last().startTeam]).toBe(9);
  });

  it("clue → correct guesses continue, neutral ends the turn, max number+1 guesses", () => {
    const x = ready(3);
    x.t.start("h");
    const key = x.keys.get("h")!;
    const team = x.last().turn;
    const other = team === "red" ? "blue" : "red";
    expect(x.t.act(guesser(team), { type: "reveal", index: 0 }).ok).toBe(false); // no clue yet
    expect(x.t.act(spy(other), { type: "clue", word: "zzz", count: 1 }).ok).toBe(false); // not their turn
    expect(x.t.act(spy(team), { type: "clue", word: "two words", count: 1 }).ok).toBe(false);
    expect(x.t.act(spy(team), { type: "clue", word: "QWERTY", count: 1 }).ok).toBe(true);
    expect(x.last().stage).toBe("guess");
    expect(x.last().guessesLeft).toBe(2);
    expect(x.t.act(spy(team), { type: "reveal", index: 0 }).ok).toBe(false); // spymaster can't guess
    const mine = key.map((c, i) => (c === team ? i : -1)).filter((i) => i >= 0);
    x.t.act(guesser(team), { type: "reveal", index: mine[0] });
    expect(x.last().turn).toBe(team);
    x.t.act(guesser(team), { type: "reveal", index: mine[1] });
    expect(x.last().turn).toBe(other); // used count+1 guesses
    expect(x.last().remaining[team]).toBe(7);
    // other team hits a neutral → turn passes back
    x.t.act(spy(other), { type: "clue", word: "QWERTZ", count: 2 });
    const neutral = key.findIndex((c) => c === "neutral");
    x.t.act(guesser(other), { type: "reveal", index: neutral });
    expect(x.last().turn).toBe(team);
    expect(x.last().cards[neutral].color).toBe("neutral");
    expect(x.last().log).toHaveLength(2);
  });

  it("guessing the other team's card counts for them; the bomb loses instantly", () => {
    const x = ready(4);
    x.t.start("h");
    const key = x.keys.get("h")!;
    const team = x.last().turn;
    const other = team === "red" ? "blue" : "red";
    x.t.act(spy(team), { type: "clue", word: "QWERTY", count: 3 });
    const theirs = key.findIndex((c) => c === other);
    x.t.act(guesser(team), { type: "reveal", index: theirs });
    expect(x.last().remaining[other]).toBe(7);
    expect(x.last().turn).toBe(other);
    x.t.act(spy(other), { type: "clue", word: "QWERTZ", count: 1 });
    x.t.act(guesser(other), { type: "reveal", index: key.indexOf("bomb") });
    const s = x.last();
    expect(s.phase).toBe("finished");
    expect(s.winner).toBe(team);
    expect(s.winReason).toBe("bomb");
    expect(s.cards.every((c) => c.color !== null)).toBe(true); // full key shown at the end
    expect(s.wins[team]).toBe(1);
  });

  it("uncovering all your words wins; play again alternates the first team", () => {
    const x = ready(5);
    x.t.start("h");
    const key = x.keys.get("h")!;
    const team = x.last().turn;
    x.t.act(spy(team), { type: "clue", word: "QWERTY", count: 0 }); // unlimited
    for (const i of key.map((c, i) => (c === team ? i : -1)).filter((i) => i >= 0)) x.t.act(guesser(team), { type: "reveal", index: i });
    expect(x.last().phase).toBe("finished");
    expect(x.last().winner).toBe(team);
    expect(x.t.act("h", { type: "start" }).ok).toBe(true);
    expect(x.last().startTeam).not.toBe(team);
    expect(x.last().game).toBe(2);
  });

  it("marks are shared with the team and cleared on reveal; end turn passes play", () => {
    const x = ready(6);
    x.t.start("h");
    const team = x.last().turn;
    x.t.act(spy(team), { type: "clue", word: "QWERTY", count: 2 });
    expect(x.t.act(guesser(team), { type: "mark", index: 7 }).ok).toBe(true);
    expect(x.last().cards[7].marks).toEqual([guesser(team)]);
    x.t.act(guesser(team), { type: "mark", index: 7 });
    expect(x.last().cards[7].marks).toEqual([]);
    expect(x.t.act(guesser(team), { type: "end_turn" }).ok).toBe(true);
    expect(x.last().turn).not.toBe(team);
    expect(x.last().stage).toBe("clue");
  });

  it("timer passes the turn when it runs out", () => {
    const x = ready(7, 60);
    x.t.start("h");
    const team = x.last().turn;
    expect(x.last().turnEndsAt).toBeGreaterThan(0);
    vi.advanceTimersByTime(61_000);
    expect(x.last().turn).not.toBe(team);
  });

  it("spymasters can't switch to guessing mid-game; a guesser can take an empty spymaster seat", () => {
    const x = ready(8);
    x.t.start("h");
    expect(x.t.act("h", { type: "join_team", team: "red", role: "operative" }).ok).toBe(false);
    x.t.leave("h"); // red spymaster disconnects
    expect(x.t.act("a", { type: "join_team", team: "red", role: "spymaster" }).ok).toBe(true);
    expect(x.keys.get("a")).toHaveLength(25);
  });
});
