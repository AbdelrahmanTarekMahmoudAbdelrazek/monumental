import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mulberry32, SQ, SQ_ROLES, sqMove, segRect, type SqMeta, type SqSnap, type SqInput } from "@monumental/shared";
import { SquadEngine } from "./SquadEngine";

function room(teamSize = 1, seed = 1) {
  const metas: SqMeta[] = [];
  const snaps: SqSnap[] = [];
  const t = new SquadEngine("TEST1", "h", { target: 5, minutes: 6, teamSize }, {
    meta: (m) => metas.push(JSON.parse(JSON.stringify(m))),
    snap: (s) => snaps.push(s),
    onIdle: () => {},
  }, () => Date.now(), mulberry32(seed));
  return { t, metas, snaps, meta: () => metas[metas.length - 1], snap: () => snaps[snaps.length - 1] };
}
type U = { id: string; x: number; y: number; aim: number; team: string; role: string; life: string; hp: number; rev: number; bubble: number; input: SqInput; actUntil: number; lifeAt: number; isBot: boolean };
const P = (t: SquadEngine) => t as unknown as { units: U[]; stopLoop: () => void; score: Record<string, number>; bullets: unknown[] };
/** Advance the clock one tick and simulate it. */
const tick = (t: SquadEngine, n = 1) => { for (let i = 0; i < n; i++) { vi.advanceTimersByTime(SQ.TICK_MS); t.step(); } };
const inp = (o: Partial<SqInput> = {}): SqInput => ({ mx: 0, my: 0, aim: 0, fire: false, ability: false, revive: false, reload: false, seq: 0, ...o });

/** Two humans + chosen roles, placed in open floor facing each other. */
function duel(roleA: "healer" | "tank" | "fighter", roleB: "healer" | "tank" | "fighter", gap = 300) {
  const x = room(1);
  x.t.join("h", "Hana"); x.t.join("b", "Ben");
  x.t.act("h", { type: "role", role: roleA });
  x.t.act("b", { type: "role", role: roleB });
  expect(x.t.act("h", { type: "start" }).ok).toBe(true);
  P(x.t).stopLoop();
  const [h, b] = P(x.t).units;
  Object.assign(h, { x: 1200 - gap / 2, y: 990, aim: 0, bubble: 0 });
  Object.assign(b, { x: 1200 + gap / 2, y: 990, aim: Math.PI, bubble: 0 });
  return { ...x, h, b };
}

describe("SQUAD RUSH geometry", () => {
  it("movement slides along walls and stays in the map", () => {
    const [x, y] = sqMove(5, 5, -50, -50);
    expect(x).toBe(SQ.R); expect(y).toBe(SQ.R);
    expect(segRect(0, 0, 100, 0, { x: 40, y: -5, w: 10, h: 10 })).toBeCloseTo(0.4);
    expect(segRect(0, 20, 100, 20, { x: 40, y: -5, w: 10, h: 10 })).toBe(-1);
  });
});

