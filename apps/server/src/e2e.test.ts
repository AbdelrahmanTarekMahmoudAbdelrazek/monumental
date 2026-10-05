import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { io as ioc, type Socket } from "socket.io-client";
import type { AddressInfo } from "node:net";
import { createServer } from "./index";
import { LOBBY_SECONDS, getMonument } from "@monumental/shared";

let url = "";
let close: () => Promise<void>;

beforeAll(async () => {
  const s = await createServer();
  await new Promise<void>((r) => s.httpServer.listen(0, r));
  url = `http://localhost:${(s.httpServer.address() as AddressInfo).port}`;
  close = async () => { s.io.close(); await s.store.close(); };
});
afterAll(async () => close());

function connect() {
  return ioc(url, { transports: ["websocket"], forceNew: true }) as Socket;
}
function join(sock: Socket, nickname: string, levelId = 1) {
  return new Promise<any>((res) => sock.emit("join_room", { levelId, nickname, guestId: `guest_${nickname}_12345` }, res));
}
function once<T = any>(sock: Socket, ev: string) {
  return new Promise<T>((res) => sock.once(ev, res));
}

describe("socket e2e", () => {
  it("two clients play a round in the same room and get server-scored results", async () => {
    const a = connect();
    const b = connect();
    const ja = await join(a, "Ann");
    expect(ja.ok).toBe(true);
    expect(ja.state.phase).toBe("lobby");
    const jb = await join(b, "Ben");
    expect(jb.ok).toBe(true);
    expect(jb.state.players.map((p: any) => p.nickname).sort()).toEqual(["Ann", "Ben"]);

    // health + rooms overview
    const health = await fetch(`${url}/health`).then((r) => r.json());
    expect(health.ok).toBe(true);
    const overview = await fetch(`${url}/rooms`).then((r) => r.json());
    expect(overview.levels.find((l: any) => l.levelId === 1).players).toBe(2);

    const rs = await once(a, "round_start");
    expect(rs.levelId).toBe(1);
    const real = (getMonument(rs.targetId).heightM / getMonument(rs.baseId).heightM) * 100;

    const lockedPromise = once(b, "player_locked");
    const ackA = await new Promise<any>((r) => a.emit("submit_guess", { roundId: rs.roundId, guessPct: real * 1.02, lock: true }, r));
    expect(ackA.ok).toBe(true);
    const locked = await lockedPromise;
    expect(locked.playerId).toBe("guest:guest_Ann_12345");

    // Ben drags without locking — last position counts
    await new Promise<any>((r) => b.emit("submit_guess", { roundId: rs.roundId, guessPct: real * 1.5, lock: false }, r));

    const result = await once(b, "round_result");
    const ann = result.entries.find((e: any) => e.nickname === "Ann");
    const ben = result.entries.find((e: any) => e.nickname === "Ben");
    expect(ann.points).toBe(3);
    expect(ben.points).toBe(1);
    expect(ben.guessPct).toBeCloseTo(real * 1.5, 0);
    expect(result.leaderboard[0].nickname).toBe("Ann");

    a.close(); b.close();
  }, 60_000);

  it("rejects bad payloads and unknown rooms", async () => {
    const c = connect();
    const r1 = await new Promise<any>((r) => c.emit("join_room", { roomId: "t:nope:final", nickname: "X", guestId: "guest_x_12345" }, r));
    expect(r1.ok).toBe(false);
    const r2 = await new Promise<any>((r) => c.emit("join_room", { levelId: 1, nickname: "X" }, r)); // no guestId
    expect(r2.ok).toBe(false);
    const r3 = await new Promise<any>((r) => c.emit("join_room", { roomId: "p:ABCD:2", nickname: "Friend", guestId: "guest_f_12345" }, r));
    expect(r3.ok).toBe(true);
    expect(r3.state.roomId).toBe("p:ABCD:2");
    expect(r3.state.levelId).toBe(2);
    c.close();
  });
});

describe("custom host rooms", () => {
  it("host creates a room, guests join via link, only the host can start, settings apply", async () => {
    const host = connect();
    const guest = connect();
    const created = await new Promise<any>((r) =>
      host.emit("create_room", { settings: { kind: "duel", duelCats: ["area"], timerSec: 5, rounds: 2, revealSec: 3, name: "Friday quiz" }, nickname: "Hosty", guestId: "guest_host_12345" }, r),
    );
    expect(created.ok).toBe(true);
    expect(created.roomId).toMatch(/^c:[A-Z0-9]{6}$/);

    const jh = await new Promise<any>((r) => host.emit("join_room", { roomId: created.roomId, nickname: "Hosty", guestId: "guest_host_12345" }, r));
    expect(jh.ok).toBe(true);
    expect(jh.state.custom.waiting).toBe(true);
    expect(jh.state.custom.hostId).toBe("guest:guest_host_12345");
    expect(jh.state.custom.level.timerSec).toBe(5);
    expect(jh.state.custom.level.name).toBe("Friday quiz");

    const jg = await new Promise<any>((r) => guest.emit("join_room", { roomId: created.roomId, nickname: "Gus", guestId: "guest_gus_12345" }, r));
    expect(jg.ok).toBe(true);
    // it does NOT auto-start
    await new Promise((r) => setTimeout(r, 1500));
    // guest can't start or change settings
    expect((await new Promise<any>((r) => guest.emit("host_start", r))).ok).toBe(false);
    expect((await new Promise<any>((r) => guest.emit("host_update", { settings: { rounds: 9 } }, r))).ok).toBe(false);
    // host changes settings while waiting
    const upd = await new Promise<any>((r) => host.emit("host_update", { settings: { kind: "duel", duelCats: ["rivers"], timerSec: 5, rounds: 1, revealSec: 3 } }, r));
    expect(upd.ok).toBe(true);
    const roundStart = once<any>(guest, "round_start");
    expect((await new Promise<any>((r) => host.emit("host_start", r))).ok).toBe(true);
    const rs = await roundStart;
    expect(rs.kind).toBe("duel");
    expect(rs.baseId.startsWith("rivers:")).toBe(true);
    expect(rs.timerSec).toBe(5);
    // after the single round, session ends and the room waits again (no auto restart)
    const end = await once<any>(guest, "session_end");
    expect(end.levelId).toBe(25);
    await new Promise((r) => setTimeout(r, 300));
    const st = await new Promise<any>((r) => guest.emit("join_room", { roomId: created.roomId, nickname: "Gus", guestId: "guest_gus_12345" }, r));
    expect(st.state.phase).toBe("finished");
    expect(st.state.custom.waiting).toBe(true);
    host.close(); guest.close();
  }, 60_000);

  it("unknown custom room codes are rejected", async () => {
    const c = connect();
    const r = await new Promise<any>((res) => c.emit("join_room", { roomId: "c:NOPE99", nickname: "X", guestId: "guest_x_12345" }, res));
    expect(r.ok).toBe(false);
    c.close();
  });
});
