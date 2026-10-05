import type { Socket } from "socket.io";
import { z } from "zod";
import { normaliseCustomSettings, normaliseShakSettings, normaliseOwSettings, type OwSettings, type OwAction, type ClientToServerEvents, type ServerToClientEvents, type CustomRoomSettings, type ShakSettings } from "@monumental/shared";
import type { ShakManager } from "./shak/ShakManager.js";
import type { OneWordManager } from "./oneword/OneWordManager.js";
import { resolveIdentity, type Identity } from "./auth.js";
import type { RoomManager, IO } from "./room/RoomManager.js";
import type { LiveStore } from "./store.js";

type Sock = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { identity?: Identity; roomId?: string; shak?: string; ow?: string }>;

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

export function registerSocketHandlers(io: IO, rooms: RoomManager, store: LiveStore, shak?: ShakManager, ow?: OneWordManager) {
  io.on("connection", (socket: Sock) => {
    // naive per-socket rate limit for guesses (drag streams are throttled client-side to ~10/s)
    let guessBudget = 40;
    let lastCreate = 0;
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

    socket.on("create_room", async (raw, ack) => {
      try {
        const p = z.object({
          settings: z.record(z.string(), z.unknown()).default({}),
          nickname: z.string().max(40).default("Host"),
          guestId: z.string().max(64).optional(),
          userToken: z.string().max(2048).optional(),
        }).parse(raw);
        const identity = await resolveIdentity({ ...p, levelId: 1 });
        const settings = normaliseCustomSettings(p.settings as Partial<CustomRoomSettings>);
        // simple abuse guard: one new room per socket every 5 s
        if (Date.now() - lastCreate < 5000) return ack({ ok: false, error: "Slow down a little" });
        lastCreate = Date.now();
        const engine = rooms.createCustom(identity.playerKey, settings);
        ack({ ok: true, roomId: engine.roomId });
      } catch (e) {
        ack({ ok: false, error: e instanceof z.ZodError ? "Invalid settings" : (e as Error).message });
      }
    });

    socket.on("host_start", (ack) => {
      const { identity, roomId } = socket.data;
      const engine = roomId ? rooms.get(roomId) : undefined;
      if (!identity || !engine) return ack?.({ ok: false, error: "Join the room first" });
      ack?.(engine.hostStart(identity.playerKey));
    });

    socket.on("host_update", (raw, ack) => {
      const { identity, roomId } = socket.data;
      const engine = roomId ? rooms.get(roomId) : undefined;
      if (!identity || !engine) return ack?.({ ok: false, error: "Join the room first" });
      try {
        const settings = normaliseCustomSettings((raw?.settings ?? {}) as Partial<CustomRoomSettings>);
        ack?.(engine.hostUpdate(identity.playerKey, settings));
      } catch (e) {
        ack?.({ ok: false, error: (e as Error).message });
      }
    });

    // ───────── أشك (Shak) dominoes ─────────
    const idSchema = z.object({ nickname: z.string().max(40).default("Player"), guestId: z.string().max(64).optional(), userToken: z.string().max(2048).optional() });
    const shakTable = () => (socket.data.shak && shak ? shak.get(socket.data.shak) : undefined);
    const shakLeave = () => {
      const t = shakTable();
      if (t && socket.data.identity) t.leave(socket.data.identity.playerKey);
      if (socket.data.shak) socket.leave(`shak:${socket.data.shak}`);
      socket.data.shak = undefined;
    };

    socket.on("shak_create", async (raw, ack) => {
      if (!shak) return ack({ ok: false, error: "Not available" });
      try {
        const p = idSchema.extend({ settings: z.record(z.string(), z.unknown()).optional() }).parse(raw);
        const identity = await resolveIdentity({ ...p, levelId: 1 });
        if (Date.now() - lastCreate < 5000) return ack({ ok: false, error: "Slow down a little" });
        lastCreate = Date.now();
        const t = shak.create(identity.playerKey, normaliseShakSettings(p.settings as Partial<ShakSettings>));
        ack({ ok: true, code: t.code });
      } catch (e) {
        ack({ ok: false, error: e instanceof z.ZodError ? "Invalid request" : (e as Error).message });
      }
    });

    socket.on("shak_join", async (raw, ack) => {
      if (!shak) return ack({ ok: false, error: "Not available" });
      try {
        const p = idSchema.extend({ code: z.string().min(4).max(10) }).parse(raw);
        const identity = await resolveIdentity({ ...p, levelId: 1 });
        const t = shak.get(p.code);
        if (!t) return ack({ ok: false, error: "Table not found — ask the host for a new link" });
        if (socket.data.shak && socket.data.shak !== t.code) shakLeave();
        const already = socket.data.shak === t.code;
        if (!already) {
          const r = t.join(identity.playerKey, identity.nickname);
          if (!r.ok) return ack(r);
        }
        socket.data.identity = identity;
        socket.data.shak = t.code;
        socket.join(`shak:${t.code}`);
        socket.join(`player:${identity.playerKey}`);
        ack({ ok: true, playerId: identity.playerKey, state: t.state(), hand: t.handOf(identity.playerKey) });
      } catch (e) {
        ack({ ok: false, error: e instanceof z.ZodError ? "Invalid request" : (e as Error).message });
      }
    });

    const shakAct = (fn: (t: NonNullable<ReturnType<typeof shakTable>>, me: string) => { ok: boolean; error?: string }) =>
      (ack?: (a: { ok: boolean; error?: string }) => void) => {
        const t = shakTable();
        const me = socket.data.identity?.playerKey;
        if (!t || !me) return ack?.({ ok: false, error: "Join a table first" });
        if (guessBudget-- <= 0) return ack?.({ ok: false, error: "Too fast" });
        ack?.(fn(t, me));
      };
    socket.on("shak_leave", () => shakLeave());
    socket.on("shak_start", (ack) => shakAct((t, me) => t.start(me))(ack));
    socket.on("shak_pass", (ack) => shakAct((t, me) => t.pass(me))(ack));
    socket.on("shak_doubt", (ack) => shakAct((t, me) => t.doubt(me))(ack));
    socket.on("shak_bot", (raw, ack) => shakAct((t, me) => (raw?.op === "remove" ? t.removeBot(me) : t.addBot(me)))(ack));
    socket.on("shak_settings", (raw, ack) => shakAct((t, me) => t.updateSettings(me, normaliseShakSettings(raw?.settings)))(ack));
    socket.on("shak_play", (raw, ack) => {
      const p = z.object({ tiles: z.array(z.number().int().min(0).max(27)).max(9), number: z.number().int().min(0).max(6).optional() }).safeParse(raw);
      if (!p.success) return ack?.({ ok: false, error: "Invalid play" });
      shakAct((t, me) => t.play(me, p.data.tiles, p.data.number))(ack);
    });

    // ───────── ONE WORD ─────────
    const owTable = () => (socket.data.ow && ow ? ow.get(socket.data.ow) : undefined);
    const owLeave = () => {
      const t = owTable();
      if (t && socket.data.identity) t.leave(socket.data.identity.playerKey);
      if (socket.data.ow) socket.leave(`ow:${socket.data.ow}`);
      socket.data.ow = undefined;
    };
    socket.on("ow_create", async (raw, ack) => {
      if (!ow) return ack({ ok: false, error: "Not available" });
      try {
        const p = idSchema.extend({ settings: z.record(z.string(), z.unknown()).optional() }).parse(raw);
        const identity = await resolveIdentity({ ...p, levelId: 1 });
        if (Date.now() - lastCreate < 5000) return ack({ ok: false, error: "Slow down a little" });
        lastCreate = Date.now();
        const t = ow.create(identity.playerKey, normaliseOwSettings(p.settings as Partial<OwSettings>));
        ack({ ok: true, code: t.code });
      } catch (e) {
        ack({ ok: false, error: e instanceof z.ZodError ? "Invalid request" : (e as Error).message });
      }
    });
    socket.on("ow_join", async (raw, ack) => {
      if (!ow) return ack({ ok: false, error: "Not available" });
      try {
        const p = idSchema.extend({ code: z.string().min(4).max(10) }).parse(raw);
        const identity = await resolveIdentity({ ...p, levelId: 1 });
        const t = ow.get(p.code);
        if (!t) return ack({ ok: false, error: "Game not found — ask the host for a new link" });
        if (socket.data.ow && socket.data.ow !== t.code) owLeave();
        if (socket.data.ow !== t.code) {
          const r = t.join(identity.playerKey, identity.nickname);
          if (!r.ok) return ack(r);
        }
        socket.data.identity = identity;
        socket.data.ow = t.code;
        socket.join(`ow:${t.code}`);
        socket.join(`player:${identity.playerKey}`);
        ack({ ok: true, playerId: identity.playerKey, state: t.state(), key: t.keyFor(identity.playerKey), chat: t.chatFor(identity.playerKey) });
      } catch (e) {
        ack({ ok: false, error: e instanceof z.ZodError ? "Invalid request" : (e as Error).message });
      }
    });
    const owAction = z.discriminatedUnion("type", [
      z.object({ type: z.literal("join_team"), team: z.enum(["red", "blue"]), role: z.enum(["spymaster", "operative"]) }),
      z.object({ type: z.literal("start") }),
      z.object({ type: z.literal("clue"), word: z.string().max(40), count: z.number().int().min(0).max(9) }),
      z.object({ type: z.literal("mark"), index: z.number().int().min(0).max(24) }),
      z.object({ type: z.literal("reveal"), index: z.number().int().min(0).max(24) }),
      z.object({ type: z.literal("end_turn") }),
      z.object({ type: z.literal("settings"), settings: z.record(z.string(), z.unknown()) }),
      z.object({ type: z.literal("shuffle_teams") }),
      z.object({ type: z.literal("to_lobby") }),
      z.object({ type: z.literal("chat"), text: z.string().max(400) }),
    ]);
    socket.on("ow_act", (raw, ack) => {
      const t = owTable();
      const me = socket.data.identity?.playerKey;
      if (!t || !me) return ack?.({ ok: false, error: "Join a game first" });
      if (guessBudget-- <= 0) return ack?.({ ok: false, error: "Too fast" });
      const p = owAction.safeParse(raw);
      if (!p.success) return ack?.({ ok: false, error: "Invalid action" });
      let a = p.data as OwAction;
      if (a.type === "settings") a = { type: "settings", settings: normaliseOwSettings({ ...t.state().settings, ...(a.settings as Partial<OwSettings>) }) };
      ack?.(t.act(me, a));
    });
    socket.on("ow_leave", () => owLeave());

    socket.on("leave_room", () => leave());
    socket.on("disconnect", () => { clearInterval(refill); leave(); shakLeave(); owLeave(); });

    function leave() {
      const { identity, roomId } = socket.data;
      if (!identity || !roomId) return;
      rooms.get(roomId)?.leave(identity.playerKey);
      socket.leave(roomId);
      socket.data.roomId = undefined;
    }
  });
}
