import { describe, it, expect } from "vitest";
import { mulberry32, type EchoEvent, type EchoMeta, type EchoSnap } from "@monumental/shared";
import { EchoRoom } from "./EchoRoom";

function solo() {
  let t = 1_000_000;
  const metas: EchoMeta[] = [];
  const events: EchoEvent[] = [];
  const r = new EchoRoom("PRAC", "a", { meta: (m) => metas.push(m), snap: (_s: EchoSnap) => {}, event: (e) => events.push(e), onIdle: () => {} }, () => t, mulberry32(3));
  r.join("a", "Ann");
  const run = (sec: number) => { for (let i = 0; i < sec * 20; i++) { t += 50; r.step(); } };
  return { r, metas, events, run, now: () => t };
}

describe("practice alone", () => {
  it("only the lone host, before the match; nobody else can join", () => {
    const x = solo();
    expect(x.r.act("a", { type: "practice" }).ok).toBe(true);
    expect(x.metas[x.metas.length - 1].practice).toBe(true);
    expect(x.r.join("b", "Bob").ok).toBe(false);
    const y = solo(); y.r.join("b", "Bob");
    expect(y.r.act("a", { type: "practice" }).ok).toBe(false);
  });

  it("starts with the pistol in hand and it never runs dry", () => {
    const x = solo();
    x.r.act("a", { type: "practice" }); x.r.act("a", { type: "enter" });
    expect(x.r.goal.gun.by).toBe(1);
    for (let i = 0; i < 6; i++) { expect(x.r.act("a", { type: "shoot", yaw: 0, pitch: 0 }).ok).toBe(true); x.run(0.2); }
    expect(x.r.goal.gun.ammo).toBe(99);
  });

  it("a Copy wakes for one player, wears their face, hunts them and speaks with their own voice", () => {
    const x = solo();
    x.r.act("a", { type: "practice" }); x.r.act("a", { type: "enter" });
    for (let i = 0; i < 12; i++) x.r.clip("a", i, 1500, ["short"]);
    x.run(20);
    expect(x.events.some((e) => e.type === "wake")).toBe(true);
    const d = x.r.debug();
    expect(d.mimics.length).toBe(1);
    expect(d.mimics[0].as).toBe(1);
    x.run(120);
    expect(x.events.some((e) => e.type === "say" || e.type === "reveal" || e.type === "taken")).toBe(true);
    // never gone for good in practice
    expect(d.members[0].gone).toBe(false);
  });
});

import { tagText } from "@monumental/shared";
describe("v36 whole-word tags", () => {
  it("where is not here, same is not Sam, monkey has no key", () => {
    expect(tagText("where are you", {})).not.toContain("here");
    expect(tagText("where are you", {})).toContain("question");
    expect(tagText("I'm here", {})).toContain("here");
    expect(tagText("it's the same", { 3: "sam" })).not.toContain("name:3");
    expect(tagText("Sam, over here", { 3: "sam" })).toEqual(expect.arrayContaining(["name:3", "call", "here"]));
    expect(tagText("look a monkey", {})).not.toContain("found");
    expect(tagText("يا سارة تعالي هنا", { 2: "سارة" })).toEqual(expect.arrayContaining(["name:2", "call", "here"]));
  });
});

describe("v36 clip choice", () => {
  it("prefers the piece that calls the target by name, joined with a call said in the same breath", () => {
    let t = 1_000_000;
    const r = new EchoRoom("PICK", "a", { meta: () => {}, snap: () => {}, event: () => {}, onIdle: () => {} }, () => t, mulberry32(5));
    r.join("a", "Ann"); r.join("b", "Bob");
    const d = r.debug();
    const [ann, bob] = d.members;
    Object.assign(bob, { x: ann.x + 40, z: ann.z }); // Bob says these far from Ann: she never heard them live
    r.clip("b", 1, 1500, ["short"]);
    r.clip("b", 2, 700, ["short", "name:1"]);
    r.clip("b", 3, 1300, ["long", "call"]);
    r.clip("b", 4, 1400, ["long", "name:2"]);
    for (const c of d.clips.values()) c.have.add(1);
    t += 30_000;
    const keys = (r as unknown as { pick: (...a: unknown[]) => string[] }).pick(ann, 2, "call", false);
    expect(keys).toEqual(["2:2", "2:3"]);
  });
});

