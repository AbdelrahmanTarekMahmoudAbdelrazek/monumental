"use client";
import { useEffect, useState } from "react";
import type { SmuggleAction, SmugglePublicState } from "@monumental/shared";
import { getSocket, noteServerNow, syncClock } from "./socket";
import { getGuestId, getNickname } from "./identity";

type Ack = { ok: boolean; error?: string };

/** Connects to one SMUGGLERS table: public state, my secret word(s), and actions. */
export function useSmuggle(code: string, userToken?: string | null) {
  const [state, setState] = useState<SmugglePublicState | null>(null);
  const [words, setWords] = useState<string[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const s = getSocket();
    let cancelled = false;
    const join = () =>
      s.emit("sm_join", { code, nickname: getNickname(), guestId: getGuestId(), userToken: userToken ?? undefined }, (a) => {
        if (cancelled) return;
        if (!a.ok || !a.state) { setError(a.error ?? "Could not join"); return; }
        setError(null);
        setMe(a.playerId ?? null);
        setState(a.state);
        setWords(a.words ?? []);
        noteServerNow(a.state.serverNow);
        void syncClock();
      });
    const onConnect = () => { setConnected(true); join(); };
    const onDisconnect = () => setConnected(false);
    const onState = (st: SmugglePublicState) => { if (st.code === code) setState(st); };
    const onSecret = (x: { code: string; words: string[] }) => { if (x.code === code) setWords(x.words); };
    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("sm_state", onState);
    s.on("sm_secret", onSecret);
    if (s.connected) onConnect();
    return () => {
      cancelled = true;
      s.emit("sm_leave");
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("sm_state", onState);
      s.off("sm_secret", onSecret);
    };
  }, [code, userToken]);

  const act = (a: SmuggleAction) => new Promise<Ack>((res) => getSocket().emit("sm_act", a, res));
  return { state, words, me, error, connected, act };
}
