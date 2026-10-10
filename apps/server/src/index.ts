import { iceService } from "./echo/ice";
import http from "node:http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { config } from "./config.js";
import { createStore } from "./store.js";
import { RoomManager, type IO } from "./room/RoomManager.js";
import { registerSocketHandlers } from "./socket.js";
import { initPersistence } from "./persistence.js";
import { refreshCatalog, getCatalog } from "./catalog.js";
import { TournamentScheduler } from "./tournaments/scheduler.js";
import { ShakManager } from "./shak/ShakManager.js";
import { OneWordManager } from "./oneword/OneWordManager.js";
import { SmuggleManager } from "./smuggle/SmuggleManager.js";
import { NeonManager } from "./neon/NeonManager.js";
import { SquadManager } from "./squad/SquadManager.js";
import { EchoManager } from "./echo/EchoManager.js";
import { LEVELS } from "@monumental/shared";

export async function createServer() {
  const app = express();
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json());

  const httpServer = http.createServer(app);
  const io: IO = new Server(httpServer, {
    cors: { origin: config.corsOrigins, credentials: true },
    pingInterval: 10_000,
    pingTimeout: 20_000,
    transports: ["websocket", "polling"],
    // small, frequent game packets: compressing them only adds CPU time and latency
    perMessageDeflate: false,
    httpCompression: false,
  });

  const store = createStore();
  if (store.kind === "redis" && store.redis) {
    const sub = store.redis.duplicate();
    io.adapter(createAdapter(store.redis, sub));
    console.log("[io] redis adapter enabled");
  }

  const db = await initPersistence();
  await refreshCatalog();
  setInterval(() => void refreshCatalog(), 3 * 60 * 1000).unref();

  const rooms = new RoomManager(io, store);
  const shak = new ShakManager(io);
  const oneword = new OneWordManager(io);
  const smuggle = new SmuggleManager(io);
  const neon = new NeonManager(io);
  const squad = new SquadManager(io);
  const echo = new EchoManager(io);
  registerSocketHandlers(io, rooms, store, shak, oneword, smuggle, neon, squad, echo);

  let scheduler: TournamentScheduler | null = null;
  if (db && config.tournamentsEnabled) {
    scheduler = new TournamentScheduler(db, rooms, io);
    scheduler.start();
    console.log("[tournaments] scheduler running");
  }

  // ───────── REST (read-only live info) ─────────
  app.get("/health", (_req, res) => res.json({ ok: true, store: store.kind, db: !!db, rooms: rooms.rooms.size, uptime: process.uptime(), voiceRelay: iceService.provider, voiceRelayError: iceService.lastError }));
  app.get("/rooms", (_req, res) => res.json(rooms.overview()));
  app.get("/rooms/:id", (req, res) => {
    const r = rooms.get(req.params.id);
    if (!r) return res.status(404).json({ error: "not found" });
    const s = r.state();
    // never leak the answer mid-round
    res.json({ ...s, round: s.round ? { ...s.round } : undefined });
  });
  app.get("/levels", (_req, res) => res.json(LEVELS));
  app.get("/monuments", (_req, res) => { res.setHeader("Cache-Control", "public, max-age=60"); res.json(getCatalog()); });
  app.get("/time", (_req, res) => res.json({ now: Date.now() }));

  return { app, httpServer, io, rooms, store, scheduler, db, shak, oneword, smuggle, neon, squad, echo };
}

// Boot when run directly.
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop()!);
if (isMain && !config.isTest) {
  createServer().then(({ httpServer }) => {
    httpServer.listen(config.port, () => console.log(`[server] How Big? socket server on :${config.port}`));
  });
}
