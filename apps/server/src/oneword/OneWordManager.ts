import type { IO } from "../room/RoomManager.js";
import { OneWordEngine } from "./OneWordEngine.js";
import type { OwSettings } from "@monumental/shared";

/** All ONE WORD tables. Socket rooms: `ow:<code>`; the secret key goes to `player:<id>`. */
export class OneWordManager {
  tables = new Map<string, OneWordEngine>();
  constructor(private io: IO) {}

  create(hostId: string, settings: OwSettings) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    do { code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join(""); } while (this.tables.has(code));
    const t = new OneWordEngine(code, hostId, settings, {
      broadcast: (s) => this.io.to(`ow:${code}`).emit("ow_state", s),
      sendKey: (id, key) => this.io.to(`player:${id}`).emit("ow_key", { code, key }),
      sendChat: (id, team, msgs) => this.io.to(`player:${id}`).emit("ow_chat", { code, team, msgs }),
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
    this.io.in(`ow:${code}`).socketsLeave(`ow:${code}`);
  }
}
