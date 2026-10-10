import type { Socket } from "socket.io";
import { z } from "zod";
import { normaliseCustomSettings, normaliseShakSettings, normaliseOwSettings, normaliseSmuggleSettings, normaliseNeonSettings, normaliseSqSettings, type ClipTag, type SqSettings, type SqAction, type NeonSettings, type NeonAction, type SmuggleSettings, type SmuggleAction, type OwSettings, type OwAction, type ClientToServerEvents, type ServerToClientEvents, type CustomRoomSettings, type ShakSettings } from "@monumental/shared";
import type { ShakManager } from "./shak/ShakManager.js";
import type { OneWordManager } from "./oneword/OneWordManager.js";
import type { SmuggleManager } from "./smuggle/SmuggleManager.js";
import type { NeonManager } from "./neon/NeonManager.js";
import type { SquadManager } from "./squad/SquadManager.js";
import type { EchoManager } from "./echo/EchoManager.js";
import { resolveIdentity, type Identity } from "./auth.js";
import type { RoomManager, IO } from "./room/RoomManager.js";
import type { LiveStore } from "./store.js";

type Sock = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { identity?: Identity; roomId?: string; shak?: string; ow?: string; sm?: string; nd?: string; sq?: string; eh?: string; ehN?: number }>;

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

