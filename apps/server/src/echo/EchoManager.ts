import type { IO } from "../room/RoomManager.js";
import { EchoRoom } from "./EchoRoom.js";

/** All ECHO HALLS rooms. Socket rooms: `eh:<code>` for everyone, `eh:<code>:<n>` for one player. */
export class EchoManager {
  rooms = new Map<string, EchoRoom>();
  constructor(private io: IO) {}

  create(hostId: string) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    do { code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join(""); } while (this.rooms.has(code));
    const room = `eh:${code}`;
    const r = new EchoRoom(code, hostId, {
      meta: (m) => this.io.to(room).emit("eh_meta", m),
      snap: (s) => this.io.to(room).volatile.emit("eh_snap", s),
      event: (e) => this.io.to(room).emit("eh_event", e),
      onIdle: () => this.destroy(code),
    });
    const wake = Number(process.env.ECHO_WAKE_SEC);
    if (Number.isFinite(wake) && wake > 0) r.wakeSec = wake;
    const match = Number(process.env.ECHO_MATCH_SEC);
    if (Number.isFinite(match) && match > 0) r.matchSec = match;
    this.rooms.set(code, r);
    return r;
  }

  get(code: string) { return this.rooms.get(code.toUpperCase()); }

  /** Pass voice set-up messages between two players of the same room. */
  relay(code: string, fromN: number, toN: number, data: unknown) {
    this.io.to(`eh:${code}:${toN}`).emit("eh_signal", { from: fromN, data });
  }

  destroy(code: string) {
    const r = this.rooms.get(code);
    if (!r) return;
    r.destroy();
    this.rooms.delete(code);
    this.io.in(`eh:${code}`).socketsLeave(`eh:${code}`);
  }
}
