import { describe, it, expect, vi, afterEach } from "vitest";
import { COPY, ECHO, ECHO_MAP, ECHO_W, GOAL, MIMIC, PERK, echoEdgeOpen, echoFree, echoPath, echoSpawns, echoWallsBetween, decodeEchoSnap, muDecode, muEncode, tagText, mulberry32, type EchoEvent, type EchoMeta, type EchoSnap, type EchoSnap2 } from "@monumental/shared";
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

describe("ECHO HALLS the Copy", () => {
  const T = ECHO.TILE;
  /** Two players far apart (both went in), Bob has said a few things that Ann's device holds. */
  function night() {
    const x = room();
    x.r.join("a", "Ann"); x.r.join("b", "Bob");
    x.r.act("a", { type: "enter" }); x.r.act("b", { type: "enter" });
    const d = x.r.debug();
    const [ann, bob] = d.members;
    Object.assign(ann, { x: 14.5 * T, z: 10.5 * T, torch: false }); // alone in the morgue
    Object.assign(bob, { x: 1.5 * T, z: 1.5 * T });
    for (let i = 0; i < 4; i++) { x.r.clip("b", i, 900 + i * 200, i === 1 ? ["call"] : i === 2 ? ["here"] : ["short"]); x.r.have("a", `2:${i}`); }
    const run = (sec: number, each?: () => void) => { for (let i = 0; i < sec * 20; i++) { x.advance(50); each?.(); x.r.step(); } };
    return { ...x, d, ann, bob, run };
  }
  /** Woken, dressed as Bob, tagging along 4 m from Ann in her room. */
  function following() {
    const x = night();
    x.run(MIMIC.WAKE_SEC + 1);
    const mm = x.d.mimics[0];
    Object.assign(mm, { x: x.ann.x - 4, z: x.ann.z, as: 2, state: "follow", target: 1, followSince: x.now() - 10_000, path: [], nextHunt: x.now() + 60_000 });
    return { ...x, mm };
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

  it("sleeps until two players have been in for a while, then wakes wearing one of their faces", () => {
    const x = night();
    x.run(MIMIC.WAKE_SEC - 5);
    expect(x.d.mimics).toHaveLength(0);
    x.run(6);
    expect(x.d.mimics).toHaveLength(1);
    expect([1, 2]).toContain(x.d.mimics[0].as);
    expect(x.events.some((e) => e.type === "wake")).toBe(true);
    // the snapshot carries whose face it wears
    expect((x.snaps.at(-1) as EchoSnap2).m![0][6]).toBe(x.d.mimics[0].as);
    x.r.destroy();
  });

  it("hunts the lonely player wearing the OTHER player's face, never their own", () => {
    const x = night();
    x.run(MIMIC.WAKE_SEC + 1);
    const mm = x.d.mimics[0];
    mm.nextHunt = 0;
    let saw = false;
    x.run(40, () => { if (mm.target === 1) saw = true; });
    expect(saw).toBe(true);
    expect(mm.as).toBe(2);
    x.r.destroy();
  });

  it("acts like a player: walks at walking pace, stops to search, crouches and turns", () => {
    const x = night();
    x.run(MIMIC.WAKE_SEC + 1);
    const mm = x.d.mimics[0];
    mm.nextHunt = x.now() + 600_000;
    const states = new Set<string>();
    let fastest = 0, crouched = false, lx = mm.x, lz = mm.z;
    x.run(60, () => { states.add(mm.state); crouched ||= mm.crouch; fastest = Math.max(fastest, Math.hypot(mm.x - lx, mm.z - lz) / 0.05); lx = mm.x; lz = mm.z; });
    expect(states.has("search")).toBe(true);
    expect(fastest).toBeLessThanOrEqual(COPY.HURRY + 0.01);
    expect(crouched).toBe(true);
    x.r.destroy();
  });

  it("follows like a friend, then strikes when she turns her back and nobody else is watching", () => {
    const x = following();
    Object.assign(x.ann, { yaw: Math.PI / 2 + Math.PI }); // facing away from it (it is to her west)
    x.run(1);
    const rev = x.events.find((e) => e.type === "reveal");
    expect(rev && rev.type === "reveal" && rev.as).toBe(2);
    x.run(COPY.REVEAL_SEC + 1.5);
    expect(x.ann.taken).toBe(true);
    expect(x.ann.strikes).toBe(1);
    expect(x.ann.gone).toBe(false);
    x.run(COPY.BACK_SEC + 0.5);
    expect(x.ann.taken).toBe(false);
    expect(x.events.some((e) => e.type === "back" && e.n === 1)).toBe(true);
    x.r.destroy();
  });

  it("does not strike while she is looking at it, or while someone else can see it", () => {
    const x = following();
    Object.assign(x.ann, { yaw: Math.PI / 2 }); // looking straight at it
    x.run(3);
    expect(x.events.some((e) => e.type === "reveal")).toBe(false);
    const y = following();
    Object.assign(y.ann, { yaw: Math.PI / 2 + Math.PI });
    Object.assign(y.bob, { x: y.ann.x - 1, z: y.ann.z + 1 }); // a witness (Bob is the real Bob, so it walks off)
    y.run(3);
    expect(y.events.some((e) => e.type === "reveal")).toBe(false);
    expect(y.mm.state).not.toBe("follow");
    x.r.destroy(); y.r.destroy();
  });

  it("answers a question late, in the voice of the face it wears", () => {
    const x = following();
    Object.assign(x.ann, { yaw: Math.PI / 2 });
    x.ann.askedAt = x.now();
    x.run(0.8);
    expect(x.events.some((e) => e.type === "say")).toBe(false);
    x.run(1.2);
    const say = x.events.find((e) => e.type === "say");
    expect(say && say.type === "say" && say.clips.every((k) => k.startsWith("2:"))).toBe(true);
    x.r.destroy();
  });

  it("a torch from across the room does nothing; closer it walks out of the beam; held on it, its face slides off and it runs", () => {
    const x = night();
    x.run(MIMIC.WAKE_SEC + 1);
    const mm = x.d.mimics[0];
    // from across the room the light does nothing
    Object.assign(mm, { x: x.ann.x - 8, z: x.ann.z, as: 2, state: "search", path: [], nextHunt: x.now() + 60_000, look: { kind: "sweep", base: 0, from: x.now(), to: x.now() + 60_000 } });
    Object.assign(x.ann, { yaw: Math.PI / 2, torch: true });
    x.run(COPY.EXPOSE_SEC + 0.5, () => Object.assign(mm, { x: x.ann.x - 8, z: x.ann.z }));
    expect(x.events.some((e) => e.type === "exposed")).toBe(false);
    // closer, it notices and walks out of the beam
    Object.assign(mm, { x: x.ann.x - 5.5, z: x.ann.z });
    x.run(1);
    expect(mm.path.length).toBeGreaterThan(0);
    expect(x.events.some((e) => e.type === "exposed")).toBe(false);
    // keep it in the light
    x.run(COPY.EXPOSE_SEC + 0.5, () => { if (mm.state !== "flee") Object.assign(mm, { x: x.ann.x - 5.5, z: x.ann.z }); });
    expect(x.events.some((e) => e.type === "exposed")).toBe(true);
    expect(x.events.some((e) => e.type === "reveal")).toBe(true);
    expect(mm.state).toBe("flee");
    x.r.destroy();
  });

  it("close and alone with her, the light makes it attack instead", () => {
    const x = following();
    Object.assign(x.mm, { x: x.ann.x - 3 });
    Object.assign(x.ann, { yaw: Math.PI / 2, torch: true });
    x.run(1);
    expect(x.mm.state).toBe("chase");
    x.r.destroy();
  });

  it("grabbed twice and you're gone for good; when everyone is gone the night is lost", () => {
    const x = following();
    const take = (x.r as unknown as { take: (mm: unknown, m: unknown, t: number) => void }).take.bind(x.r);
    take(x.mm, x.ann, x.now());
    x.run(COPY.BACK_SEC + 0.5);
    take(x.mm, x.ann, x.now());
    expect(x.ann.gone).toBe(true);
    expect(x.r.goal.gone).toContain(1);
    x.run(COPY.BACK_SEC + 1);
    expect(x.ann.taken).toBe(true);
    take(x.mm, x.bob, x.now()); x.run(COPY.BACK_SEC + 0.5); take(x.mm, x.bob, x.now());
    x.run(0.2);
    expect(x.r.goal.result).toBe("lose");
    expect(x.r.goal.summary!.players.every((p) => p.status === "gone")).toBe(true);
    x.r.destroy();
  });

  it("finds a fuse nobody is watching and hides it somewhere else", () => {
    const x = night();
    x.run(MIMIC.WAKE_SEC + 1);
    const mm = x.d.mimics[0];
    const f = x.r.goal.fuses[0];
    const [fx, fz] = [f.x, f.z];
    // everyone far away, behind walls
    Object.assign(x.ann, { x: 1.5 * T, z: 2.5 * T }); Object.assign(x.bob, { x: 1.5 * T, z: 1.5 * T });
    Object.assign(mm, { x: fx, z: fz, as: 2, state: "wander", path: [], nextHunt: x.now() + 600_000, look: { kind: "sweep", base: 0, from: 0, to: 0 } });
    let carried = false;
    x.run(90, () => { if (f.by === -1) carried = true; });
    expect(carried).toBe(true);
    expect(f.by).toBe(null);
    expect(Math.hypot(f.x - fx, f.z - fz)).toBeGreaterThan(10);
    x.r.destroy();
  });

  describe("perks", () => {
    it("Sam cuts himself free once per match; the second grab takes him", () => {
      const x = following();
      expect(x.r.setLook("a", { teen: "sam" })).toEqual({ ok: true });
      Object.assign(x.mm, { x: x.ann.x - 2, state: "chase", windUp: 0, until: x.now() + 10_000 });
      x.run(1);
      expect(x.ann.taken).toBe(false);
      expect(x.events.some((e) => e.type === "free" && e.n === 1)).toBe(true);
      expect(x.mm.state).toBe("flee");
      Object.assign(x.mm, { x: x.ann.x - 2, z: x.ann.z, state: "chase", target: 1, windUp: 0, until: x.now() + 10_000, path: [] });
      x.run(1);
      expect(x.ann.taken).toBe(true);
      x.r.destroy();
    });

    it("Nora's headlamp unmasks it twice as fast", () => {
      const x = night();
      expect(x.r.setLook("a", { teen: "nora" })).toEqual({ ok: true });
      x.run(MIMIC.WAKE_SEC + 1);
      const mm = x.d.mimics[0];
      Object.assign(x.ann, { yaw: Math.PI / 2, torch: true });
      const hold = () => { if (mm.state !== "flee") Object.assign(mm, { x: x.ann.x - 8, z: x.ann.z, as: 2 }); };
      x.run(COPY.EXPOSE_SEC / PERK.NORA_EXPOSE + 0.2, hold);
      expect(x.events.some((e) => e.type === "exposed")).toBe(true);
      const y = night();
      y.run(MIMIC.WAKE_SEC + 1);
      const m2 = y.d.mimics[0];
      Object.assign(y.ann, { yaw: Math.PI / 2, torch: true });
      y.run(COPY.EXPOSE_SEC / PERK.NORA_EXPOSE + 0.2, () => { if (m2.state !== "flee") Object.assign(m2, { x: y.ann.x - 8, z: y.ann.z, as: 2 }); });
      expect(y.events.some((e) => e.type === "exposed")).toBe(false);
      x.r.destroy(); y.r.destroy();
    });
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
    // prying it out takes a moment; you must stay close
    x.run(GOAL.PRY_SEC - 0.5);
    expect(x.g().fuses[0].by).toBe(null);
    x.run(0.6);
    expect(x.g().fuses[0].by).toBe(1);
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
    x.run(GOAL.PRY_SEC + 0.1);
    x.put("a", 20, 20);
    x.run(0.1);
    const a = x.d.members[0];
    (x.r as unknown as { take: (mm: unknown, m: unknown, t: number) => void }).take({ id: 1, x: 0, z: 0, as: 2, state: "chase", nextHunt: 0, path: [], pendingSay: null, lit: new Map() }, a, x.now());
    expect(x.g().fuses[0]).toMatchObject({ by: null, x: 20, z: 20 });
    expect(x.events.some((e) => e.type === "drop")).toBe(true);
    x.r.destroy();
  });
  function power(x: ReturnType<typeof match>) {
    for (const f of x.g().fuses) { x.put("a", f.x, f.z); x.r.act("a", { type: "pickup", fuse: f.id }); x.run(GOAL.PRY_SEC + 0.1); x.put("a", GOAL.BOX.x, GOAL.BOX.z); x.r.act("a", { type: "install" }); }
  }
  it("with power on, call the lift, survive until it comes, everyone alive inside for a few seconds wins; the clock running out loses", () => {
    const x = match();
    power(x);
    expect(x.g().power).toBe(true);
    x.put("a", GOAL.LIFT.x, GOAL.LIFT.z); x.put("b", 30, 20);
    expect(x.r.act("b", { type: "call" }).ok).toBe(false); // too far
    expect(x.r.act("a", { type: "call" }).ok).toBe(true);
    expect(x.g().liftAt - x.g().calledAt).toBe(GOAL.LIFT_CALL_SEC * 1000);
    x.put("b", GOAL.LIFT.x + 0.5, GOAL.LIFT.z);
    x.run(GOAL.LIFT_CALL_SEC - 2);
    expect(x.g().result).toBe(null); // not here yet
    x.put("b", 30, 20);
    x.run(2 + GOAL.LIFT_HOLD + 1);
    expect(x.events.some((e) => e.type === "lift")).toBe(true);
    expect(x.g().result).toBe(null); // Bob isn't inside
    x.put("b", GOAL.LIFT.x + 0.5, GOAL.LIFT.z);
    x.run(GOAL.LIFT_HOLD + 0.5);
    expect(x.g().result).toBe("win");
    const sum = x.g().summary!;
    expect(sum.players.map((p) => p.status)).toEqual(["escaped", "escaped"]);
    expect(sum.players[0].fuses).toBe(3);
    expect(sum.moments.some((m) => /power/i.test(m.text))).toBe(true);
    // another round: new fuses, back in reception, the clock restarts
    expect(x.r.act("b", { type: "restart" }).ok).toBe(true);
    expect(x.g().result).toBe(null);
    expect(x.g().placed).toBe(0);
    x.run(GOAL.MATCH_SEC + 1);
    expect(x.g().result).toBe("lose");
    x.r.destroy();
  });
});

describe("ECHO HALLS the lift ride", () => {
  it("a Copy standing with you when the doors close takes one of you", () => {
    const x = room();
    ["a", "b"].forEach((id) => { x.r.join(id, id.toUpperCase()); x.r.act(id, { type: "enter" }); });
    const d = x.r.debug();
    const run = (sec: number) => { for (let i = 0; i < sec * 20; i++) { x.advance(50); x.r.step(); } };
    for (let i = 0; i < 3; i++) { x.r.clip("b", i, 1200, ["short"]); x.r.have("a", `2:${i}`); }
    run(MIMIC.WAKE_SEC + 1);
    const g = x.r.goal;
    Object.assign(g, { power: true, placed: 3, calledAt: x.now(), liftAt: x.now() });
    for (const m of d.members) Object.assign(m, { x: GOAL.LIFT.x + (m.n - 1.5) * 0.6, z: GOAL.LIFT.z, yaw: 0 });
    const mm = d.mimics[0];
    Object.assign(mm, { x: GOAL.LIFT.x, z: GOAL.LIFT.z + 0.8, state: "lift", as: 1, path: [] });
    run(GOAL.LIFT_HOLD + 1);
    expect(g.result).toBe("win");
    expect(g.summary!.rode).toBe(true);
    expect(g.summary!.players.filter((p) => p.status === "rode")).toHaveLength(1);
    expect(g.summary!.faces[0].n).toBe(1);
    x.r.destroy();
  });
});

describe("ECHO HALLS Channel 4", () => {
  it("shares who is on the radio, and the awake mimic sometimes speaks on Channel 4 with a stolen phrase", () => {
    const x = room();
    x.r.join("a", "Ann"); x.r.join("b", "Bob");
    x.r.act("a", { type: "enter" }); x.r.act("b", { type: "enter" });
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
