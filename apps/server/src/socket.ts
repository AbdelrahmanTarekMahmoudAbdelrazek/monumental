import type { Socket } from "socket.io";
import { z } from "zod";
import type { ClientToServerEvents, ServerToClientEvents } from "@monumental/shared";
import { resolveIdentity, type Identity } from "./auth.js";
import type { RoomManager, IO } from "./room/RoomManager.js";
import type { LiveStore } from "./store.js";

type Sock = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { identity?: Identity; roomId?: string }>;

const joinSchema = z.object({
  roomId: z.string().max(64).optional(),
  levelId: z.number().int().min(1).max(50).optional(),
  nickname: z.string().max(40).default("Guest"),
  guestId: z.string().max(64).optional(),
  userToken: z.string().max(2048).optional(),
  inviteCode: z.string().max(32).optional(),
});

const guessSchema = z.object({
  roundId: z.string().max(32),
  guessPct: z.number().finite().optional(),
  pick: z.enum(["a", "b"]).optional(),
  lock: z.boolean().default(false),
});

export function registerSocketHandlers(io: IO, rooms: RoomManager, store: LiveStore) {
  io.on("connection", (socket: Sock) => {
    // naive per-socket rate limit for guesses (drag streams are throttled client-side to ~10/s)
    let guessBudget = 40;
    const refill = setInterval(() => { guessBudget = Math.min(40, guessBudget + 20); }, 1000);

    socket.on("ping_time", (p, ack) => ack({ t0: Number(p?.t0 ?? 0), t1: Date.now() }));

    socket.on("join_room", async (raw, ack) => {
      try {
        const p = joinSchema.parse(raw);
        const identity = await resolveIdentity(p);

        // leave previous room (one room per socket)
        if (socket.data.roomId && socket.data.identity) {
          rooms.get(socket.data.roomId)?.leave(socket.data.identity.playerKey);
          socket.leave(socket.data.roomId);
        }

        const engine = rooms.resolve(p);
        if (!engine) return ack({ ok: false, error: "Room not found" });
        const denied = engine.canJoin(identity.playerKey);
        if (denied) return ack({ ok: false, error: denied });

        socket.data.identity = identity;
        socket.data.roomId = engine.roomId;
        socket.join(engine.roomId);
        socket.join(`player:${identity.playerKey}`); // tournament notifications
        engine.join(identity);
        await store.incr(`stats:joins`, 86400);
        ack({ ok: true, state: engine.state(), playerId: identity.playerKey });
        engine.broadcastState();
      } catch (e) {
        ack({ ok: false, error: e instanceof z.ZodError ? "Invalid join payload" : (e as Error).message });
      }
    });

    socket.on("submit_guess", (raw, ack) => {
      if (guessBudget-- <= 0) return ack?.({ ok: false, error: "Too fast" });
      const parsed = guessSchema.safeParse(raw);
      if (!parsed.success) return ack?.({ ok: false, error: "Invalid guess" });
      const { identity, roomId } = socket.data;
      if (!identity || !roomId) return ack?.({ ok: false, error: "Join a room first" });
      const engine = rooms.get(roomId);
      if (!engine) return ack?.({ ok: false, error: "Room gone" });
      const res = engine.submitGuess(identity.playerKey, parsed.data.roundId, parsed.data.guessPct, parsed.data.lock, parsed.data.pick);
      ack?.(res);
    });

    socket.on("leave_room", () => leave());
    socket.on("disconnect", () => { clearInterval(refill); leave(); });

    function leave() {
      const { identity, roomId } = socket.data;
      if (!identity || !roomId) return;
      rooms.get(roomId)?.leave(identity.playerKey);
      socket.leave(roomId);
      socket.data.roomId = undefined;
    }
  });
}
