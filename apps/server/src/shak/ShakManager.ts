import type { IO } from "../room/RoomManager.js";
import { ShakEngine } from "./ShakEngine.js";
import type { ShakSettings } from "@monumental/shared";

/** All أشك tables in this process. Socket rooms: `shak:<code>`; private hands go to `player:<id>`. */
export class ShakManager {
  tables = new Map<string, ShakEngine>();
  constructor(private io: IO) {}

  create(hostId: string, settings: ShakSettings) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    do { code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join(""); } while (this.tables.has(code));
    const t = new ShakEngine(code, hostId, settings, {
      broadcast: (s) => this.io.to(`shak:${code}`).emit("shak_state", s),
      sendHand: (id, tiles) => { if (!id.startsWith("bot:")) this.io.to(`player:${id}`).emit("shak_hand", { code, tiles }); },
      onIdle: () => this.destroy(code),
    });
    this.tables.set(code, t);
    return t;
  }

  get(code: string) { return this.tables.get(code.toUpperCase()); }

  destroy(code: string) {
    const t = this.tables.get(code);
    if (!t) return;
    t.destroy();
    this.tables.delete(code);
    this.io.in(`shak:${code}`).socketsLeave(`shak:${code}`);
  }
}
