"use client";
import { useEffect, useState } from "react";
import type { OwAction, OwColor, OwPublicState } from "@monumental/shared";
import { getSocket, noteServerNow, syncClock } from "./socket";
import { getGuestId, getNickname } from "./identity";

type Ack = { ok: boolean; error?: string };

/** Connects to one ONE WORD table: public state, the secret key (Spymasters only) and actions. */
export function useOneWord(code: string, userToken?: string | null) {
  const [state, setState] = useState<OwPublicState | null>(null);
  const [key, setKey] = useState<OwColor[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const s = getSocket();
    let cancelled = false;
    const join = () =>
      s.emit("ow_join", { code, nickname: getNickname(), guestId: getGuestId(), userToken: userToken ?? undefined }, (a) => {
        if (cancelled) return;
        if (!a.ok || !a.state) { setError(a.error ?? "Could not join"); return; }
        setError(null);
        setMe(a.playerId ?? null);
        setState(a.state);
        setKey(a.key ?? null);
        noteServerNow(a.state.serverNow);
        void syncClock();
      });
    const onConnect = () => { setConnected(true); join(); };
    const onDisconnect = () => setConnected(false);
    const onState = (st: OwPublicState) => { if (st.code === code) setState(st); };
    const onKey = (k: { code: string; key: OwColor[] | null }) => { if (k.code === code) setKey(k.key); };
    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("ow_state", onState);
    s.on("ow_key", onKey);
    if (s.connected) onConnect();
    return () => {
      cancelled = true;
      s.emit("ow_leave");
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("ow_state", onState);
      s.off("ow_key", onKey);
    };
  }, [code, userToken]);

  const act = (a: OwAction) => new Promise<Ack>((res) => getSocket().emit("ow_act", a, res));
  return { state, key, me, error, connected, act };
}
