"use client";
import { useEffect, useRef, useState } from "react";
import type { NeonAction, NeonMeta, NeonPower, NeonSnap } from "@monumental/shared";
import { getSocket, noteServerNow, syncClock } from "./socket";
import { getGuestId, getNickname } from "./identity";

type Ack = { ok: boolean; error?: string };

export interface NeonWorld {
  /** Previous and latest snapshot, with local arrival times (ms, performance.now). */
  prev: NeonSnap | null;
  cur: NeonSnap | null;
  prevAt: number;
  curAt: number;
  /** Rebuilt trails, flat [x,y,…] oldest first. */
  trails: Map<string, number[]>;
  gas: Map<number, [number, number]>;
  powers: { id: number; x: number; y: number; kind: NeonPower }[];
  /** Cars that just crashed (for explosions). */
  deaths: { id: string; x: number; y: number; at: number }[];
}

function trimTrail(t: number[], len: number) {
  let total = 0;
  for (let i = t.length - 2; i >= 2; i -= 2) {
    total += Math.hypot(t[i] - t[i - 2], t[i + 1] - t[i - 1]);
    if (total > len) { t.splice(0, i - 2); return; }
  }
}

/** Connects to one NEON DRIFT arena. World state lives in a ref (updated 20×/s) to avoid React re-renders. */
export function useNeon(code: string, userToken?: string | null) {
  const [meta, setMeta] = useState<NeonMeta | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const world = useRef<NeonWorld>({ prev: null, cur: null, prevAt: 0, curAt: 0, trails: new Map(), gas: new Map(), powers: [], deaths: [] });

  useEffect(() => {
    const s = getSocket();
    let cancelled = false;
    const join = () =>
      s.emit("nd_join", { code, nickname: getNickname(), guestId: getGuestId(), userToken: userToken ?? undefined }, (a) => {
        if (cancelled) return;
        if (!a.ok || !a.meta) { setError(a.error ?? "Could not join"); return; }
        setError(null);
        setMe(a.playerId ?? null);
        setMeta(a.meta);
        noteServerNow(a.meta.serverNow);
        void syncClock();
      });
    const onConnect = () => { setConnected(true); join(); };
    const onDisconnect = () => setConnected(false);
    const onMeta = (m: NeonMeta) => { if (m.code === code) setMeta(m); };
    const onSnap = (sn: NeonSnap) => {
      const w = world.current;
      const t = performance.now();
      if (sn.trails) {
        w.trails = new Map(Object.entries(sn.trails).map(([k, v]) => [k, v.slice()]));
      } else {
        const prevAlive = new Map((w.cur?.cars ?? []).map((c) => [c.id, c.alive]));
        for (const c of sn.cars) {
          if (!c.alive) {
            if (prevAlive.get(c.id)) w.deaths.push({ id: c.id, x: c.x, y: c.y, at: t });
            w.trails.delete(c.id);
            continue;
          }
          let tr = w.trails.get(c.id);
          if (!tr || !prevAlive.get(c.id)) { tr = []; w.trails.set(c.id, tr); }
          tr.push(c.x, c.y);
          trimTrail(tr, c.len);
        }
      }
      if (sn.gas) {
        w.gas = new Map();
        for (let i = 0; i < sn.gas.length; i += 3) w.gas.set(sn.gas[i], [sn.gas[i + 1], sn.gas[i + 2]]);
      }
      if (sn.gasDel) for (const id of sn.gasDel) w.gas.delete(id);
      if (sn.gasAdd) for (let i = 0; i < sn.gasAdd.length; i += 3) w.gas.set(sn.gasAdd[i], [sn.gasAdd[i + 1], sn.gasAdd[i + 2]]);
      w.powers = sn.powers ?? [];
      w.prev = w.cur; w.prevAt = w.curAt;
      w.cur = sn; w.curAt = t;
      if (w.deaths.length > 30) w.deaths.splice(0, w.deaths.length - 30);
    };
    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("nd_meta", onMeta);
    s.on("nd_snap", onSnap);
    if (s.connected) onConnect();
    return () => {
      cancelled = true;
      s.emit("nd_leave");
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("nd_meta", onMeta);
      s.off("nd_snap", onSnap);
    };
  }, [code, userToken]);

  const act = (a: NeonAction) => new Promise<Ack>((res) => getSocket().emit("nd_act", a, res));
  const input = (turn: number, boost: boolean) => getSocket().emit("nd_input", { turn, boost });
  return { meta, me, error, connected, world, act, input };
}
