import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MONUMENTS, LOBBY_SECONDS, REVEAL_SECONDS, getLevel, getMonument } from "@monumental/shared";
import { RoomEngine } from "./RoomEngine";

function makeEngine(levelId = 1, rounds = 2) {
  const events: { event: string; payload: unknown }[] = [];
  const sessionEnds: unknown[] = [];
  const engine = new RoomEngine(
    { roomId: "level:1", levelId, loop: true, roundsPerSession: rounds, catalog: () => MONUMENTS },
    {
      broadcast: (e, p) => events.push({ event: e, payload: p }),
      emit: (e, p) => events.push({ event: e, payload: p }),
      onSessionEnd: (_e, r) => sessionEnds.push(r),
      onIdle: () => {},
    },
  );
  return { engine, events, sessionEnds };
}

const P = (k: string) => ({ playerKey: `guest:${k}`, userId: null, nickname: k, isGuest: true });

describe("RoomEngine", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs lobby → round → reveal → … → finished on the server clock and scores correctly", () => {
    const { engine, events, sessionEnds } = makeEngine(1, 2);
    engine.join(P("alice"));
    engine.join(P("bob"));
    engine.join(P("carol"));
    expect(engine.phase).toBe("lobby");

    vi.advanceTimersByTime(LOBBY_SECONDS * 1000 + 5);
    expect(engine.phase).toBe("round");
    const rs = events.find((e) => e.event === "round_start")!.payload as { roundId: string; baseId: string; targetId: string };
    const real = (getMonument(rs.targetId).heightM / getMonument(rs.baseId).heightM) * 100;

    // alice closest, bob second, carol never locks (last position counts)
    expect(engine.submitGuess("guest:alice", rs.roundId, real + 1, true).ok).toBe(true);
    expect(engine.submitGuess("guest:bob", rs.roundId, real + 5, true).ok).toBe(true);
    expect(engine.submitGuess("guest:carol", rs.roundId, real + 50, false).ok).toBe(true);
    // locked players can't change
    expect(engine.submitGuess("guest:alice", rs.roundId, real, true).ok).toBe(false);
    // stale round id rejected
    expect(engine.submitGuess("guest:bob", "nope", real, true).ok).toBe(false);

    vi.advanceTimersByTime(getLevel(1).timerSec * 1000 + 300);
    expect(engine.phase).toBe("reveal");
    const result = events.filter((e) => e.event === "round_result").pop()!.payload as any;
    const pts = Object.fromEntries(result.entries.map((e: any) => [e.playerId, e.points]));
    expect(pts["guest:alice"]).toBe(3);
    expect(pts["guest:bob"]).toBe(1);
    expect(pts["guest:carol"]).toBe(1);
    expect(result.realPct).toBeCloseTo(real, 0);

    // a late joiner during reveal is eligible from the next round
    engine.join(P("dave"));
    vi.advanceTimersByTime(REVEAL_SECONDS * 1000 + 5);
    expect(engine.phase).toBe("round");
    const rs2 = events.filter((e) => e.event === "round_start").pop()!.payload as { roundId: string };
    expect(engine.submitGuess("guest:dave", rs2.roundId, 50, true).ok).toBe(true);

    vi.advanceTimersByTime(getLevel(1).timerSec * 1000 + 300);
    vi.advanceTimersByTime(REVEAL_SECONDS * 1000 + 5);
    expect(engine.phase).toBe("finished");
    expect(sessionEnds).toHaveLength(1);
    const s = sessionEnds[0] as any;
    expect(s.leaderboard[0].playerId).toBe("guest:alice");
    expect(s.winnerId).toBe("guest:alice");
  });

  it("rejects guesses from players who joined mid-round", () => {
    const { engine, events } = makeEngine(1, 1);
    engine.join(P("alice"));
    vi.advanceTimersByTime(LOBBY_SECONDS * 1000 + 5);
    engine.join(P("late"));
    const rs = events.find((e) => e.event === "round_start")!.payload as { roundId: string };
    expect(engine.submitGuess("guest:late", rs.roundId, 50, true).ok).toBe(false);
    expect(engine.submitGuess("guest:alice", rs.roundId, 50, true).ok).toBe(true);
  });

  it("never exposes the answer in round state", () => {
    const { engine } = makeEngine(1, 1);
    engine.join(P("alice"));
    vi.advanceTimersByTime(LOBBY_SECONDS * 1000 + 5);
    const s = JSON.stringify(engine.state());
    expect(s).not.toContain("realPct");
  });
});
