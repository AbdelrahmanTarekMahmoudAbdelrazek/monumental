"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getLevel, sizeQuestion, GROUP_LABEL, groupOf, DUEL_MAP } from "@monumental/shared";
import DuelStage from "./DuelStage";
import { useRoom } from "@/lib/useRoom";
import { useCatalog } from "@/lib/catalog";
import { sfx } from "@/lib/sound";
import { fmtExact } from "@/lib/format";
import GameStage from "./GameStage";
import { LobbyOverlay, PlayersPanel, RoundLeaderboard, SessionEndOverlay, TimerRing } from "./Hud";

export default function PlayRoom({ roomId, levelId, userToken }: { roomId?: string; levelId?: number; userToken?: string | null }) {
  const room = useRoom({ roomId, levelId }, userToken);
  const catalog = useCatalog();
  const { state, playerId, lastResult, sessionResult, error, connected, myLocked, tournamentMsg } = room;
  const [guess, setGuess] = useState(50);
  const [lockError, setLockError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const level = useMemo(() => (state ? getLevel(state.levelId) : getLevel(levelId ?? 1)), [state, levelId]);
  const round = state?.round;
  const isDuel = level.kind === "duel";
  const base = round && !isDuel ? catalog.get(round.baseId) : null;
  const target = round && !isDuel ? catalog.get(round.targetId) : null;
  const duelA = round && isDuel ? DUEL_MAP[round.baseId] ?? null : null;
  const duelB = round && isDuel ? DUEL_MAP[round.targetId] ?? null : null;
  const [myPick, setMyPick] = useState<"a" | "b" | null>(null);

  // Reset the handle to a neutral position on each new round.
  useEffect(() => {
    if (round?.roundId) { setGuess(50); setLockError(null); setMyPick(null); sfx.roundStart(); }
  }, [round?.roundId]);

  useEffect(() => {
    if (tournamentMsg) { setToast(tournamentMsg.message); const t = setTimeout(() => setToast(null), 8000); return () => clearTimeout(t); }
  }, [tournamentMsg]);

  const onGuess = (pct: number) => {
    if (myLocked || state?.phase !== "round") return;
    setGuess(pct);
    room.sendGuess(pct);
  };
  const lock = async () => {
    const r = await room.lockGuess(guess);
    if (r.ok) sfx.lock();
    else setLockError(r.error ?? "Could not lock");
  };

  const pick = async (side: "a" | "b") => {
    if (myPick || state?.phase !== "round") return;
    setMyPick(side);
    const r = await room.pickSide(side);
    if (!r.ok) { setMyPick(null); setLockError(r.error ?? "Could not answer"); }
  };

  const myResult = lastResult?.entries.find((e) => e.playerId === playerId) ?? null;
  const duelReveal = isDuel && state?.phase === "reveal" && lastResult?.duel ? lastResult : null;
  const tally = duelReveal
    ? { a: duelReveal.entries.filter((e) => e.pick === "a").length, b: duelReveal.entries.filter((e) => e.pick === "b").length }
    : undefined;
  const reveal =
    state?.phase === "reveal" && lastResult
      ? { realPct: lastResult.realPct, guessPct: myResult?.guessPct ?? null, errorPct: myResult?.errorPct ?? null, points: myResult?.points ?? 0 }
      : null;

  if (error) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h2 className="text-xl font-bold">Couldn&apos;t join</h2>
        <p className="mt-2 text-ink-500">{error}</p>
        <Link href="/" className="mt-4 inline-block rounded-full bg-brand-500 px-5 py-2 font-semibold text-white">Back home</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 p-3 md:flex-row md:p-4">
      {/* stage */}
      <div className="relative flex flex-1 flex-col overflow-hidden rounded-3xl shadow-xl ring-1 ring-ink-900/10 dark:ring-white/10" style={{ height: "min(72vh, 640px)", minHeight: 380 }}>
        {/* top bar */}
        <div className="pointer-events-none absolute left-3 top-3 z-10 hidden items-center gap-3 sm:flex">
          <div className="rounded-full bg-white/85 px-3 py-1 text-xs font-bold shadow backdrop-blur dark:bg-ink-900/80">
            L{level.id} · {level.name}
            {state && state.roundIndex >= 0 && <span className="ml-2 text-ink-500 dark:text-ink-300">Round {state.roundIndex + 1}/{state.roundsPerSession}</span>}
          </div>
          {!connected && <span className="rounded-full bg-rose-500 px-2 py-1 text-xs font-bold text-white">reconnecting…</span>}
        </div>
        <div className="absolute right-3 top-3 z-10">
          {state?.phase === "round" && <TimerRing endsAt={state.phaseEndsAt} totalMs={level.timerSec * 1000} />}
          {state?.phase === "reveal" && <TimerRing endsAt={state.phaseEndsAt} totalMs={8000} />}
        </div>

        {duelA && duelB ? (
          <DuelStage
            a={duelA}
            b={duelB}
            myPick={duelReveal ? (myResult?.pick ?? myPick) : myPick}
            onPick={pick}
            winner={duelReveal?.duel?.winner ?? null}
            disabled={state?.phase !== "round" || myLocked}
            tally={tally}
            className="h-full"
          />
        ) : base && target ? (
          <GameStage base={base} target={target} guessPct={guess} onGuessChange={onGuess} helpers={level.helpers} reveal={reveal} disabled={myLocked || state?.phase !== "round"} className="h-full" />
        ) : (
          <div className="flex h-full min-h-[320px] items-center justify-center bg-gradient-to-b from-sky-200 to-amber-50 dark:from-ink-900 dark:to-ink-800">
            <div className="text-sm text-ink-500">{state ? "Waiting for the next round…" : "Connecting to the room…"}</div>
          </div>
        )}

        {/* lock-in bar */}
        {state?.phase === "round" && !isDuel && (
          <div className="absolute bottom-14 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1">
            <button
              onClick={lock}
              disabled={myLocked}
              className={`rounded-full px-8 py-3 text-base font-black shadow-lg transition active:scale-95 ${myLocked ? "bg-emerald-500 text-white" : "bg-brand-500 text-white hover:bg-brand-600"}`}
            >
              {myLocked ? "✓ Locked in" : "Lock in"}
            </button>
            {lockError && <div className="rounded-full bg-rose-500/90 px-3 py-1 text-xs font-semibold text-white">{lockError}</div>}
            {!myLocked && !lockError && <div className="text-[11px] text-ink-600 dark:text-ink-200">Drag the handle · your last position counts if the timer runs out</div>}
          </div>
        )}

        {isDuel && lockError && <div className="absolute bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-full bg-rose-500 px-3 py-1 text-xs font-semibold text-white">{lockError}</div>}
        {state?.phase === "lobby" && <LobbyOverlay state={state} level={level} />}
        {state?.phase === "finished" && sessionResult && <SessionEndOverlay result={sessionResult} me={playerId} state={state} />}

        {toast && <div className="absolute bottom-20 left-1/2 z-20 -translate-x-1/2 animate-rise rounded-full bg-ink-900 px-4 py-2 text-sm font-semibold text-white shadow-xl dark:bg-white dark:text-ink-900">
          {toast} {tournamentMsg?.roomId && <Link href={`/play/room/${encodeURIComponent(tournamentMsg.roomId)}`} className="ml-2 underline">Join →</Link>}
        </div>}
      </div>

      {/* side panel */}
      <aside className="flex w-full flex-col gap-3 md:w-72">
        {state && <PlayersPanel players={state.players} me={playerId} phase={state.phase} />}
        {state?.phase === "reveal" && lastResult && <RoundLeaderboard result={lastResult} me={playerId} />}
        {base && target && state?.phase === "round" && (
          <div className="rounded-2xl bg-white/80 p-3 text-xs text-ink-600 shadow backdrop-blur dark:bg-ink-900/70 dark:text-ink-200">
            <div className="font-semibold text-ink-800 dark:text-ink-50">{sizeQuestion(target)}</div>
            <div className="mt-1">{target.country} · {GROUP_LABEL[groupOf(target)]}</div>
            <div className="mt-2 border-t border-ink-100 pt-2 dark:border-ink-700">Base: <b>{base.name}</b> ({fmtExact(base.heightM)})<div className="mt-0.5 text-[11px] text-ink-500 dark:text-ink-300">{base.heightNote}</div></div>
          </div>
        )}
        {state?.phase === "reveal" && target && (
          <div className="animate-rise rounded-2xl bg-brand-500/10 p-3 text-xs text-ink-700 dark:text-ink-100">
            <span className="font-semibold">Did you know?</span> {target.funFact}
          </div>
        )}
      </aside>
    </div>
  );
}
