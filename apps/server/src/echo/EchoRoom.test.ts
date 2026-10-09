import { describe, it, expect, vi, afterEach } from "vitest";
import { ECHO, ECHO_MAP, ECHO_W, MIMIC, echoFree, echoPath, echoSpawns, echoWallsBetween, decodeEchoSnap, muDecode, muEncode, tagText, mulberry32, type EchoEvent, type EchoMeta, type EchoSnap } from "@monumental/shared";
import { EchoRoom } from "./EchoRoom";

function room() {
  let t = 1_000_000;
  const metas: EchoMeta[] = [];
  const snaps: EchoSnap[] = [];
  const events: EchoEvent[] = [];
  const r = new EchoRoom("TEST1", "a", { meta: (m) => metas.push(m), snap: (s) => snaps.push(s), event: (e) => events.push(e), onIdle: () => {} }, () => t, mulberry32(4));
  return { r, metas, snaps, events, advance: (ms: number) => { t += ms; }, now: () => t };
}
const st = (o: Partial<{ x: number; z: number; yaw: number }>) => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, torch: true, crouch: false, seq: 1, ...o });

afterEach(() => vi.useRealTimers());

describe("ECHO HALLS map", () => {
  it("every row has the same width and the edges are walls", () => {
    expect(ECHO_MAP.every((row) => row.length === ECHO_W)).toBe(true);
    expect([...ECHO_MAP[0]].every((c) => c === "#")).toBe(true);
    expect(ECHO_MAP.every((row) => row[0] === "#" && row[row.length - 1] === "#")).toBe(true);
  });
  it("spawns are on open floor, and every open tile can be reached from them", () => {
    const sp = echoSpawns();
    expect(sp.length).toBeGreaterThanOrEqual(2);
    for (const s of sp) expect(echoFree(s.x, s.z)).toBe(true);
    const seen = new Set<string>();
    const q = [[Math.floor(sp[0].x / ECHO.TILE), Math.floor(sp[0].z / ECHO.TILE)]];
    while (q.length) {
      const [x, z] = q.pop()!;
      const k = `${x},${z}`;
      if (seen.has(k) || ECHO_MAP[z][x] === "#") continue;
      seen.add(k);
      q.push([x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]);
    }
    const open = ECHO_MAP.join("").split("").filter((c) => c !== "#").length;
    expect(seen.size).toBe(open);
  });
  it("counts the walls between two points (for muffled voices)", () => {
    const T = ECHO.TILE;
    // same room → no wall
    expect(echoWallsBetween(1.5 * T, 1.5 * T, 6.5 * T, 3.5 * T)).toBe(0);
    // spawn room → middle room straight across the wall at column 8 (row 1 has no door)
    expect(echoWallsBetween(6.5 * T, 1.5 * T, 10.5 * T, 1.5 * T)).toBe(1);
    // through the doorway at row 2 → open
    expect(echoWallsBetween(6.5 * T, 2.5 * T, 10.5 * T, 2.5 * T)).toBe(0);
  });
});

describe("ECHO HALLS rooms", () => {
  it("up to 4 players, each with a number and colour; the 5th is refused", () => {
    const { r } = room();
    const ns = ["a", "b", "c", "d"].map((id) => r.join(id, id.toUpperCase()));
    expect(ns.every((x) => x.ok)).toBe(true);
    expect(new Set(r.meta().players.map((p) => p.color)).size).toBe(4);
    expect(r.join("e", "E").ok).toBe(false);
    // rejoining keeps your seat
    const again = r.join("a", "A2");
    expect(again.ok && again.n).toBe(ns[0].ok && ns[0].n);
    r.destroy();
  });

  it("accepts believable moves and rejects teleports and walls", () => {
    const { r, advance } = room();
    const j = r.join("a", "A");
    if (!j.ok) throw new Error("join");
    advance(1000);
    expect(r.state("a", st({ x: j.spawn.x + 2, z: j.spawn.z }))).toBe(true);
    advance(100);
    expect(r.state("a", st({ x: j.spawn.x + 30, z: j.spawn.z }))).toBe(false); // teleport
    advance(1000);
    expect(r.state("a", st({ x: 0.5, z: 0.5 }))).toBe(false); // inside the outer wall
    const me = decodeEchoSnap(r.snapshot())[0];
    expect(me.x).toBeCloseTo(j.spawn.x + 2, 1);
    r.destroy();
  });

  it("sends snapshots on a timer while someone is inside, and hands host to the next player", () => {
    vi.useFakeTimers();
    const { r, snaps, metas } = room();
    r.join("a", "A"); r.join("b", "B");
    vi.advanceTimersByTime(ECHO.SNAP_MS * 4 + 5);
    expect(snaps.length).toBeGreaterThanOrEqual(4);
    expect(decodeEchoSnap(snaps[snaps.length - 1])).toHaveLength(2);
    r.leave("a");
    expect(metas[metas.length - 1].hostId).toBe("b");
    expect(r.idOf(2)).toBe("b");
    r.destroy();
  });
});