describe("v36 name called", () => {
  it("a Copy wearing Bob answers when Ann calls Bob and the real Bob is far away", () => {
    let t = 1_000_000;
    const events: EchoEvent[] = [];
    const r = new EchoRoom("NAME", "a", { meta: () => {}, snap: () => {}, event: (e) => events.push(e), onIdle: () => {} }, () => t, mulberry32(11));
    r.wakeSec = 1;
    r.join("a", "Ann"); r.join("b", "Bob");
    r.act("a", { type: "enter" }); r.act("b", { type: "enter" });
    const run = (sec: number) => { for (let i = 0; i < sec * 20; i++) { t += 50; r.step(); } };
    run(2);
    const d = r.debug();
    const [ann, bob] = d.members;
    const mm = d.mimics[0];
    Object.assign(bob, { x: ann.x + 40 });
    for (let i = 0; i < 5; i++) r.clip("b", i, 900, ["short", "here"]);
    for (const c of d.clips.values()) c.have.add(1);
    t += 30_000;
    Object.assign(mm, { as: 2, x: ann.x + 4, z: ann.z, state: "wander", path: [], speakingUntil: 0, nextHunt: t + 999_999 });
    let said = false;
    for (let k = 0; k < 12 && !said; k++) {
      r.clip("a", 100 + k, 600, ["short"]);
      r.tag("a", 100 + k, ["name:2"]);
      const t0 = t;
      run(2);
      const e = events.find((x) => x.type === "say");
      if (e) { said = true; expect(t - t0).toBeLessThanOrEqual(2000); }
    }
    expect(said).toBe(true);
  });
});

describe("v37 practice attacks", () => {
  it("even face to face, the practice Copy goes for you after a few seconds at your side", () => {
    const x = solo();
    x.r.act("a", { type: "practice" }); x.r.act("a", { type: "enter" });
    x.run(20);
    const d = x.r.debug();
    const [me] = d.members, mm = d.mimics[0];
    me.torch = false;
    // it stands 2 m in front of me and I look straight at it
    Object.assign(mm, { x: me.x, z: me.z - 2, state: "follow", target: me.n, followSince: x.now(), path: [] });
    me.yaw = 0;
    x.run(20);
    expect(x.events.some((e) => e.type === "taken" || e.type === "reveal")).toBe(true);
  });
});

import { GOAL } from "@monumental/shared";
describe("v39 fuses", () => {
  it("pulls a fuse back out of the box when nobody is near it, and drops a carried fuse when shot", () => {
    const x = solo();
    x.r.act("a", { type: "practice" }); x.r.act("a", { type: "enter" });
    x.run(20);
    const d = x.r.debug();
    const [me] = d.members, mm = d.mimics[0];
    const g = x.r.goal;
    // one fuse is in the box; I am far away
    Object.assign(g.fuses[0], { placed: true, by: null, x: GOAL.BOX.x, y: 1.4, z: GOAL.BOX.z }); g.placed = 1;
    g.fuses[1].by = 99; g.fuses[2].by = 99; // the others are in someone's hands
    Object.assign(me, { x: 7.5, z: 13.5 });
    Object.assign(mm, { x: GOAL.BOX.x + 1, z: GOAL.BOX.z, state: "wander", path: [], nextHunt: x.now() + 999_999, nextFetch: 0 });
    let unplugged = false;
    for (let i = 0; i < 40 && !unplugged; i++) { x.run(1); unplugged = x.events.some((e) => e.type === "unplug"); if (process.env.DBG) console.log(i, mm.state, JSON.stringify(mm.fetch), mm.x.toFixed(1), mm.z.toFixed(1), mm.path.length, mm.nextFetch! - x.now()); }
    expect(unplugged).toBe(true);
    expect(g.placed).toBe(0);
    expect(mm.carry).toBe(0);
    // shoot it: the fuse falls where it stands
    Object.assign(me, { x: mm.x, z: mm.z + 3, yaw: 0, crouch: false });
    x.r.act("a", { type: "shoot", yaw: 0, pitch: -0.25 });
    expect(mm.carry).toBe(null);
    expect(g.fuses[0].by).toBe(null);
    expect(g.fuses[0].placed).toBe(false);
  });
});

