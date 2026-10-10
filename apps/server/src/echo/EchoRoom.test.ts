import { describe, it, expect, vi, afterEach } from "vitest";
import { ECHO, ECHO_MAP, ECHO_W, GOAL, MIMIC, PERK, echoEdgeOpen, echoFree, echoPath, echoSpawns, echoWallsBetween, decodeEchoSnap, muDecode, muEncode, tagText, mulberry32, type EchoEvent, type EchoMeta, type EchoSnap } from "@monumental/shared";
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
      if (seen.has(k)) continue;
      seen.add(k);
      for (const [nx, nz] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]]) if (echoEdgeOpen(x, z, nx, nz)) q.push([nx, nz]);
    }
    const open = ECHO_MAP.join("").split("").filter((c) => c !== "#").length;
    expect(seen.size).toBe(open);
  });
  it("counts the walls between two points (for muffled voices)", () => {
    const T = ECHO.TILE;
    // same room (reception) → no wall
    expect(echoWallsBetween(1.5 * T, 1.5 * T, 4.5 * T, 4.5 * T)).toBe(0);
    // reception → ward A straight through the wall (row 1 has no door)
    expect(echoWallsBetween(4.5 * T, 1.5 * T, 7.5 * T, 1.5 * T)).toBe(1);
    // through the doorway in row 3 → open, but just beside the gap → wall
    expect(echoWallsBetween(4.5 * T, 3.5 * T, 7.5 * T, 3.5 * T)).toBe(0);
    expect(echoWallsBetween(4.5 * T, 3.5 * T + 1.2, 7.5 * T, 3.5 * T + 1.2)).toBe(1);
    // ward A → corridor → operating theatre through two doors in a line; a step to the side hits both walls
    expect(echoWallsBetween(7.5 * T, 4.5 * T, 7.5 * T, 9.5 * T)).toBe(0);
    expect(echoWallsBetween(6.2 * T, 4.5 * T, 6.2 * T, 9.5 * T)).toBe(2);
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
    expect(r.state("a", st({ x: 0.5, z: 0.5 }))).toBe(false); // inside the rock
    expect(r.state("a", st({ x: 18.3, z: j.spawn.z }))).toBe(false); // through the wall into ward A
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
    Object.assign(ann, { x: 14.5 * T, z: 10.5 * T, torch: false }); // alone in the morgue
    Object.assign(bob, { x: 1.5 * T, z: 1.5 * T });
    for (let i = 0; i < 4; i++) { x.r.clip("b", i, 900 + i * 200, i === 1 ? ["call"] : ["short"]); x.r.have("a", `2:${i}`); }
    const run = (sec: number) => { for (let i = 0; i < sec * 20; i++) { x.advance(50); x.r.step(); } };
    return { ...x, d, ann, bob, run };
  }

  it("finds walking paths between rooms and never through walls", () => {
    const p = echoPath([1, 1], [17, 11]);
    expect(p.length).toBeGreaterThan(10);
    let prev: [number, number] = [1, 1];
    for (const c of p) { expect(echoEdgeOpen(prev[0], prev[1], c[0], c[1])).toBe(true); prev = c; }
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
    // 8 m away across the room, lit from afar
    Object.assign(mm, { x: x.ann.x - 8, z: x.ann.z, state: "wander", path: [], nextLure: x.now() + 60_000 });
    Object.assign(x.ann, { yaw: Math.PI / 2, torch: true });
    x.run(3);
    expect(x.events.some((e) => e.type === "exposed")).toBe(false);
    expect(Math.hypot(mm.x - (x.ann.x - 8), mm.z - x.ann.z)).toBeGreaterThan(1); // it moved away
    x.r.destroy();
  });

  it("catches a player who walks up to it; they come back to the safe room later", () => {
    const x = night();
    x.run(MIMIC.WAKE_SEC + 1);
    const mm = x.d.mimics[0];
    Object.assign(mm, { x: x.ann.x - 2, z: x.ann.z, state: "chase", target: 1, until: x.now() + 10_000, path: [] });
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
    Object.assign(ann, { x: 43.5, z: 34.5, yaw: Math.PI });
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
    Object.assign(ann, { x: 43.5, z: 31.5, yaw: Math.PI / 2, torch: true }); // facing −x
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

describe("ECHO HALLS mimic — never harmless", () => {
  it("grabs a player who walks right up to it, even right after a catch", () => {
    let t = 1_000_000;
    const events: EchoEvent[] = [];
    const r = new EchoRoom("T4", "a", { meta: () => {}, snap: () => {}, event: (e) => events.push(e), onIdle: () => {} }, () => t, mulberry32(6));
    r.join("a", "Ann"); r.join("b", "Bob");
    const d = r.debug();
    const [ann, bob] = d.members;
    Object.assign(ann, { x: 43.5, z: 31.5, yaw: 0, torch: false });
    Object.assign(bob, { x: 7.5, z: 4.5 });
    for (let i = 0; i < 6; i++) { r.clip("b", i, 1200, ["short"]); r.have("a", `2:${i}`); }
    const run = (sec: number) => { for (let i = 0; i < sec * 20; i++) { t += 50; r.step(); } };
    run(MIMIC.WAKE_SEC + 1);
    const mm = d.mimics[0];
    // just wandering (calm after a catch), Ann bumps into it from behind
    Object.assign(mm, { x: ann.x - 2, z: ann.z, state: "wander", target: null, path: [], nextLure: t + 60_000 });
    run(1.5);
    expect(ann.taken).toBe(true);
    r.destroy();
  });

  it("prefers full phrases over tiny fragments", () => {
    let t = 1_000_000;
    const events: EchoEvent[] = [];
    const r = new EchoRoom("T5", "a", { meta: () => {}, snap: () => {}, event: (e) => events.push(e), onIdle: () => {} }, () => t, mulberry32(7));
    r.join("a", "Ann"); r.join("b", "Bob");
    const d = r.debug();
    const [ann, bob] = d.members;
    Object.assign(ann, { x: 43.5, z: 34.5, yaw: Math.PI });
    Object.assign(bob, { x: 7.5, z: 4.5 });
    const lens = [420, 480, 520, 1400, 1600, 2200];
    lens.forEach((ms, i) => { r.clip("b", i, ms, ["short"]); r.have("a", `2:${i}`); });
    for (let i = 0; i < (MIMIC.WAKE_SEC + 120) * 20; i++) { t += 50; r.step(); }
    const said = events.filter((e): e is Extract<EchoEvent, { type: "say" }> => e.type === "say").flatMap((e) => e.clips);
    expect(said.length).toBeGreaterThan(0);
    for (const k of said) expect(lens[Number(k.split(":")[1])]).toBeGreaterThanOrEqual(1400);
    r.destroy();
  });
});

describe("ECHO HALLS perks", () => {
  const T = ECHO.TILE;
  function night() {
    const x = room();
    x.r.join("a", "Ann"); x.r.join("b", "Bob");
    const d = x.r.debug();
    const [ann, bob] = d.members;
    Object.assign(ann, { x: 14.5 * T, z: 10.5 * T, torch: false });
    Object.assign(bob, { x: 1.5 * T, z: 1.5 * T });
    for (let i = 0; i < 4; i++) { x.r.clip("b", i, 900 + i * 200, i === 1 ? ["call"] : ["short"]); x.r.have("a", `2:${i}`); }
    const run = (sec: number) => { for (let i = 0; i < sec * 20; i++) { x.advance(50); x.r.step(); } };
    return { ...x, d, ann, bob, run };
  }
  it("Sam cuts himself free once per match; the second grab takes him", () => {
    const x = night();
    expect(x.r.setLook("a", { teen: "sam" })).toEqual({ ok: true });
    x.run(MIMIC.WAKE_SEC + 1);
    const mm = x.d.mimics[0];
    Object.assign(mm, { x: x.ann.x - 2, z: x.ann.z, state: "chase", target: 1, until: x.now() + 10_000, path: [] });
    x.run(1);
    expect(x.ann.taken).toBe(false);
    expect(x.events.some((e) => e.type === "free" && e.n === 1)).toBe(true);
    expect(mm.state).toBe("flee");
    Object.assign(mm, { x: x.ann.x - 2, z: x.ann.z, state: "chase", target: 1, until: x.now() + 10_000, path: [], windUp: 0 });
    x.run(1);
    expect(x.ann.taken).toBe(true);
    x.r.destroy();
  });

  it("Nora's headlamp exposes a calling monster twice as fast, from further away", () => {
    const x = night();
    expect(x.r.setLook("a", { teen: "nora" })).toEqual({ ok: true });
    x.run(MIMIC.WAKE_SEC + 1);
    const mm = x.d.mimics[0];
    // 7 m away, half the usual time
    Object.assign(mm, { x: x.ann.x - 7, z: x.ann.z, state: "lure", target: 1, until: x.now() + 60_000, path: [], lures: 1 });
    Object.assign(x.ann, { yaw: Math.PI / 2, torch: true });
    x.run(MIMIC.EXPOSE_SEC / PERK.NORA_EXPOSE + 0.2);
    expect(x.events.some((e) => e.type === "exposed")).toBe(true);
    x.r.destroy();
  });

  it("anyone else needs the full time", () => {
    const x = night();
    x.run(MIMIC.WAKE_SEC + 1);
    const mm = x.d.mimics[0];
    Object.assign(mm, { x: x.ann.x - 7, z: x.ann.z, state: "lure", target: 1, until: x.now() + 60_000, path: [], lures: 1 });
    Object.assign(x.ann, { yaw: Math.PI / 2, torch: true });
    x.run(MIMIC.EXPOSE_SEC / PERK.NORA_EXPOSE + 0.2);
    expect(x.events.some((e) => e.type === "exposed")).toBe(false);
    x.r.destroy();
  });
});

describe("ECHO HALLS crew", () => {
  it("gives each new player a different teen, and refuses a teen someone already plays", () => {
    const { r, metas } = room();
    r.join("a", "Ann"); r.join("b", "Bo");
    const teens = metas.at(-1)!.players.map((p) => p.look?.teen);
    expect(new Set(teens).size).toBe(2);
    const bTeen = teens[1]!;
    const res = r.setLook("a", { teen: bTeen });
    expect(res.ok).toBe(false);
    expect(r.setLook("a", { teen: "nora", coat: "denim", hat: "beanie", coatC: 5 })).toEqual({ ok: true });
    const a = metas.at(-1)!.players.find((p) => p.id === "a")!.look!;
    expect(a).toMatchObject({ teen: "nora", coat: "denim", hat: "beanie", coatC: 5, item: "torch" });
  });
  it("cleans bad looks: unknown teen refused, bad fields fall back, the item comes from the teen", () => {
    const { r, metas } = room();
    r.join("a", "Ann");
    expect(r.setLook("a", { teen: "zed" }).ok).toBe(false);
    expect(r.setLook("a", { teen: "sam", coat: "spacesuit", coatC: 99, item: "torch", gloves: "yes" }).ok).toBe(true);
    const look = metas.at(-1)!.players[0].look!;
    expect(look.coat).toBe("hoodie");
    expect(look.coatC).toBe(4);
    expect(look.item).toBe("cutters");
    expect(look.gloves).toBe(true);
  });
  it("shares who is talking in the snapshot", () => {
    const { r, snaps, advance } = room();
    r.join("a", "Ann");
    const sp = echoSpawns()[0];
    advance(100);
    r.state("a", { ...st({ x: sp.x, z: sp.z }), talk: true });
    r.step();
    expect(decodeEchoSnap(snaps.at(-1)!)[0].talk).toBe(true);
  });
});

describe("ECHO HALLS goal — the lift", () => {
  function match(players = 2) {
    const x = room();
    const ids = ["a", "b", "c"].slice(0, players);
    ids.forEach((id) => x.r.join(id, id.toUpperCase()));
    ids.forEach((id) => x.r.act(id, { type: "enter" }));
    const d = x.r.debug();
    const run = (sec: number) => { for (let i = 0; i < sec * 20; i++) { x.advance(50); x.r.step(); } };
    const put = (id: string, px: number, pz: number) => Object.assign(d.members.find((m) => m.id === id)!, { x: px, z: pz });
    return { ...x, d, run, put, g: () => x.r.goal };
  }
  it("hides three fuses in different spots and starts the clock when someone goes in", () => {
    const x = match();
    const g = x.g();
    expect(g.fuses).toHaveLength(GOAL.FUSES);
    expect(new Set(g.fuses.map((f) => `${f.x},${f.z}`)).size).toBe(GOAL.FUSES);
    expect(g.endsAt - g.startedAt).toBe(GOAL.MATCH_SEC * 1000);
    x.r.destroy();
  });
  it("you pick a fuse up only when close, carry one at a time, and install it at the fuse box", () => {
    const x = match();
    const [f0, f1] = x.g().fuses;
    expect(x.r.act("a", { type: "pickup", fuse: f0.id }).ok).toBe(false); // too far
    x.put("a", f0.x + 1, f0.z);
    expect(x.r.act("a", { type: "pickup", fuse: f0.id }).ok).toBe(true);
    x.put("a", f1.x, f1.z + 0.5);
    expect(x.r.act("a", { type: "pickup", fuse: f1.id }).ok).toBe(false); // hands full
    expect(x.r.act("a", { type: "install" }).ok).toBe(false); // not at the box
    x.put("a", GOAL.BOX.x - 1, GOAL.BOX.z);
    expect(x.r.act("a", { type: "install" }).ok).toBe(true);
    expect(x.g().placed).toBe(1);
    expect(x.events.some((e) => e.type === "install")).toBe(true);
    x.r.destroy();
  });
  it("a taken player drops the fuse where they were grabbed", () => {
    const x = match();
    const f = x.g().fuses[0];
    x.put("a", f.x, f.z);
    x.r.act("a", { type: "pickup", fuse: f.id });
    x.put("a", 20, 20);
    x.run(0.1);
    const a = x.d.members[0];
    (x.r as unknown as { take: (mm: unknown, m: unknown, t: number) => void }).take({ id: 1, x: 0, z: 0, state: "chase", nextLure: 0, path: [], pendingSay: null }, a, x.now());
    expect(x.g().fuses[0]).toMatchObject({ by: null, x: 20, z: 20 });
    expect(x.events.some((e) => e.type === "drop")).toBe(true);
    x.r.destroy();
  });
  it("with power on, everyone alive at the lift for a few seconds wins; the clock running out loses", () => {
    const x = match();
    for (const f of x.g().fuses) { x.put("a", f.x, f.z); x.r.act("a", { type: "pickup", fuse: f.id }); x.put("a", GOAL.BOX.x, GOAL.BOX.z); x.r.act("a", { type: "install" }); x.advance(200); }
    expect(x.g().power).toBe(true);
    x.put("a", GOAL.LIFT.x, GOAL.LIFT.z); x.put("b", 30, 20);
    x.run(GOAL.LIFT_HOLD + 1);
    expect(x.g().result).toBe(null); // Bob isn't there yet
    x.put("b", GOAL.LIFT.x + 0.5, GOAL.LIFT.z);
    x.run(GOAL.LIFT_HOLD + 0.5);
    expect(x.g().result).toBe("win");
    // another round: new fuses, back in reception, the clock restarts
    expect(x.r.act("b", { type: "restart" }).ok).toBe(true);
    expect(x.g().result).toBe(null);
    expect(x.g().placed).toBe(0);
    x.run(GOAL.MATCH_SEC + 1);
    expect(x.g().result).toBe("lose");
    x.r.destroy();
  });
});

describe("ECHO HALLS Channel 4", () => {
  it("shares who is on the radio, and the awake mimic sometimes speaks on Channel 4 with a stolen phrase", () => {
    const x = room();
    x.r.join("a", "Ann"); x.r.join("b", "Bob");
    const sp = echoSpawns()[0];
    x.advance(100);
    x.r.state("a", { ...st({ x: sp.x, z: sp.z }), radio: true });
    x.r.step();
    expect(decodeEchoSnap(x.snaps.at(-1)!).find((p) => p.n === 1)!.radio).toBe(true);
    for (let i = 0; i < 5; i++) { x.r.clip("b", i, 1500, ["short"]); x.r.have("a", `2:${i}`); }
    for (let i = 0; i < (MIMIC.WAKE_SEC + 60 + 130) * 20; i++) { x.advance(50); x.r.step(); }
    const calls = x.events.filter((e): e is Extract<EchoEvent, { type: "radio" }> => e.type === "radio");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.as === 2 && c.clips[0].startsWith("2:"))).toBe(true);
    x.r.destroy();
  });
});