describe("ECHO HALLS mimic", () => {
  const T = ECHO.TILE;
  /** Two players far apart, Bob has said a few things that Ann's device holds. */
  function night() {
    const x = room();
    x.r.join("a", "Ann"); x.r.join("b", "Bob");
    const d = x.r.debug();
    const [ann, bob] = d.members;
    // Ann alone in the bottom-right room, Bob in the spawn room
    Object.assign(ann, { x: 20.5 * T, z: 11.5 * T, torch: false });
    Object.assign(bob, { x: 1.5 * T, z: 1.5 * T });
    for (let i = 0; i < 4; i++) { x.r.clip("b", i, 900 + i * 200, i === 1 ? ["call"] : ["short"]); x.r.have("a", `2:${i}`); }
    const run = (sec: number) => { for (let i = 0; i < sec * 20; i++) { x.advance(50); x.r.step(); } };
    return { ...x, d, ann, bob, run };
  }

  it("finds walking paths between rooms and never through walls", () => {
    const p = echoPath([1, 1], [20, 12]);
    expect(p.length).toBeGreaterThan(10);
    for (const [tx, tz] of p) expect(ECHO_MAP[tz][tx]).not.toBe("#");
    expect(echoPath([1, 1], [0, 0])).toEqual([]);
  });

  it("voice pieces survive the 8-bit trip, and transcripts get labels", () => {
    const pcm = new Float32Array(200).map((_, i) => Math.sin(i / 5) * 0.6);
    const back = muDecode(muEncode(pcm));
    let err = 0;
    for (let i = 0; i < pcm.length; i++) err = Math.max(err, Math.abs(back[i] - pcm[i]));
    expect(err).toBeLessThan(0.03);
    expect(tagText("Ann, come here quick", { 1: "ann", 2: "bob" })).toEqual(expect.arrayContaining(["call", "name:1"]));
    expect(tagText("انت فين؟", {})).toContain("question");
  });

  it("sleeps until two players have been in for a while and there are voices to copy", () => {
    const x = night();
    x.run(MIMIC.WAKE_SEC - 5);
    expect(x.d.mimics).toHaveLength(0);
    x.run(6);
    expect(x.d.mimics).toHaveLength(1);
    expect(x.events.some((e) => e.type === "wake")).toBe(true);
    x.r.destroy();
  });

  it("stalks the lonely player and calls them with a friend's voice, never their own and never twice", () => {
    const x = night();
    x.run(MIMIC.WAKE_SEC + 60);
    const says = x.events.filter((e): e is Extract<EchoEvent, { type: "say" }> => e.type === "say");
    expect(says.length).toBeGreaterThan(0);
    const all = says.flatMap((s) => s.clips);
    expect(all.every((k) => k.startsWith("2:"))).toBe(true); // Bob's voice, played to Ann
    expect(new Set(all).size).toBe(all.length);
    expect(all).toContain("2:1"); // the "come here" piece is preferred
    x.r.destroy();
  });

  it("a torch held on it while it calls exposes it and it runs away", () => {
    const x = night();
    x.run(MIMIC.WAKE_SEC + 1);
    const mm = x.d.mimics[0];
    // it is calling Ann from 7 m away across her room; she turns her torch on it
    Object.assign(mm, { x: x.ann.x - 7, z: x.ann.z, state: "lure", target: 1, until: x.now() + 60_000, path: [], lures: 1 });
    Object.assign(x.ann, { yaw: Math.PI / 2, torch: true });
    x.run(MIMIC.EXPOSE_SEC + 0.3);
    expect(x.events.some((e) => e.type === "exposed")).toBe(true);
    expect(mm.state).toBe("flee");
    expect(x.r.exposed).toBe(1);
    x.r.destroy();
  });

  it("caught in a torch while just sneaking around, it slips away instead of being exposed", () => {
    const x = night();
    x.run(MIMIC.WAKE_SEC + 1);
    const mm = x.d.mimics[0];
    Object.assign(mm, { x: x.ann.x, z: x.ann.z - 4, state: "wander", path: [], nextLure: x.now() + 60_000 });
    Object.assign(x.ann, { yaw: 0, torch: true });
    x.run(3);
    expect(x.events.some((e) => e.type === "exposed")).toBe(false);
    expect(Math.hypot(mm.x - x.ann.x, mm.z - (x.ann.z - 4))).toBeGreaterThan(1); // it moved away
    x.r.destroy();
  });

  it("catches a player who walks up to it; they come back to the safe room later", () => {
    const x = night();
    x.run(MIMIC.WAKE_SEC + 1);
    const mm = x.d.mimics[0];
    Object.assign(mm, { x: x.ann.x + 2, z: x.ann.z, state: "chase", target: 1, until: x.now() + 10_000, path: [] });
    x.run(1);
    expect(x.ann.taken).toBe(true);
    const taken = x.events.find((e) => e.type === "taken");
    expect(taken && taken.type === "taken" && taken.n).toBe(1);
    expect(decodeEchoSnap(x.r.snapshot())[0]).toBeTruthy();
    x.run(MIMIC.TAKEN_SEC + 0.2);
    expect(x.ann.taken).toBe(false);
    expect(x.events.some((e) => e.type === "back" && e.n === 1)).toBe(true);
    expect(echoWallsBetween(x.ann.x, x.ann.z, 1.5 * T, 1.5 * T)).toBe(0);
    x.r.destroy();
  });
});