describe("SQUAD RUSH rules", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("teams get filled with bots up to the team size; host only", () => {
    const x = room(3);
    x.t.join("h", "Hana"); x.t.join("a", "Adam");
    expect(x.t.act("a", { type: "start" }).ok).toBe(false);
    expect(x.t.act("h", { type: "start" }).ok).toBe(true);
    const units = P(x.t).units;
    expect(units.filter((u) => u.team === "red")).toHaveLength(3);
    expect(units.filter((u) => u.team === "blue")).toHaveLength(3);
    expect(units.every((u) => u.life === "alive")).toBe(true);
    x.t.destroy();
  });

  it("bullets hit, knock down at 0 HP, then a teammate revives (healer 1s, others 3s)", () => {
    const x = duel("fighter", "fighter");
    // give Ben a healer teammate standing next to him
    const units = P(x.t).units;
    x.t.join("m", "Mia");
    const mia = P(x.t).units.find((u) => u.id === "m")!;
    Object.assign(mia, { team: "blue", role: "healer", life: "alive", hp: 100, x: x.b.x + 30, y: x.b.y + 60, bubble: 0 });
    x.h.input = inp({ aim: 0, fire: true });
    let guard = 0;
    while (x.b.life === "alive" && guard++ < 200) tick(x.t);
    expect(x.b.life).toBe("down");
    expect(x.meta().feed.some((f) => f.verb === "knocked down")).toBe(true);
    x.h.input = inp(); // stop shooting
    mia.input = inp({ revive: true });
    const steps = Math.ceil(SQ_ROLES.healer.reviveMs / SQ.TICK_MS) + 1;
    for (let i = 0; i < steps; i++) tick(x.t);
    expect(x.b.life).toBe("alive");
    expect(x.b.hp).toBe(Math.round(SQ_ROLES.fighter.hp * SQ.REVIVE_HP));
    expect(units.length).toBeGreaterThan(0);
    x.t.destroy();
  });

  it("shooting a downed enemy eliminates them and scores; reaching the target ends the match", () => {
    const x = duel("fighter", "healer");
    P(x.t).units.push(); // no teammates for Ben → a knock with no one standing is an instant elimination
    x.h.input = inp({ aim: 0, fire: true });
    let guard = 0;
    while (x.b.life !== "dead" && guard++ < 300) tick(x.t);
    expect(x.b.life).toBe("dead");
    expect(P(x.t).score.red).toBe(1);
    // respawn after 5s
    vi.advanceTimersByTime(SQ.RESPAWN_MS + 50);
    tick(x.t);
    expect(x.b.life).toBe("alive");
    x.t.destroy();
  });

  it("walls stop bullets", () => {
    const x = duel("fighter", "fighter");
    // a crate sits between them
    Object.assign(x.h, { x: 1100, y: 680 });
    Object.assign(x.b, { x: 1300, y: 680 });
    x.h.input = inp({ aim: 0, fire: true });
    for (let i = 0; i < 40; i++) tick(x.t);
    expect(x.b.hp).toBe(SQ_ROLES.fighter.hp);
    expect(x.snaps.some((s) => s.stops?.some((v, i) => i % 4 === 3 && v === 0))).toBe(true);
    x.t.destroy();
  });

  it("a tank's shield wall blocks bullets from the front, not from behind", () => {
    const x = duel("fighter", "tank");
    x.b.input = inp({ aim: Math.PI, ability: true });
    tick(x.t);
    x.b.input = inp({ aim: Math.PI });
    x.h.input = inp({ aim: 0, fire: true });
    for (let i = 0; i < 30; i++) tick(x.t);
    expect(x.b.hp).toBe(SQ_ROLES.tank.hp);
    expect(x.snaps.some((s) => s.stops?.some((v, i) => i % 4 === 3 && v === 2))).toBe(true);
    // turn his back: bullets go through
    x.b.input = inp({ aim: 0 });
    for (let i = 0; i < 20; i++) tick(x.t);
    expect(x.b.hp).toBeLessThan(SQ_ROLES.tank.hp);
    x.t.destroy();
  });

  it("bubble shield absorbs hits", () => {
    const x = duel("healer", "fighter");
    x.b.bubble = 3;
    x.h.input = inp({ aim: 0, fire: true });
    for (let i = 0; i < 25; i++) tick(x.t); // ~3 pistol shots
    expect(x.b.hp).toBe(SQ_ROLES.fighter.hp);
    x.t.destroy();
  });

  it("an all-bot match keeps playing and someone scores", () => {
    const x = room(4, 7);
    x.t.join("h", "Hana");
    x.t.act("h", { type: "start" });
    const h = P(x.t).units.find((u) => u.id === "h")!;
    h.input = inp();
    vi.advanceTimersByTime(150_000);
    const m = x.meta();
    expect(m.score.red + m.score.blue).toBeGreaterThan(0);
    expect(m.feed.length).toBeGreaterThan(0);
    x.t.destroy();
  });
});
