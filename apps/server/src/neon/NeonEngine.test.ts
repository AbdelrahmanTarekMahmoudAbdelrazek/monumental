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

  it("needs 2 cars; host only; bots fill seats", () => {
    const x = arena(0);
    x.t.join("h", "Hana");
    expect(x.t.act("h", { type: "start" }).ok).toBe(false);
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
    expect(c.x).toBeCloseTo(900 + NEON.SPEED * 0.5, 0);
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
    Object.assign(h, { x: 600, y: 900, a: 0, trail: [{ x: 600, y: 900 }], len: 400 });
    Object.assign(a, { x: 760, y: 1000, a: -Math.PI / 2, trail: [{ x: 760, y: 1000 }] });
    Object.assign(b, { x: 200, y: 200, a: Math.PI / 2, trail: [{ x: 200, y: 200 }] });
    for (let i = 0; i < 6; i++) { a.y = 1000; a.x = 760; a.trail = [{ x: 760, y: 1000 }]; x.t.step(); } // hold Adam back while Hana passes
    expect(h.alive).toBe(true);
    for (let i = 0; i < 20 && a.alive; i++) x.t.step();
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
    Object.assign(h, { x: 600, y: 900, a: 0, trail: [{ x: 600, y: 900 }], len: 600 });
    Object.assign(a, { x: 700, y: 1000, a: -Math.PI / 2, trail: [{ x: 700, y: 1000 }], power: "shield", powerUntil: Date.now() + 5000 });
    Object.assign(b, { x: 30, y: 600, a: Math.PI, trail: [{ x: 30, y: 600 }] });
    for (let i = 0; i < 8; i++) { a.x = 700; a.y = 1000; a.trail = [{ x: 700, y: 1000 }]; x.t.step(); }
    for (let i = 0; i < 20; i++) x.t.step();
    expect(b.alive).toBe(false); // wall
    expect(a.alive).toBe(true); // shielded through Hana's trail
    x.t.destroy();
  });

  it("gas makes the trail longer; a crash drops gas", () => {
    const x = arena(0);
    x.t.join("h", "Hana"); x.t.join("a", "Adam");
    x.t.act("h", { type: "start" });
    P(x.t).stopLoop();
    const [h, a] = P(x.t).cars;
    Object.assign(h, { x: 600, y: 600, a: 0, trail: [{ x: 600, y: 600 }] });
    Object.assign(a, { x: 300, y: 1500, a: 0, trail: [{ x: 300, y: 1500 }] });
    const before = h.len;
    P(x.t).gas.set(99999, { id: 99999, x: 620, y: 600 });
    x.t.step(); x.t.step();
    expect(h.len).toBe(before + NEON.GAS_LEN);
    h.turn = 1; // Hana circles safely
    const gasBefore = P(x.t).gas.size;
    for (let i = 0; i < 200 && a.alive; i++) x.t.step(); // Adam drives into the right wall
    expect(a.alive).toBe(false);
    expect(P(x.t).gas.size).toBeGreaterThan(gasBefore);
    expect(x.meta().phase).toBe("roundover");
    expect(x.meta().winnerId).toBe("h");
    x.t.destroy();
  });

  it("bot-only rounds keep cycling through rounds", () => {
    const x = arena(5, 3);
    x.t.join("h", "Hana");
    x.t.act("h", { type: "start" });
    vi.advanceTimersByTime(120_000);
    expect(x.meta().round).toBeGreaterThan(1);
    expect(x.snaps.some((s) => s.trails)).toBe(true);
    x.t.destroy();
  });
});
