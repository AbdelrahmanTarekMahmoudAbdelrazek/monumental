import { describe, it, expect, vi, afterEach } from "vitest";
import { ECHO, ECHO_MAP, ECHO_W, echoFree, echoSpawns, echoWallsBetween, decodeEchoSnap, type EchoMeta, type EchoSnap } from "@monumental/shared";
import { EchoRoom } from "./EchoRoom";

function room() {
  let t = 1_000_000;
  const metas: EchoMeta[] = [];
  const snaps: EchoSnap[] = [];
  const r = new EchoRoom("TEST1", "a", { meta: (m) => metas.push(m), snap: (s) => snaps.push(s), onIdle: () => {} }, () => t);
  return { r, metas, snaps, advance: (ms: number) => { t += ms; } };
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
