import { describe, it, expect } from "vitest";
import { COPY, ECHO, ECHO_LOCKERS, ECHO_MAP, GOAL, HIDE, MIMIC, echoFree, echoPath, echoTileOf, lockerFront, mulberry32, decodeEchoSnap, type EchoEvent, type EchoMeta, type EchoSnap } from "@monumental/shared";
import { EchoRoom } from "./EchoRoom";

function room() {
  let t = 1_000_000;
  const metas: EchoMeta[] = [];
  const snaps: EchoSnap[] = [];
  const events: EchoEvent[] = [];
  const r = new EchoRoom("TEST2", "a", { meta: (m) => metas.push(m), snap: (s) => snaps.push(s), event: (e) => events.push(e), onIdle: () => {} }, () => t, mulberry32(7));
  r.join("a", "Ann"); r.join("b", "Bob");
  r.act("a", { type: "enter" }); r.act("b", { type: "enter" });
  const d = r.debug();
  const [ann, bob] = d.members;
  const run = (sec: number, each?: () => void) => { for (let i = 0; i < sec * 20; i++) { t += 50; each?.(); r.step(); } };
  return { r, metas, snaps, events, d, ann, bob, run, now: () => t };
}

describe("v34 map", () => {
  it("is bigger, every open cell is reachable, and every locker, fuse spot and gun spot is in a room", () => {
    expect(ECHO_MAP.join("").split("").filter((c) => c !== "#").length).toBeGreaterThan(550);
    for (let z = 0; z < ECHO_MAP.length; z++) for (let x = 0; x < ECHO_MAP[0].length; x++) {
      if (ECHO_MAP[z][x] === "#" || (x === 2 && z === 3)) continue;
      expect(echoPath([2, 3], [x, z]).length, `cell ${x},${z}`).toBeGreaterThan(0);
    }
    ECHO_LOCKERS.forEach((L, i) => { expect(echoFree(L[0], L[1]), `locker ${i}`).toBe(true); const f = lockerFront(i); expect(echoFree(f.x, f.z), `front ${i}`).toBe(true); expect(echoTileOf(f.x) === echoTileOf(L[0]) && echoTileOf(f.z) === echoTileOf(L[1])).toBe(true); });
    for (const [x, , z] of [...GOAL.SPOTS, ...GOAL.GUN_SPOTS]) expect(echoFree(x, z), `${x},${z}`).toBe(true);
  });
});

describe("v34 lockers", () => {
  it("you get in only from the door, the snapshot hides you, and you step back out in front", () => {
    const x = room();
    const f = lockerFront(4);
    expect(x.r.act("a", { type: "hide", locker: 4 }).ok).toBe(false); // too far
    Object.assign(x.ann, { x: f.x, z: f.z });
    expect(x.r.act("a", { type: "hide", locker: 4 }).ok).toBe(true);
    Object.assign(x.bob, { x: f.x, z: f.z });
    expect(x.r.act("b", { type: "hide", locker: 4 }).ok).toBe(false); // taken
    x.run(0.1);
    expect(decodeEchoSnap(x.snaps[x.snaps.length - 1]).find((p) => p.n === 1)!.hidden).toBe(true);
    // can't walk while inside
    expect(x.r.state("a", { x: f.x + 1, y: 0, z: f.z, yaw: 0, pitch: 0, torch: true, crouch: false, seq: 2 })).toBe(false);
    expect(x.r.act("a", { type: "unhide" }).ok).toBe(true);
    expect(Math.hypot(x.ann.x - f.x, x.ann.z - f.z)).toBeLessThan(0.01);
    expect(x.r.goal.hidden).toEqual([]);
    x.r.destroy();
  });

  it("a Copy that didn't see you get in loses you; one that did tears the locker open", () => {
    for (const saw of [false, true]) {
      const x = room();
      x.run(MIMIC.WAKE_SEC + 1);
      const mm = x.d.mimics[0];
      const L = ECHO_LOCKERS[5], f = lockerFront(5);
      Object.assign(x.ann, { x: f.x, z: f.z, torch: false });
      Object.assign(x.bob, { x: 1.5 * ECHO.TILE, z: 1.5 * ECHO.TILE });
      // the Copy (as Bob) is on her heels: in the next room, or right behind her
      Object.assign(mm, saw ? { x: f.x, z: f.z + 4 } : { x: 25, z: 60 }, { as: 2, state: "stalk", target: 1, until: x.now() + 60_000, path: [], nextHunt: x.now() + 60_000 });
      expect(x.r.act("a", { type: "hide", locker: 5 }).ok).toBe(true);
      expect(mm.saw.has(1)).toBe(saw);
      x.run(12);
      const yanked = x.events.some((e) => e.type === "yank");
      expect(yanked).toBe(saw);
      if (saw) { expect(x.ann.taken).toBe(true); expect(x.ann.hidden).toBe(null); }
      else { expect(x.ann.taken).toBe(false); expect(mm.target).not.toBe(1); }
      void L;
      x.r.destroy();
    }
  });

  it("talking inside a locker gives you away to a Copy close by", () => {
    const x = room();
    x.run(MIMIC.WAKE_SEC + 1);
    const mm = x.d.mimics[0];
    const f = lockerFront(5);
    Object.assign(x.ann, { x: f.x, z: f.z, torch: false });
    Object.assign(mm, { x: 25, z: 60, state: "wander", as: 2, path: [], nextHunt: x.now() + 60_000 });
    x.r.act("a", { type: "hide", locker: 5 });
    x.run(2);
    expect(mm.target).not.toBe(1);
    Object.assign(mm, { x: f.x - 5, z: f.z + 3, state: "wander", path: [] });
    x.ann.talk = true;
    x.run(0.2);
    expect(mm.saw.has(1)).toBe(true);
    expect(mm.target).toBe(1);
    x.r.destroy();
  });
});

