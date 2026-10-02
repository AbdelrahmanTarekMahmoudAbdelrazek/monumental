"use client";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@monumental/shared";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000";

let socket: GameSocket | null = null;
/** serverTime ≈ Date.now() + clockOffset */
let clockOffset = 0;

export function getSocket(): GameSocket {
  if (!socket) {
    socket = io(SOCKET_URL, { transports: ["websocket", "polling"], autoConnect: true, reconnectionDelayMax: 5000 });
    socket.on("connect", () => void syncClock());
  }
  return socket;
}

export function serverNow() {
  return Date.now() + clockOffset;
}

/** NTP-style: 3 samples, keep the one with the lowest RTT. */
export async function syncClock() {
  const s = getSocket();
  let best: { rtt: number; offset: number } | null = null;
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const r = await new Promise<{ t0: number; t1: number }>((res) => s.emit("ping_time", { t0 }, res));
    const t2 = Date.now();
    const rtt = t2 - t0;
    const offset = r.t1 + rtt / 2 - t2;
    if (!best || rtt < best.rtt) best = { rtt, offset };
  }
  if (best) clockOffset = best.offset;
  return clockOffset;
}

/** Apply offset from a server snapshot (cheap, no RTT) — only if we don't have a sync yet. */
export function noteServerNow(serverNowMs: number) {
  if (clockOffset === 0) clockOffset = serverNowMs - Date.now();
}
