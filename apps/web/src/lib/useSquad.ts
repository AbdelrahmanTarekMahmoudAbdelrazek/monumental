"use client";
import { useEffect, useRef, useState } from "react";
import { decodeSnap, type SqAction, type SqInput, type SqMeta, type SqPower, type SqSnap, type SqWire } from "@monumental/shared";
import { getSocket, noteServerNow, syncClock } from "./socket";
import { getGuestId, getNickname } from "./identity";

type Ack = { ok: boolean; error?: string };

export interface SqBullet { x0: number; y0: number; a: number; speed: number; range: number; team: 0 | 1; t0: number; stopDist: number | null; stopKind: number }
export interface SqFx {
  /** Unit id → local time of the last shot (muzzle flash / recoil). */
  flashes: Map<string, number>;
  sparks: { x: number; y: number; at: number; kind: number }[];
  numbers: { x: number; y: number; amount: number; at: number }[];
  pulses: { x: number; y: number; at: number }[];
}
export interface SqWorld {
  cur: SqSnap | null;
  prev: SqSnap | null;
  curAt: number;
  bullets: Map<number, SqBullet>;
  powers: { id: number; x: number; y: number; kind: SqPower }[];
  fx: SqFx;
  /** Unit id → local time it last lost health (hit flash). */
  hurt: Map<string, number>;
  /** My player id — my own shots are drawn instantly by the client, so the server's copies are skipped. */
  meId: string | null;
  /** Shots I fired, drawn the moment I click (visual only; the server decides hits). */
  local: { x0: number; y0: number; a: number; speed: number; stopDist: number; at: number; team: 0 | 1; hit: boolean }[];
  /** Recent server positions per unit (for smooth interpolation of other players). */
  hist: Map<string, SqHist[]>;
  /** Server clock minus local clock, tracked from the fastest-arriving snapshots. */
  tOff: number | null;
}
export interface SqHist { t: number; x: number; y: number; a: number; vx: number; vy: number; life: SqSnap["units"][number]["life"] }

/** Connects to one SQUAD RUSH room. Fast-changing world state lives in a ref. */
export function useSquad(code: string, userToken?: string | null) {
  const [meta, setMeta] = useState<SqMeta | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const world = useRef<SqWorld>({
    cur: null, prev: null, curAt: 0, bullets: new Map(), powers: [],
    fx: { flashes: new Map(), sparks: [], numbers: [], pulses: [] }, hurt: new Map(), meId: null, local: [], hist: new Map(), tOff: null,
  });

  const nToId = useRef(new Map<number, string>());

  useEffect(() => {
    const s = getSocket();
    const learn = (m: SqMeta) => { for (const p of m.players) if (typeof p.n === "number") nToId.current.set(p.n, p.id); };
    let cancelled = false;
    const join = () =>
      s.emit("sq_join", { code, nickname: getNickname(), guestId: getGuestId(), userToken: userToken ?? undefined }, (a) => {
        if (cancelled) return;
        if (!a.ok || !a.meta) { setError(a.error ?? "Could not join"); return; }
        setError(null);
        setMe(a.playerId ?? null);
        learn(a.meta);
        setMeta(a.meta);
        noteServerNow(a.meta.serverNow);
        void syncClock();
      });
    const onConnect = () => { setConnected(true); join(); };
    const onDisconnect = () => setConnected(false);
    const onMeta = (m: SqMeta) => { if (m.code === code) { learn(m); setMeta(m); } };
    const onSnap = (wire: SqWire | SqSnap) => {
      // Accept both formats so a server and website deployed minutes apart still work together.
      let sn: SqSnap;
      try {
        sn = "units" in wire ? wire : decodeSnap(wire, (n) => nToId.current.get(n));
        if (!Array.isArray(sn.units)) return;
      } catch { return; }
      const w = world.current;
      const now = performance.now();
      if (sn.shots) for (let i = 0; i < sn.shots.length; i += 8) {
        const [id, x, y, a, speed, range, team, ui] = sn.shots.slice(i, i + 8);
        const u = sn.units[ui];
        if (u && u.id === w.meId) continue; // already drawn locally
        w.bullets.set(id, { x0: x, y0: y, a: a / 1000, speed, range, team: team as 0 | 1, t0: sn.t, stopDist: null, stopKind: -1 });
        if (u) w.fx.flashes.set(u.id, now);
      }
      if (sn.stops) for (let i = 0; i < sn.stops.length; i += 4) {
        const [id, x, y, kind] = sn.stops.slice(i, i + 4);
        const b = w.bullets.get(id);
        if (b) { b.stopDist = Math.hypot(x - b.x0, y - b.y0); b.stopKind = kind; }
        else w.fx.sparks.push({ x, y, at: now, kind });
      }
      if (sn.dmg) for (let i = 0; i < sn.dmg.length; i += 3) w.fx.numbers.push({ x: sn.dmg[i], y: sn.dmg[i + 1], amount: sn.dmg[i + 2], at: now });
      if (sn.pulses) for (let i = 0; i < sn.pulses.length; i += 2) w.fx.pulses.push({ x: sn.pulses[i], y: sn.pulses[i + 1], at: now });
      const prevHp = new Map((w.cur?.units ?? []).map((u) => [u.id, u.life === "alive" ? u.hp : -1]));
      for (const u of sn.units) { const p = prevHp.get(u.id); if (p !== undefined && p > 0 && u.life === "alive" && u.hp < p - 0.5) w.hurt.set(u.id, now); }
      // clock: keep the offset of the quickest arrival, drifting down slowly so a one-off fast packet can't stick
      const sample = sn.t - now;
      w.tOff = w.tOff === null || sample > w.tOff ? sample : w.tOff - 0.25;
      if (w.cur && sn.t < w.cur.t) return; // out-of-order packet
      for (const u of sn.units) {
        let h = w.hist.get(u.id);
        if (!h) { h = []; w.hist.set(u.id, h); }
        h.push({ t: sn.t, x: u.x, y: u.y, a: u.a / 1000, vx: u.vx, vy: u.vy, life: u.life });
        while (h.length > 2 && h[1].t < sn.t - 1000) h.shift();
      }
      w.powers = sn.powers;
      w.prev = w.cur;
      w.cur = sn;
      w.curAt = now;
      if (w.fx.numbers.length > 80) w.fx.numbers.splice(0, w.fx.numbers.length - 80);
      if (w.fx.sparks.length > 120) w.fx.sparks.splice(0, w.fx.sparks.length - 120);
    };
    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("sq_meta", onMeta);
    s.on("sq_snap", onSnap);
    if (s.connected) onConnect();
    return () => {
      cancelled = true;
      s.emit("sq_leave");
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("sq_meta", onMeta);
      s.off("sq_snap", onSnap);
    };
  }, [code, userToken]);

  const act = (a: SqAction) => new Promise<Ack>((res) => getSocket().emit("sq_act", a, res));
  const input = (i: SqInput) => getSocket().emit("sq_input", i);
  return { meta, me, error, connected, world, act, input };
}