import { copyBrain } from "./brain";
describe("v40 learning from a match", () => {
  it("at the end of a match it keeps how the players moved (unless they opted out)", () => {
    let t = 1_000_000;
    const r = new EchoRoom("LRN", "a", { meta: () => {}, snap: () => {}, event: () => {}, onIdle: () => {} }, () => t, mulberry32(4));
    r.matchSec = 40;
    r.join("a", "Ann"); r.join("b", "Bob");
    r.act("a", { type: "enter" }); r.act("b", { type: "enter" });
    r.act("b", { type: "learn", on: false });
    const [ann] = r.debug().members;
    let x = ann.x, z = ann.z, yaw = 0;
    const before = copyBrain.stats.matches;
    for (let i = 0; i < 300; i++) {
      t += 100;
      // walk back and forth along the spawn room, looking around a bit
      const dir = Math.floor(i / 40) % 2 ? -1 : 1;
      const nx = x + dir * 0.18;
      yaw = Math.sin(i / 7) * 0.6 + (dir > 0 ? -Math.PI / 2 : Math.PI / 2);
      if (r.state("a", { x: nx, y: 0, z, yaw, pitch: -0.1, torch: true, crouch: false, seq: i })) x = nx;
      r.step();
    }
    t += 60_000; r.step();
    expect(r.goal.result).toBe("lose");
    expect(copyBrain.stats.matches).toBe(before + 1); // Ann's moves only: Bob opted out
  });
});

describe("v42 conversation", () => {
  it("answers, in a friend's voice, when you finish saying something — most of the time", () => {
    let t = 1_000_000;
    const events: EchoEvent[] = [];
    const r = new EchoRoom("TALK", "a", { meta: () => {}, snap: () => {}, event: (e) => events.push(e), onIdle: () => {} }, () => t, mulberry32(21));
    r.wakeSec = 1;
    r.join("a", "Ann"); r.join("b", "Bob");
    r.act("a", { type: "enter" }); r.act("b", { type: "enter" });
    const step = (n: number) => { for (let i = 0; i < n; i++) { t += 50; r.step(); } };
    step(40);
    const d = r.debug();
    const [ann, bob] = d.members;
    Object.assign(bob, { x: ann.x + 40 });
    for (let i = 0; i < 20; i++) r.clip("b", i, 1000 + i * 30, i % 3 ? ["short", "part"] : ["long"]);
    for (const c of d.clips.values()) c.have.add(1);
    const mm = d.mimics[0];
    let answers = 0;
    for (let k = 0; k < 10; k++) {
      Object.assign(mm, { as: 2, x: ann.x + 3, z: ann.z, state: "wander", path: [], nextHunt: t + 999_999, nextFetch: t + 999_999, speakingUntil: 0, pendingSay: null });
      const s = { x: ann.x, y: 0, z: ann.z, yaw: 0, pitch: 0, torch: false, crouch: false };
      r.state("a", { ...s, talk: true, seq: 2 * k });
      step(20); // she talks for a second
      t += 50; r.state("a", { ...s, talk: false, seq: 2 * k + 1 });
      const before = events.filter((e) => e.type === "say").length;
      step(40); // two seconds
      if (events.filter((e) => e.type === "say").length > before) answers++;
      t += 4000;
    }
    expect(answers).toBeGreaterThanOrEqual(5);
  });
});
