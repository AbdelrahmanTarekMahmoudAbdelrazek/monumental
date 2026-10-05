"use client";
import { useCallback, useEffect, useState } from "react";
import type { ShakPublicState, ShakSettings } from "@monumental/shared";
import { getSocket, noteServerNow, syncClock } from "./socket";
import { getGuestId, getNickname } from "./identity";

type Ack = { ok: boolean; error?: string };

/** Connects to one أشك table: public state, my private hand, and the actions. */
export function useShak(code: string, userToken?: string | null) {
  const [state, setState] = useState<ShakPublicState | null>(null);
  const [hand, setHand] = useState<number[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const s = getSocket();
    let cancelled = false;
    const join = () =>
      s.emit("shak_join", { code, nickname: getNickname(), guestId: getGuestId(), userToken: userToken ?? undefined }, (a) => {
        if (cancelled) return;
        if (!a.ok || !a.state) { setError(a.error ?? "Could not join"); return; }
        setError(null);
        setMe(a.playerId ?? null);
        setState(a.state);
        setHand(a.hand ?? []);
        noteServerNow(a.state.serverNow);
        void syncClock();
      });
    const onConnect = () => { setConnected(true); join(); };
    const onDisconnect = () => setConnected(false);
    const onState = (st: ShakPublicState) => { if (st.code === code) setState(st); };
    const onHand = (h: { code: string; tiles: number[] }) => { if (h.code === code) setHand(h.tiles); };
    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("shak_state", onState);
    s.on("shak_hand", onHand);
    if (s.connected) onConnect();
    return () => {
      cancelled = true;
      s.emit("shak_leave");
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("shak_state", onState);
      s.off("shak_hand", onHand);
    };
  }, [code, userToken]);

  const call = useCallback(<K extends "shak_start" | "shak_pass" | "shak_doubt">(ev: K) =>
    new Promise<Ack>((res) => (getSocket().emit as (e: string, cb: (a: Ack) => void) => void)(ev, res)), []);

  return {
    state, hand, me, error, connected,
    start: () => call("shak_start"),
    pass: () => call("shak_pass"),
    doubt: () => call("shak_doubt"),
    play: (tiles: number[], number?: number) => new Promise<Ack>((res) => getSocket().emit("shak_play", { tiles, number }, res)),
    bot: (op: "add" | "remove") => new Promise<Ack>((res) => getSocket().emit("shak_bot", { op }, res)),
    updateSettings: (settings: Partial<ShakSettings>) => new Promise<Ack>((res) => getSocket().emit("shak_settings", { settings }, res)),
  };
}