describe("v34 the pistol", () => {
  it("one pistol, three bullets; a shot unmasks the Copy and drives it off; a shot friend bleeds, twice and they're gone", () => {
    const x = room();
    x.run(MIMIC.WAKE_SEC + 1);
    const gun = x.r.goal.gun;
    expect(gun.by).toBe(null);
    expect(gun.ammo).toBe(GOAL.AMMO);
    expect(x.r.act("a", { type: "gun" }).ok).toBe(false); // too far
    Object.assign(x.ann, { x: gun.x + 0.5, z: gun.z });
    expect(x.r.act("a", { type: "gun" }).ok).toBe(true);
    expect(x.r.act("b", { type: "shoot", yaw: 0, pitch: 0 }).ok).toBe(false);
    // the Copy, dressed as Bob, 5 m straight ahead of Ann (yaw 0 = looking toward −z) in the police checkpoint
    const mm = x.d.mimics[0];
    Object.assign(x.ann, { x: 75, z: 34, yaw: 0, crouch: false });
    Object.assign(x.bob, { x: 3, z: 3 });
    Object.assign(mm, { x: 75, z: 29, state: "follow", target: 1, as: 2, path: [], followSince: x.now() });
    expect(x.r.act("a", { type: "shoot", yaw: 0, pitch: 0 }).ok).toBe(true);
    const shot = x.events.filter((e) => e.type === "shot").pop() as Extract<EchoEvent, { type: "shot" }>;
    expect(shot.hit).toEqual({ copy: mm.id });
    expect(mm.state).toBe("flee");
    expect(x.r.goal.gun.ammo).toBe(GOAL.AMMO - 1);
    // now Bob for real, in the line of fire
    Object.assign(mm, { x: 3, z: 60 });
    Object.assign(x.bob, { x: 75, z: 30 });
    x.r.act("a", { type: "shoot", yaw: 0, pitch: 0 });
    expect(x.bob.strikes).toBe(1);
    expect(x.bob.gone).toBe(false);
    x.r.act("a", { type: "shoot", yaw: 0, pitch: 0 });
    expect(x.bob.gone).toBe(true);
    expect(x.r.act("a", { type: "shoot", yaw: 0, pitch: 0 })).toEqual({ ok: false, error: "Click. It's empty." });
    expect(COPY.STRIKES).toBe(2);
    x.r.destroy();
  });

  it("walls stop bullets", () => {
    const x = room();
    const gun = x.r.goal.gun;
    Object.assign(x.ann, { x: gun.x, z: gun.z });
    x.r.act("a", { type: "gun" });
    // Ann in the playroom, Bob behind the wall in the police checkpoint
    Object.assign(x.ann, { x: 66, z: 30, yaw: -Math.PI / 2 });
    Object.assign(x.bob, { x: 71, z: 34.5 });
    Object.assign(x.ann, { yaw: -Math.PI / 2 }); // facing +x
    x.r.act("a", { type: "shoot", yaw: -Math.PI / 2, pitch: 0 });
    expect(x.bob.strikes).toBe(0);
    const shot = x.events.filter((e) => e.type === "shot").pop() as Extract<EchoEvent, { type: "shot" }>;
    expect(shot.hit).toBe(null);
    expect(shot.hx).toBeLessThan(69.2);
    void HIDE;
    x.r.destroy();
  });
});