export function registerSocketHandlers(io: IO, rooms: RoomManager, store: LiveStore, shak?: ShakManager, ow?: OneWordManager, sm?: SmuggleManager, nd?: NeonManager, sq?: SquadManager, eh?: EchoManager) {
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

    // ───────── SMUGGLERS ─────────
    const smTable = () => (socket.data.sm && sm ? sm.get(socket.data.sm) : undefined);
    const smLeave = () => {
      const t = smTable();
      if (t && socket.data.identity) t.leave(socket.data.identity.playerKey);
      if (socket.data.sm) socket.leave(`sm:${socket.data.sm}`);
      socket.data.sm = undefined;
    };
    socket.on("sm_create", async (raw, ack) => {
      if (!sm) return ack({ ok: false, error: "Not available" });
      try {
        const p = idSchema.extend({ settings: z.record(z.string(), z.unknown()).optional() }).parse(raw);
        const identity = await resolveIdentity({ ...p, levelId: 1 });
        if (Date.now() - lastCreate < 5000) return ack({ ok: false, error: "Slow down a little" });
        lastCreate = Date.now();
        const t = sm.create(identity.playerKey, normaliseSmuggleSettings(p.settings as Partial<SmuggleSettings>));
        ack({ ok: true, code: t.code });
      } catch (e) {
        ack({ ok: false, error: e instanceof z.ZodError ? "Invalid request" : (e as Error).message });
      }
    });
    socket.on("sm_join", async (raw, ack) => {
      if (!sm) return ack({ ok: false, error: "Not available" });
      try {
        const p = idSchema.extend({ code: z.string().min(4).max(10) }).parse(raw);
        const identity = await resolveIdentity({ ...p, levelId: 1 });
        const t = sm.get(p.code);
        if (!t) return ack({ ok: false, error: "Game not found — ask the host for a new link" });
        if (socket.data.sm && socket.data.sm !== t.code) smLeave();
        if (socket.data.sm !== t.code) {
          const r = t.join(identity.playerKey, identity.nickname);
          if (!r.ok) return ack(r);
        }
        socket.data.identity = identity;
        socket.data.sm = t.code;
        socket.join(`sm:${t.code}`);
        socket.join(`player:${identity.playerKey}`);
        ack({ ok: true, playerId: identity.playerKey, state: t.state(), words: t.secretFor(identity.playerKey) });
      } catch (e) {
        ack({ ok: false, error: e instanceof z.ZodError ? "Invalid request" : (e as Error).message });
      }
    });
    const smAction = z.discriminatedUnion("type", [
      z.object({ type: z.literal("start") }),
      z.object({ type: z.literal("write"), text: z.string().max(400) }),
      z.object({ type: z.literal("guess"), guesses: z.record(z.string().max(64), z.string().max(40)) }),
      z.object({ type: z.literal("settings"), settings: z.record(z.string(), z.unknown()) }),
      z.object({ type: z.literal("to_lobby") }),
    ]);
    socket.on("sm_act", (raw, ack) => {
      const t = smTable();
      const me = socket.data.identity?.playerKey;
      if (!t || !me) return ack?.({ ok: false, error: "Join a game first" });
      if (guessBudget-- <= 0) return ack?.({ ok: false, error: "Too fast" });
      const p = smAction.safeParse(raw);
      if (!p.success) return ack?.({ ok: false, error: "Invalid action" });
      let a = p.data as SmuggleAction;
      if (a.type === "settings") a = { type: "settings", settings: normaliseSmuggleSettings({ ...t.state().settings, ...(a.settings as Partial<SmuggleSettings>) }) };
      ack?.(t.act(me, a));
    });
    socket.on("sm_leave", () => smLeave());

    // ───────── NEON DRIFT ─────────
    const ndArena = () => (socket.data.nd && nd ? nd.get(socket.data.nd) : undefined);
    const ndLeave = () => {
      const t = ndArena();
      if (t && socket.data.identity) t.leave(socket.data.identity.playerKey);
      if (socket.data.nd) socket.leave(`nd:${socket.data.nd}`);
      socket.data.nd = undefined;
    };
    socket.on("nd_create", async (raw, ack) => {
      if (!nd) return ack({ ok: false, error: "Not available" });
      try {
        const p = idSchema.extend({ settings: z.record(z.string(), z.unknown()).optional() }).parse(raw);
        const identity = await resolveIdentity({ ...p, levelId: 1 });
        if (Date.now() - lastCreate < 5000) return ack({ ok: false, error: "Slow down a little" });
        lastCreate = Date.now();
        const t = nd.create(identity.playerKey, normaliseNeonSettings(p.settings as Partial<NeonSettings>));
        ack({ ok: true, code: t.code });
      } catch (e) {
        ack({ ok: false, error: e instanceof z.ZodError ? "Invalid request" : (e as Error).message });
      }
    });
    socket.on("nd_join", async (raw, ack) => {
      if (!nd) return ack({ ok: false, error: "Not available" });
      try {
        const p = idSchema.extend({ code: z.string().min(4).max(10) }).parse(raw);
        const identity = await resolveIdentity({ ...p, levelId: 1 });
        const t = nd.get(p.code);
        if (!t) return ack({ ok: false, error: "Arena not found — ask the host for a new link" });
        if (socket.data.nd && socket.data.nd !== t.code) ndLeave();
        socket.data.identity = identity;
        socket.join(`nd:${t.code}`);
        if (socket.data.nd !== t.code) {
          const r = t.join(identity.playerKey, identity.nickname);
          if (!r.ok) { socket.leave(`nd:${t.code}`); return ack(r); }
        }
        socket.data.nd = t.code;
        ack({ ok: true, playerId: identity.playerKey, meta: t.meta() });
      } catch (e) {
        ack({ ok: false, error: e instanceof z.ZodError ? "Invalid request" : (e as Error).message });
      }
    });
    let inputBudget = 40;
    const inputRefill = setInterval(() => { inputBudget = 40; }, 1000);
    socket.on("nd_input", (raw) => {
      const t = ndArena();
      const me = socket.data.identity?.playerKey;
      if (!t || !me || inputBudget-- <= 0) return;
      const aim = raw?.aim === null || raw?.aim === undefined ? null : Number(raw.aim);
      t.input(me, Number(raw?.turn) || 0, !!raw?.boost, aim !== null && Number.isFinite(aim) ? aim : null);
    });
    const ndAction = z.discriminatedUnion("type", [
      z.object({ type: z.literal("start") }),
      z.object({ type: z.literal("settings"), settings: z.record(z.string(), z.unknown()) }),
      z.object({ type: z.literal("to_lobby") }),
    ]);
    socket.on("nd_act", (raw, ack) => {
      const t = ndArena();
      const me = socket.data.identity?.playerKey;
      if (!t || !me) return ack?.({ ok: false, error: "Join an arena first" });
      const p = ndAction.safeParse(raw);
      if (!p.success) return ack?.({ ok: false, error: "Invalid action" });
      let a = p.data as NeonAction;
      if (a.type === "settings") a = { type: "settings", settings: normaliseNeonSettings({ ...t.meta().settings, ...(a.settings as Partial<NeonSettings>) }) };
      ack?.(t.act(me, a));
    });
    socket.on("nd_leave", () => ndLeave());

    // ───────── SQUAD RUSH ─────────
    const sqRoom = () => (socket.data.sq && sq ? sq.get(socket.data.sq) : undefined);
    const sqLeave = () => {
      const t = sqRoom();
      if (t && socket.data.identity) t.leave(socket.data.identity.playerKey);
      if (socket.data.sq) socket.leave(`sq:${socket.data.sq}`);
      socket.data.sq = undefined;
    };
    socket.on("sq_create", async (raw, ack) => {
      if (!sq) return ack({ ok: false, error: "Not available" });
      try {
        const p = idSchema.extend({ settings: z.record(z.string(), z.unknown()).optional() }).parse(raw);
        const identity = await resolveIdentity({ ...p, levelId: 1 });
        if (Date.now() - lastCreate < 5000) return ack({ ok: false, error: "Slow down a little" });
        lastCreate = Date.now();
        const t = sq.create(identity.playerKey, normaliseSqSettings(p.settings as Partial<SqSettings>));
        ack({ ok: true, code: t.code });
      } catch (e) {
        ack({ ok: false, error: e instanceof z.ZodError ? "Invalid request" : (e as Error).message });
      }
    });
    socket.on("sq_join", async (raw, ack) => {
      if (!sq) return ack({ ok: false, error: "Not available" });
      try {
        const p = idSchema.extend({ code: z.string().min(4).max(10) }).parse(raw);
        const identity = await resolveIdentity({ ...p, levelId: 1 });
        const t = sq.get(p.code);
        if (!t) return ack({ ok: false, error: "Room not found — ask the host for a new link" });
        if (socket.data.sq && socket.data.sq !== t.code) sqLeave();
        socket.data.identity = identity;
        socket.join(`sq:${t.code}`);
        if (socket.data.sq !== t.code) {
          const r = t.join(identity.playerKey, identity.nickname);
          if (!r.ok) { socket.leave(`sq:${t.code}`); return ack(r); }
        }
        socket.data.sq = t.code;
        ack({ ok: true, playerId: identity.playerKey, meta: t.meta() });
      } catch (e) {
        ack({ ok: false, error: e instanceof z.ZodError ? "Invalid request" : (e as Error).message });
      }
    });
    let sqBudget = 60;
    const sqRefill = setInterval(() => { sqBudget = 60; }, 1000);
    socket.on("sq_input", (raw) => {
      const t = sqRoom();
      const me = socket.data.identity?.playerKey;
      if (!t || !me || sqBudget-- <= 0 || !raw) return;
      const n = (v: unknown, lo: number, hi: number) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : 0; };
      t.input(me, { mx: n(raw.mx, -1, 1), my: n(raw.my, -1, 1), aim: n(raw.aim, -10, 10), fire: !!raw.fire, ability: !!raw.ability, revive: !!raw.revive, reload: !!raw.reload, seq: n(raw.seq, 0, 1e9),
        ...(Number.isFinite(Number(raw.px)) && Number.isFinite(Number(raw.py)) ? { px: n(raw.px, 0, 1e5), py: n(raw.py, 0, 1e5) } : {}) });
    });
    const sqAction = z.discriminatedUnion("type", [
      z.object({ type: z.literal("start") }),
      z.object({ type: z.literal("settings"), settings: z.record(z.string(), z.unknown()) }),
      z.object({ type: z.literal("team"), team: z.enum(["red", "blue"]) }),
      z.object({ type: z.literal("role"), role: z.enum(["healer", "tank", "fighter"]) }),
      z.object({ type: z.literal("bot"), team: z.enum(["red", "blue"]), op: z.enum(["add", "remove"]) }),
      z.object({ type: z.literal("to_lobby") }),
    ]);
    socket.on("sq_act", (raw, ack) => {
      const t = sqRoom();
      const me = socket.data.identity?.playerKey;
      if (!t || !me) return ack?.({ ok: false, error: "Join a room first" });
      const p = sqAction.safeParse(raw);
      if (!p.success) return ack?.({ ok: false, error: "Invalid action" });
      let a = p.data as SqAction;
      if (a.type === "settings") a = { type: "settings", settings: normaliseSqSettings({ ...t.meta().settings, ...(a.settings as Partial<SqSettings>) }) };
      ack?.(t.act(me, a));
    });
    socket.on("sq_leave", () => sqLeave());

    // ───────── ECHO HALLS ─────────
    const ehRoom = () => (socket.data.eh && eh ? eh.get(socket.data.eh) : undefined);
    const ehLeave = () => {
      const r = ehRoom();
      if (r && socket.data.identity) r.leave(socket.data.identity.playerKey);
      if (socket.data.eh) {
        socket.leave(`eh:${socket.data.eh}`);
        if (socket.data.ehN) socket.leave(`eh:${socket.data.eh}:${socket.data.ehN}`);
      }
      socket.data.eh = undefined;
      socket.data.ehN = undefined;
    };
    socket.on("eh_create", async (raw, ack) => {
      if (!eh) return ack({ ok: false, error: "Not available" });
      try {
        const p = idSchema.parse(raw);
        const identity = await resolveIdentity({ ...p, levelId: 1 });
        if (Date.now() - lastCreate < 5000) return ack({ ok: false, error: "Slow down a little" });
        lastCreate = Date.now();
        ack({ ok: true, code: eh.create(identity.playerKey).code });
      } catch (e) {
        ack({ ok: false, error: e instanceof z.ZodError ? "Invalid request" : (e as Error).message });
      }
    });
    socket.on("eh_join", async (raw, ack) => {
      if (!eh) return ack({ ok: false, error: "Not available" });
      try {
        const p = idSchema.extend({ code: z.string().min(4).max(10) }).parse(raw);
        const identity = await resolveIdentity({ ...p, levelId: 1 });
        const r = eh.get(p.code);
        if (!r) return ack({ ok: false, error: "Room not found — ask the host for a new link" });
        if (socket.data.eh && socket.data.eh !== r.code) ehLeave();
        socket.data.identity = identity;
        const res = r.join(identity.playerKey, identity.nickname);
        if (!res.ok) return ack(res);
        socket.join(`eh:${r.code}`);
        socket.join(`eh:${r.code}:${res.n}`);
        socket.data.eh = r.code;
        socket.data.ehN = res.n;
        ack({ ok: true, playerId: identity.playerKey, n: res.n, meta: r.meta(), spawn: res.spawn });
      } catch (e) {
        ack({ ok: false, error: e instanceof z.ZodError ? "Invalid request" : (e as Error).message });
      }
    });
    let ehBudget = 40;
    let ehSignalBudget = 120;
    const ehRefill = setInterval(() => { ehBudget = 40; ehSignalBudget = 120; }, 1000);
    socket.on("eh_state", (raw) => {
      const r = ehRoom();
      const me = socket.data.identity?.playerKey;
      if (!r || !me || ehBudget-- <= 0 || !raw) return;
      const n = (v: unknown, lo: number, hi: number) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : 0; };
      r.state(me, { x: n(raw.x, 0, 1000), y: n(raw.y, -5, 5), z: n(raw.z, 0, 1000), yaw: n(raw.yaw, -1e3, 1e3), pitch: n(raw.pitch, -2, 2), torch: !!raw.torch, crouch: !!raw.crouch, talk: !!raw.talk, seq: n(raw.seq, 0, 1e9) });
    });
    let lookAt = 0;
    socket.on("eh_look", (raw, ack) => {
      const r = ehRoom();
      const me = socket.data.identity?.playerKey;
      if (typeof ack !== "function") return;
      if (!r || !me) return ack({ ok: false, error: "Not in a room" });
      if (Date.now() - lookAt < 150) return ack({ ok: false, error: "Slow down a little" });
      lookAt = Date.now();
      if (JSON.stringify(raw ?? null).length > 2000) return ack({ ok: false, error: "Invalid look" });
      ack(r.setLook(me, (raw as { look?: unknown } | null)?.look));
    });
    socket.on("eh_signal", (raw) => {
      const r = ehRoom();
      const from = socket.data.ehN;
      if (!r || !from || !eh || ehSignalBudget-- <= 0 || !raw) return;
      const to = Number(raw.to);
      if (!Number.isInteger(to) || to === from || !r.idOf(to)) return;
      let size = 0;
      try { size = JSON.stringify(raw.data ?? null).length; } catch { return; }
      if (size > 20_000) return;
      eh.relay(r.code, from, to, raw.data);
    });
    const tagOk = (t: unknown): t is ClipTag => typeof t === "string" && (/^name:\d{1,2}$/.test(t) || ["short", "long", "loud", "call", "here", "found", "panic", "question", "laugh"].includes(t));
    const cleanTags = (raw: unknown): ClipTag[] => (Array.isArray(raw) ? raw.filter(tagOk).slice(0, 8) : []);
    let ehClipBudget = 4;
    const ehClipRefill = setInterval(() => { ehClipBudget = 4; }, 1000);
    socket.on("eh_clip", (raw) => {
      const r = ehRoom();
      const me = socket.data.identity?.playerKey;
      if (!r || !me || !raw || ehClipBudget-- <= 0) return;
      const id = Number(raw.id), ms = Number(raw.ms);
      if (!Number.isInteger(id) || id < 0 || id > 1e6 || !Number.isFinite(ms) || ms < 200 || ms > 4000) return;
      r.clip(me, id, Math.round(ms), cleanTags(raw.tags));
    });
    socket.on("eh_tag", (raw) => {
      const r = ehRoom();
      const me = socket.data.identity?.playerKey;
      if (!r || !me || !raw || ehBudget-- <= 0) return;
      const id = Number(raw.id);
      if (!Number.isInteger(id)) return;
      r.tag(me, id, cleanTags(raw.tags));
    });
    socket.on("eh_have", (raw) => {
      const r = ehRoom();
      const me = socket.data.identity?.playerKey;
      if (!r || !me || !raw || typeof raw.key !== "string" || raw.key.length > 20 || ehSignalBudget-- <= 0) return;
      r.have(me, raw.key);
    });
    socket.on("disconnect", () => clearInterval(ehClipRefill));
    socket.on("eh_leave", () => ehLeave());
    socket.on("disconnect", () => { clearInterval(ehRefill); ehLeave(); });
    socket.on("disconnect", () => clearInterval(sqRefill));
    socket.on("disconnect", () => clearInterval(inputRefill));

    socket.on("leave_room", () => leave());
    socket.on("disconnect", () => { clearInterval(refill); leave(); shakLeave(); owLeave(); smLeave(); ndLeave(); sqLeave(); });

    function leave() {
      const { identity, roomId } = socket.data;
      if (!identity || !roomId) return;
      rooms.get(roomId)?.leave(identity.playerKey);
      socket.leave(roomId);
      socket.data.roomId = undefined;
    }
  });
}
