import type { IO } from "../room/RoomManager.js";
import { SmuggleEngine } from "./SmuggleEngine.js";
import type { SmuggleSettings } from "@monumental/shared";

/** All SMUGGLERS tables. Socket rooms: `sm:<code>`; secret words go to `player:<id>`. */
export class SmuggleManager {
  tables = new Map<string, SmuggleEngine>();
  constructor(private io: IO) {}

  create(hostId: string, settings: SmuggleSettings) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    do { code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join(""); } while (this.tables.has(code));
    const t = new SmuggleEngine(code, hostId, settings, {
      broadcast: (s) => this.io.to(`sm:${code}`).emit("sm_state", s),
      sendSecret: (id, words) => this.io.to(`player:${id}`).emit("sm_secret", { code, words }),
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
    this.io.in(`sm:${code}`).socketsLeave(`sm:${code}`);
  }
}
