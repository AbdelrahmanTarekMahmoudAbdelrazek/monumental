import type { IO } from "../room/RoomManager.js";
import { NeonEngine } from "./NeonEngine.js";
import type { NeonSettings } from "@monumental/shared";

/** All NEON DRIFT arenas. Socket rooms: `nd:<code>`. */
export class NeonManager {
  arenas = new Map<string, NeonEngine>();
  constructor(private io: IO) {}

  create(hostId: string, settings: NeonSettings) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    do { code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join(""); } while (this.arenas.has(code));
    const room = `nd:${code}`;
    const t = new NeonEngine(code, hostId, settings, {
      meta: (m) => this.io.to(room).emit("nd_meta", m),
      // snapshots are high-frequency and disposable: volatile = drop instead of buffering for slow clients
      snap: (s) => this.io.to(room).volatile.emit("nd_snap", s),
      onIdle: () => this.destroy(code),
    });
    this.arenas.set(code, t);
    return t;
  }

  get(code: string) { return this.arenas.get(code.toUpperCase()); }

  destroy(code: string) {
    const t = this.arenas.get(code);
    if (!t) return;
    t.destroy();
    this.arenas.delete(code);
    this.io.in(`nd:${code}`).socketsLeave(`nd:${code}`);
  }
}
