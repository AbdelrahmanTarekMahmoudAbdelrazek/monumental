import type { IO } from "../room/RoomManager.js";
import { SquadEngine } from "./SquadEngine.js";
import type { SqSettings } from "@monumental/shared";

/** All SQUAD RUSH rooms. Socket rooms: `sq:<code>`. */
export class SquadManager {
  rooms = new Map<string, SquadEngine>();
  constructor(private io: IO) {}

  create(hostId: string, settings: SqSettings) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    do { code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join(""); } while (this.rooms.has(code));
    const room = `sq:${code}`;
    const t = new SquadEngine(code, hostId, settings, {
      meta: (m) => this.io.to(room).emit("sq_meta", m),
      snap: (s) => this.io.to(room).volatile.emit("sq_snap", s),
      onIdle: () => this.destroy(code),
    });
    this.rooms.set(code, t);
    return t;
  }

  get(code: string) { return this.rooms.get(code.toUpperCase()); }

  destroy(code: string) {
    const t = this.rooms.get(code);
    if (!t) return;
    t.destroy();
    this.rooms.delete(code);
    this.io.in(`sq:${code}`).socketsLeave(`sq:${code}`);
  }
}
