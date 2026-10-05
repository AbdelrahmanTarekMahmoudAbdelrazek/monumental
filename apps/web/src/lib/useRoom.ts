"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomState, RoundResult, RoundStartPayload, SessionResult, CustomRoomSettings } from "@monumental/shared";
import { getSocket, noteServerNow, syncClock } from "./socket";
import { getGuestId, getNickname } from "./identity";

export interface RoomHook {
  state: RoomState | null;
  playerId: string | null;
  connected: boolean;
  error: string | null;
  lastResult: RoundResult | null;
  sessionResult: SessionResult | null;
  tournamentMsg: { message: string; roomId?: string; status: string } | null;
  /** throttled "live position" while dragging (lock=false) */
  sendGuess: (guessPct: number) => void;
  lockGuess: (guessPct: number) => Promise<{ ok: boolean; error?: string }>;
  /** Duel rounds: tap a side (final answer). */
  pickSide: (side: "a" | "b") => Promise<{ ok: boolean; error?: string }>;
  /** Custom rooms (host only). */
  hostStart: () => Promise<{ ok: boolean; error?: string }>;
  hostUpdate: (settings: Partial<CustomRoomSettings>) => Promise<{ ok: boolean; error?: string }>;
  myLocked: boolean;
}

export function useRoom(target: { roomId?: string; levelId?: number }, userToken?: string | null): RoomHook {
  const [state, setState] = useState<RoomState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<RoundResult | null>(null);
  const [sessionResult, setSessionResult] = useState<SessionResult | null>(null);
  const [tournamentMsg, setTournamentMsg] = useState<RoomHook["tournamentMsg"]>(null);
  const [myLocked, setMyLocked] = useState(false);
  const roundIdRef = useRef<string | null>(null);
  const lastSent = useRef(0);
  const pendingGuess = useRef<number | null>(null);
  const throttleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const s = getSocket();
    let cancelled = false;

    const join = () => {
      s.emit(
        "join_room",
        { roomId: target.roomId, levelId: target.levelId, nickname: getNickname(), guestId: getGuestId(), userToken: userToken ?? undefined },
        (ack) => {
          if (cancelled) return;
          if (!ack.ok || !ack.state) { setError(ack.error ?? "Could not join"); return; }
          setError(null);
          setPlayerId(ack.playerId ?? null);
          noteServerNow(ack.state.serverNow);
          applyState(ack.state);
          void syncClock();
        },
      );
    };

    const applyState = (st: RoomState) => {
      setState(st);
      if (st.round) {
        if (roundIdRef.current !== st.round.roundId) { roundIdRef.current = st.round.roundId; setMyLocked(false); }
      }
      if (st.phase === "reveal" && st.result) setLastResult(st.result);
      if (st.phase === "finished" && st.sessionResult) setSessionResult(st.sessionResult);
      if (st.phase === "lobby") { setSessionResult(null); setLastResult(null); }
    };

    const onConnect = () => { setConnected(true); join(); };
    const onDisconnect = () => setConnected(false);
    const onState = (st: RoomState) => applyState(st);
    const onRoundStart = (p: RoundStartPayload) => { roundIdRef.current = p.roundId; setMyLocked(false); setLastResult(null); };
    const onResult = (r: RoundResult) => setLastResult(r);
    const onSession = (r: SessionResult) => setSessionResult(r);
    const onLocked = (p: { playerId: string; locked: boolean }) =>
      setState((st) => (st ? { ...st, players: st.players.map((pl) => (pl.id === p.playerId ? { ...pl, locked: p.locked } : pl)) } : st));
    const onTournament = (t: { message: string; roomId?: string; status: string }) => setTournamentMsg(t);
    const onErr = (e: { message: string }) => setError(e.message);

    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("room_state", onState);
    s.on("round_start", onRoundStart);
    s.on("round_result", onResult);
    s.on("session_end", onSession);
    s.on("player_locked", onLocked);
    s.on("tournament_update", onTournament);
    s.on("error_msg", onErr);
    if (s.connected) onConnect();

    return () => {
      cancelled = true;
      s.emit("leave_room");
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("room_state", onState);
      s.off("round_start", onRoundStart);
      s.off("round_result", onResult);
      s.off("session_end", onSession);
      s.off("player_locked", onLocked);
      s.off("tournament_update", onTournament);
      s.off("error_msg", onErr);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.roomId, target.levelId, userToken]);

  const flush = useCallback(() => {
    const rid = roundIdRef.current;
    if (rid == null || pendingGuess.current == null) return;
    getSocket().emit("submit_guess", { roundId: rid, guessPct: pendingGuess.current, lock: false });
    pendingGuess.current = null;
    lastSent.current = Date.now();
  }, []);

  const sendGuess = useCallback((guessPct: number) => {
    pendingGuess.current = guessPct;
    const since = Date.now() - lastSent.current;
    if (since >= 120) flush();
    else if (!throttleTimer.current) throttleTimer.current = setTimeout(() => { throttleTimer.current = null; flush(); }, 120 - since);
  }, [flush]);

  const lockGuess = useCallback((guessPct: number) => {
    const rid = roundIdRef.current;
    if (!rid) return Promise.resolve({ ok: false, error: "No round" });
    pendingGuess.current = null;
    return new Promise<{ ok: boolean; error?: string }>((res) => {
      getSocket().emit("submit_guess", { roundId: rid, guessPct, lock: true }, (a) => {
        if (a.ok) setMyLocked(true);
        res(a);
      });
    });
  }, []);

  const pickSide = useCallback((side: "a" | "b") => {
    const rid = roundIdRef.current;
    if (!rid) return Promise.resolve({ ok: false, error: "No round" });
    return new Promise<{ ok: boolean; error?: string }>((res) => {
      getSocket().emit("submit_guess", { roundId: rid, pick: side, lock: true }, (a) => {
        if (a.ok) setMyLocked(true);
        res(a);
      });
    });
  }, []);

  const hostStart = useCallback(
    () => new Promise<{ ok: boolean; error?: string }>((res) => getSocket().emit("host_start", res)),
    [],
  );
  const hostUpdate = useCallback(
    (settings: Partial<CustomRoomSettings>) => new Promise<{ ok: boolean; error?: string }>((res) => getSocket().emit("host_update", { settings }, res)),
    [],
  );

  return { state, playerId, connected, error, lastResult, sessionResult, tournamentMsg, sendGuess, lockGuess, pickSide, hostStart, hostUpdate, myLocked };
}
