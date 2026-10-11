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
