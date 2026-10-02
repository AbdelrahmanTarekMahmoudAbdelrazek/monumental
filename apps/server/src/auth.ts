import { jwtVerify } from "jose";
import { config } from "./config.js";
import type { JoinRoomPayload } from "@monumental/shared";

export interface Identity {
  /** "user:<id>" | "guest:<id>" */
  playerKey: string;
  userId: string | null;
  nickname: string;
  isGuest: boolean;
}

const NICK_RE = /^[\p{L}\p{N} _\-.]{2,20}$/u;

export function cleanNickname(raw: unknown, fallback = "Guest"): string {
  if (typeof raw !== "string") return fallback;
  const s = raw.trim().replace(/\s+/g, " ");
  return NICK_RE.test(s) ? s : fallback;
}

/**
 * Resolve the identity for a join request.
 *  - signed-in users present a short-lived HS256 token minted by the web app
 *    (/api/socket-token) — the server never trusts a bare userId.
 *  - guests present a client-generated guestId (uuid-ish) and a nickname.
 */
export async function resolveIdentity(p: JoinRoomPayload): Promise<Identity> {
  if (p.userToken) {
    try {
      const { payload } = await jwtVerify(p.userToken, new TextEncoder().encode(config.socketJwtSecret), {
        algorithms: ["HS256"],
      });
      const sub = String(payload.sub ?? "");
      if (sub) {
        return {
          playerKey: `user:${sub}`,
          userId: sub,
          nickname: cleanNickname(payload.nickname ?? p.nickname, "Player"),
          isGuest: false,
        };
      }
    } catch {
      /* fall through to guest */
    }
  }
  const gid = typeof p.guestId === "string" && /^[a-zA-Z0-9_-]{8,64}$/.test(p.guestId) ? p.guestId : null;
  if (!gid) throw new Error("Missing guestId");
  return { playerKey: `guest:${gid}`, userId: null, nickname: cleanNickname(p.nickname), isGuest: true };
}
