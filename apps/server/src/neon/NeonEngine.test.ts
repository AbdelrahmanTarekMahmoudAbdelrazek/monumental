import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mulberry32, NEON, type NeonMeta, type NeonSnap } from "@monumental/shared";
import { NeonEngine } from "./NeonEngine";

function arena(bots = 0, seed = 1) {
  const metas: NeonMeta[] = [];
  const snaps: NeonSnap[] = [];
  const t = new NeonEngine("TEST1", "h", { arena: "small", bots }, {
    meta: (m) => metas.push(JSON.parse(JSON.stringify(m))),
    snap: (s) => snaps.push(s),
    onIdle: () => {},
  }, () => Date.now(), mulberry32(seed));
  return { t, metas, snaps, meta: () => metas[metas.length - 1], snap: () => snaps[snaps.length - 1] };
}
type Priv = { cars: { id: string; x: number; y: number; a: number; alive: boolean; trail: { x: number; y: number }[]; len: number; power: string | null; powerUntil: number; turn: number; kills: number; score: number }[]; gas: Map<number, { id: number; x: number; y: number }>; stopLoop: () => void };
const P = (t: NeonEngine) => t as unknown as Priv;

describe("NEON DRIFT", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("host only; bots fill seats; solo practice allowed", () => {
    const x = arena(0);
    x.t.join("h", "Hana");
    x.t.join("a", "Adam");
    expect(x.t.act("a", { type: "start" }).ok).toBe(false);
    expect(x.t.act("h", { type: "start" }).ok).toBe(true);
    expect(x.meta().phase).toBe("playing");
    const y = arena(3);
    y.t.join("h", "Hana");
    expect(y.t.act("h", { type: "start" }).ok).toBe(true);
    expect(y.meta().players).toHaveLength(4);
    x.t.destroy(); y.t.destroy();
  });

  it("cars move forward, trails follow and are capped at the trail length", () => {
    const x = arena(1);
    x.t.join("h", "Hana");
    x.t.act("h", { type: "start" });
    P(x.t).stopLoop();
    const c = P(x.t).cars[0];
    c.x = 900; c.y = 900; c.a = 0; c.trail = [{ x: 900, y: 900 }];
    const bot = P(x.t).cars[1]; bot.x = 200; bot.y = 200; bot.a = Math.PI / 2; bot.trail = [{ x: 200, y: 200 }];
    for (let i = 0; i < 10; i++) x.t.step();
    expect(c.x).toBeCloseTo(900 + NEON.SPEED * NEON.TICK_MS / 100, 0);
    for (let i = 0; i < 20; i++) { c.a += 0.15; x.t.step(); }
    let total = 0;
    for (let i = 1; i < c.trail.length; i++) total += Math.hypot(c.trail[i].x - c.trail[i - 1].x, c.trail[i].y - c.trail[i - 1].y);
    expect(total).toBeLessThanOrEqual(c.len + 20);
    x.t.destroy();
  });

  it("hitting another car's trail kills you and credits them", () => {
    const x = arena(0);
    x.t.join("h", "Hana"); x.t.join("a", "Adam"); x.t.join("b", "Ben");
    x.t.act("h", { type: "start" });
    P(x.t).stopLoop();
    const [h, a, b] = P(x.t).cars;
    // Hana drives along y=900 from x=600; Adam drives up across her path
    Object.assign(h, { x: 600, y: 900, a: 0, trail: [{ x: 600, y: 900 }], len: 400, power: null });
    Object.assign(a, { x: 760, y: 1000, a: -Math.PI / 2, trail: [{ x: 760, y: 1000 }], power: null });
    Object.assign(b, { x: 200, y: 200, a: Math.PI / 2, trail: [{ x: 200, y: 200 }], power: null });
    for (let i = 0; i < 30; i++) { a.y = 1000; a.x = 760; a.trail = [{ x: 760, y: 1000 }]; x.t.step(); } // hold Adam back while Hana passes
    expect(h.alive).toBe(true);
    for (let i = 0; i < 40 && a.alive; i++) x.t.step();
    expect(a.alive).toBe(false);
    expect(h.kills).toBe(1);
    expect(x.meta().feed.some((f) => f.text.includes("took out Adam"))).toBe(true);
    x.t.destroy();
  });

  it("walls kill; shield lets you drive through trails", () => {
    const x = arena(0);
    x.t.join("h", "Hana"); x.t.join("a", "Adam"); x.t.join("b", "Ben");
    x.t.act("h", { type: "start" });
    P(x.t).stopLoop();
    const [h, a, b] = P(x.t).cars;
    Object.assign(h, { x: 600, y: 900, a: 0, trail: [{ x: 600, y: 900 }], len: 600, power: null });
    Object.assign(a, { x: 700, y: 1000, a: -Math.PI / 2, trail: [{ x: 700, y: 1000 }], power: "shield", powerUntil: Date.now() + 5000 });
    Object.assign(b, { x: 30, y: 600, a: Math.PI, trail: [{ x: 30, y: 600 }], power: null });
    for (let i = 0; i < 14; i++) { a.x = 700; a.y = 1000; a.trail = [{ x: 700, y: 1000 }]; x.t.step(); }
    for (let i = 0; i < 20; i++) x.t.step();
    expect(b.alive).toBe(false); // wall
    expect(a.alive).toBe(true); // shielded through Hana's trail
    x.t.destroy();
  });

  it("gas makes the trail longer; a crash drops gas; crashed cars respawn (no rounds)", () => {
    const x = arena(0);
    x.t.join("h", "Hana"); x.t.join("a", "Adam");
    x.t.act("h", { type: "start" });
    P(x.t).stopLoop();
    const [h, a] = P(x.t).cars;
    Object.assign(h, { x: 600, y: 600, a: 0, trail: [{ x: 600, y: 600 }], power: null, turn: 1 });
    Object.assign(a, { x: 300, y: 1500, a: 0, trail: [{ x: 300, y: 1500 }], power: null });
    const before = h.len;
    P(x.t).gas.set(99999, { id: 99999, x: 615, y: 600 });
    x.t.step(); x.t.step();
    expect(h.len).toBe(before + NEON.GAS_LEN);
    const gasBefore = P(x.t).gas.size;
    for (let i = 0; i < 300 && a.alive; i++) x.t.step(); // Adam drives into the right wall
    expect(a.alive).toBe(false);
    expect(P(x.t).gas.size).toBeGreaterThan(gasBefore);
    expect(x.meta().phase).toBe("playing"); // game keeps going
    expect(x.snap().cars.find((c) => c.id === "a")!.respawnMs).toBeGreaterThan(0);
    vi.advanceTimersByTime(NEON.RESPAWN_MS + 100);
    x.t.step();
    expect(a.alive).toBe(true);
    expect(a.power).toBe("shield"); // spawn protection
    x.t.destroy();
  });

  it("your own trail is safe to cross", () => {
    const x = arena(0);
    x.t.join("h", "Hana"); x.t.join("a", "Adam");
    x.t.act("h", { type: "start" });
    P(x.t).stopLoop();
    const [h, a] = P(x.t).cars;
    Object.assign(h, { x: 900, y: 900, a: 0, trail: [{ x: 900, y: 900 }], len: 2000, power: null, turn: 1 });
    Object.assign(a, { x: 200, y: 1600, a: Math.PI / 2 * 3, trail: [{ x: 200, y: 1600 }], power: null });
    for (let i = 0; i < 200; i++) { a.x = 200; a.y = 1600; a.trail = [{ x: 200, y: 1600 }]; x.t.step(); } // Hana loops over her own trail many times
    expect(h.alive).toBe(true);
    x.t.destroy();
  });

  it("bots drive, crash and respawn for minutes without the loop breaking", () => {
    const x = arena(5, 3);
    x.t.join("h", "Hana");
    x.t.act("h", { type: "start" });
    vi.advanceTimersByTime(120_000);
    expect(x.meta().phase).toBe("playing");
    expect(x.snaps.some((s) => s.trails)).toBe(true);
    expect(x.meta().feed.length).toBeGreaterThan(0);
    x.t.destroy();
  });

  it("only the nose crashes: side-by-side and head-on bumps are safe; boosting can't skip through a trail", () => {
    const x = arena(0);
    x.t.join("h", "Hana"); x.t.join("a", "Adam"); x.t.join("b", "Ben");
    x.t.act("h", { type: "start" });
    P(x.t).stopLoop();
    const [h, a, b] = P(x.t).cars;
    // Hana and Adam drive side by side, 14 units apart (their bodies/trails brush) — nobody dies
    Object.assign(h, { x: 400, y: 600, a: 0, trail: [{ x: 400, y: 600 }], power: null, turn: 0, aim: null });
    Object.assign(a, { x: 400, y: 614, a: 0, trail: [{ x: 400, y: 614 }], power: null, turn: 0, aim: null });
    Object.assign(b, { x: 300, y: 1500, a: -Math.PI / 2, trail: [{ x: 300, y: 1500 }], power: null, turn: 0, aim: null });
    for (let i = 0; i < 40; i++) x.t.step();
    expect(h.alive && a.alive).toBe(true);
    // head-on: Ben drives straight at Hana's car — cars passing through each other don't crash…
    Object.assign(h, { x: 900, y: 1200, a: 0, trail: [{ x: 900, y: 1200 }] });
    Object.assign(b, { x: 1060, y: 1200, a: Math.PI, trail: [{ x: 1060, y: 1200 }] });
    for (let i = 0; i < 8; i++) x.t.step();
    expect(h.alive).toBe(true);
    // …but once Ben's nose is past Hana's nose, he is driving into her trail
    for (let i = 0; i < 6; i++) x.t.step();
    expect(b.alive).toBe(false);
    expect(h.kills).toBe(1);
    x.t.destroy();
  });

  it("a boosting car cannot tunnel through a thin trail between ticks", () => {
    const x = arena(0);
    x.t.join("h", "Hana"); x.t.join("a", "Adam");
    x.t.act("h", { type: "start" });
    P(x.t).stopLoop();
    const [h, a] = P(x.t).cars;
    // a vertical wall of Hana's trail at x=1000
    Object.assign(h, { x: 1000, y: 1500, a: Math.PI / 2, trail: [{ x: 1000, y: 300 }, { x: 1000, y: 1500 }], len: 4000, power: null });
    // Adam crosses it at boost+turbo speed (≈21 units per tick — wider than the trail)
    Object.assign(a, { x: 960, y: 900, a: 0, trail: [{ x: 960, y: 900 }], power: "turbo", powerUntil: Date.now() + 5000, boost: true, fuel: 1, aim: null, turn: 0 });
    for (let i = 0; i < 6 && a.alive; i++) x.t.step();
    expect(a.alive).toBe(false);
    x.t.destroy();
  });
});
