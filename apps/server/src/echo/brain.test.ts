import { describe, it, expect } from "vitest";
import { mulberry32 } from "@monumental/shared";
import { CopyBrain } from "./brain";

const look = (k: number) => ({ yaw: Array.from({ length: 40 }, (_, i) => Math.sin(i / 6 + k) * 0.5), pitch: Array.from({ length: 40 }, () => -0.1) });

describe("v40 the Copy's long memory", () => {
  it("learns moves from matches and makes new variations of them", () => {
    const rnd = mulberry32(3), b = new CopyBrain();
    expect(b.move("look", rnd)).toBe(null);
    b.learnMatch({ looks: Array.from({ length: 20 }, (_, i) => look(i)), stops: [], speeds: Array.from({ length: 300 }, () => 1.8 + rnd() * 0.6), stopCount: 5, meters: 120 }, rnd);
    expect(b.stats).toEqual({ matches: 1, moves: 20 });
    const lens = new Set<number>();
    let stitched = 0;
    for (let i = 0; i < 200; i++) { const m = b.move("look", rnd)!; lens.add(m.yaw.length); if (m.ids.length > 1) stitched++; }
    expect(lens.size).toBeGreaterThan(3); // faster/slower/stitched variations, not only the 40-sample originals
    expect(stitched).toBeGreaterThan(10);
    const v = b.speed(rnd)!;
    expect(v).toBeGreaterThan(1.5); expect(v).toBeLessThan(2.6);
  });

  it("moves that fooled people are used more; good stitched moves are saved as new moves", () => {
    const rnd = mulberry32(9), b = new CopyBrain();
    b.learnMatch({ looks: Array.from({ length: 20 }, (_, i) => look(i)), stops: [], speeds: [], stopCount: 0, meters: 0 }, rnd);
    const first = b.move("look", rnd)!;
    for (let i = 0; i < 15; i++) b.credit([first.ids[0]], 1, null, rnd);
    let hits = 0;
    for (let i = 0; i < 300; i++) if (b.move("look", rnd)!.ids.includes(first.ids[0])) hits++;
    expect(hits).toBeGreaterThan(80); // ~16x the weight of each of the other 19
    b.credit([1, 2], 1, { k: "look", yaw: look(1).yaw, pitch: look(1).pitch }, rnd);
    expect(b.stats.moves).toBe(21);
  });

  it("tricks that work get chosen more (Thompson sampling)", () => {
    const rnd = mulberry32(5), b = new CopyBrain();
    for (let i = 0; i < 60; i++) { b.score("attackAt", "2.4", 1); b.score("attackAt", "3.2", 0); b.score("attackAt", "4.0", 0.1); }
    const n: Record<string, number> = {};
    for (let i = 0; i < 200; i++) { const a = b.choose("attackAt", rnd); n[a] = (n[a] ?? 0) + 1; }
    expect(n["2.4"]).toBeGreaterThan(180);
  });

  it("survives a restart through the database row", async () => {
    const rows = new Map<string, string>();
    const db = {
      $executeRawUnsafe: async (q: string, ...v: unknown[]) => { if (q.startsWith("INSERT")) rows.set("copy", v[0] as string); },
      $queryRawUnsafe: async () => (rows.has("copy") ? [{ data: JSON.parse(rows.get("copy")!) }] : []),
    };
    const rnd = mulberry32(1), a = new CopyBrain();
    await a.load(db);
    a.learnMatch({ looks: [look(1), look(2)], stops: [], speeds: [], stopCount: 0, meters: 0 }, rnd);
    a.score("talk", "chatty", 1);
    await a.save();
    const b = new CopyBrain();
    await b.load(db);
    expect(b.stats).toEqual({ matches: 1, moves: 2 });
    expect(b.arms()["talk:chatty"].w).toBeGreaterThan(0.9);
  });
});