describe("ECHO HALLS mimic — audible calls", () => {
  it("only calls when the target is close enough to hear; follows them otherwise", () => {
    let t = 1_000_000;
    const events: EchoEvent[] = [];
    const r = new EchoRoom("T2", "a", { meta: () => {}, snap: () => {}, event: (e) => events.push(e), onIdle: () => {} }, () => t, mulberry32(3));
    r.join("a", "Ann"); r.join("b", "Bob");
    const d = r.debug();
    const [ann, bob] = d.members;
    Object.assign(ann, { x: 61.5, z: 37.5, yaw: Math.PI });
    Object.assign(bob, { x: 7.5, z: 4.5 });
    for (let i = 0; i < 10; i++) { r.clip("b", i, 1000, ["short"]); r.have("a", `2:${i}`); }
    let say = 0;
    for (let i = 0; i < (MIMIC.WAKE_SEC + 120) * 20; i++) {
      t += 50; r.step();
      const mm = d.mimics[0];
      const e = events[events.length - 1];
      if (mm && e && e.type === "say" && events.length > say) {
        say = events.length;
        expect(Math.hypot(ann.x - mm.x, ann.z - mm.z)).toBeLessThanOrEqual(14.5);
      }
    }
    expect(say).toBeGreaterThan(0);
    r.destroy();
  });
});

describe("ECHO HALLS mimic — spotted", () => {
  it("freezes for a moment when you turn and see it, so a quick torch beats it", () => {
    let t = 1_000_000;
    const events: EchoEvent[] = [];
    const r = new EchoRoom("T3", "a", { meta: () => {}, snap: () => {}, event: (e) => events.push(e), onIdle: () => {} }, () => t, mulberry32(5));
    r.join("a", "Ann"); r.join("b", "Bob");
    const d = r.debug();
    const [ann, bob] = d.members;
    Object.assign(ann, { x: 61.5, z: 34.5, yaw: Math.PI / 2, torch: true }); // facing −x
    Object.assign(bob, { x: 7.5, z: 4.5 });
    for (let i = 0; i < 6; i++) { r.clip("b", i, 1000, ["short"]); r.have("a", `2:${i}`); }
    const run = (sec: number) => { for (let i = 0; i < sec * 20; i++) { t += 50; r.step(); } };
    run(MIMIC.WAKE_SEC + 1);
    const mm = d.mimics[0];
    Object.assign(mm, { x: ann.x - 5, z: ann.z, state: "lure", target: 1, until: t + 60_000, path: [], lures: 1, pendingSay: null });
    run(2.2);
    expect(events.some((e) => e.type === "exposed")).toBe(true);
    expect(ann.taken).toBe(false);
    r.destroy();
  });
});
