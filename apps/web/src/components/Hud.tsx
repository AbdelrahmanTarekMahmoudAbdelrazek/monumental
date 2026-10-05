"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getLevel, type PlayerPublic, type RoomState, type RoundResult, type SessionResult, type LevelConfig } from "@monumental/shared";
import { serverNow } from "@/lib/socket";
import { sfx } from "@/lib/sound";
import { fmtPct } from "./GameStage";

/** Server-clock countdown. */
export function useCountdown(endsAt: number) {
  const [left, setLeft] = useState(() => Math.max(0, endsAt - serverNow()));
  useEffect(() => {
    let last = -1;
    const id = setInterval(() => {
      const l = Math.max(0, endsAt - serverNow());
      setLeft(l);
      const s = Math.ceil(l / 1000);
      if (s !== last && s <= 3 && s > 0) sfx.countdown();
      last = s;
    }, 100);
    return () => clearInterval(id);
  }, [endsAt]);
  return left;
}

export function TimerRing({ endsAt, totalMs }: { endsAt: number; totalMs: number }) {
  const left = useCountdown(endsAt);
  const frac = totalMs > 0 ? Math.min(1, left / totalMs) : 0;
  const r = 20, c = 2 * Math.PI * r;
  const sec = Math.ceil(left / 1000);
  const urgent = sec <= 5;
  return (
    <div className="relative h-14 w-14">
      <svg viewBox="0 0 48 48" className="h-14 w-14 -rotate-90">
        <circle cx="24" cy="24" r={r} className="fill-none stroke-ink-200 dark:stroke-ink-700" strokeWidth="5" />
        <circle cx="24" cy="24" r={r} className={`fill-none ${urgent ? "stroke-rose-500" : "stroke-brand-500"} transition-[stroke-dashoffset] duration-100`} strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
      </svg>
      <div className={`absolute inset-0 flex items-center justify-center text-lg font-black tabular-nums ${urgent ? "text-rose-500" : "text-ink-800 dark:text-ink-50"}`}>{sec}</div>
    </div>
  );
}

export function PlayersPanel({ players, me, phase }: { players: PlayerPublic[]; me: string | null; phase: RoomState["phase"] }) {
  const sorted = [...players].sort((a, b) => b.totalPoints - a.totalPoints || a.nickname.localeCompare(b.nickname));
  return (
    <div className="rounded-2xl bg-white/80 p-3 shadow backdrop-blur dark:bg-ink-900/70">
      <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-300">
        <span>Players</span>
        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-700 dark:text-emerald-300">● {players.filter((p) => p.connected).length} live</span>
      </div>
      <ul className="max-h-64 space-y-1 overflow-auto text-sm">
        {sorted.map((p) => (
          <li key={p.id} className={`flex items-center justify-between rounded-lg px-2 py-1 ${p.id === me ? "bg-brand-500/10" : ""} ${!p.connected ? "opacity-50" : ""}`}>
            <span className="flex items-center gap-2 truncate">
              <span className={`inline-block h-2 w-2 rounded-full ${phase === "round" ? (p.locked ? "bg-emerald-500" : "bg-amber-400 animate-pulse") : "bg-ink-300"}`} title={p.locked ? "Locked in" : "Thinking…"} />
              <span className="truncate font-medium">{p.nickname}{p.id === me ? " (you)" : ""}</span>
              {p.isGuest && <span className="text-[10px] text-ink-400">guest</span>}
            </span>
            <span className="tabular-nums font-bold text-ink-700 dark:text-ink-100">{p.totalPoints}</span>
          </li>
        ))}
        {players.length === 0 && <li className="px-2 py-1 text-ink-400">Nobody here yet</li>}
      </ul>
    </div>
  );
}

export function RoundLeaderboard({ result, me }: { result: RoundResult; me: string | null }) {
  return (
    <div className="animate-rise rounded-2xl bg-white/90 p-3 shadow backdrop-blur dark:bg-ink-900/80">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-300">Round {result.roundIndex + 1} results</div>
      <ol className="space-y-1 text-sm">
        {result.entries.map((e, i) => (
          <li key={e.playerId} className={`flex items-center justify-between rounded-lg px-2 py-1 ${e.playerId === me ? "bg-brand-500/10" : ""}`}>
            <span className="flex items-center gap-2">
              <span className="w-5 text-center text-xs font-bold text-ink-400">{e.rank ?? "–"}</span>
              <span className="font-medium">{e.nickname}</span>
              {i === 0 && e.points === 3 && <span>🏆</span>}
            </span>
            <span className="flex items-center gap-3 tabular-nums">
              <span className="text-xs text-ink-500 dark:text-ink-300">
                {result.duel
                  ? e.pick == null ? "no answer" : e.correct ? `✓ ${((e.ms ?? 0) / 1000).toFixed(1)}s` : "✗ wrong"
                  : e.guessPct == null ? "no guess" : `${fmtPct(e.guessPct)} · ±${e.errorPct?.toFixed(1)}`}
              </span>
              <span className={`rounded-full px-2 text-xs font-bold ${e.points === 3 ? "bg-emerald-500 text-white" : e.points === 1 ? "bg-amber-400 text-ink-900" : "bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-300"}`}>+{e.points}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function LobbyOverlay({ state, level }: { state: RoomState; level: LevelConfig }) {
  const left = useCountdown(state.phaseEndsAt);
  const waiting = state.phaseEndsAt === 0;
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-ink-950/50 backdrop-blur-sm">
      <div className="animate-pop mx-4 max-w-md rounded-3xl bg-white p-6 text-center shadow-2xl dark:bg-ink-900">
        <div className="text-xs font-semibold uppercase tracking-widest text-brand-600">Level {level.id} · {level.name}</div>
        <h2 className="mt-1 text-2xl font-black">{state.tournament ? `${state.tournament.name} — ${state.tournament.stageName}` : "Next session starting"}</h2>
        <p className="mt-2 text-sm text-ink-500 dark:text-ink-300">{level.tagline}</p>
        <div className="mt-4 text-5xl font-black tabular-nums text-brand-500">{waiting ? "…" : Math.ceil(left / 1000)}</div>
        <p className="mt-2 text-xs text-ink-500 dark:text-ink-300">{state.players.length} player{state.players.length === 1 ? "" : "s"} in the room · {state.roundsPerSession} rounds · {level.timerSec}s each</p>
      </div>
    </div>
  );
}

export function SessionEndOverlay({ result, me, state }: { result: SessionResult; me: string | null; state: RoomState }) {
  const left = useCountdown(state.phaseEndsAt);
  const winner = result.leaderboard[0];
  const duel = getLevel(result.levelId).kind === "duel";
  const mine = result.leaderboard.find((p) => p.playerId === me);
  const myRank = result.leaderboard.findIndex((p) => p.playerId === me) + 1;
  useEffect(() => { if (result.winnerId === me) sfx.win(); }, [result.winnerId, me]);
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center overflow-auto bg-ink-950/60 backdrop-blur-sm">
      <div className="animate-pop mx-4 w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-ink-900">
        <div className="text-center">
          <div className="text-xs font-semibold uppercase tracking-widest text-brand-600">Session over</div>
          <h2 className="mt-1 text-2xl font-black">{winner && result.winnerId ? `🏆 ${winner.nickname} wins!` : "No winner this time"}</h2>
          {mine && <p className="mt-1 text-sm text-ink-500 dark:text-ink-300">You finished #{myRank} with {mine.totalPoints} pts · {duel ? `${Math.round(100 - mine.avgError)}% correct` : `avg error ${mine.avgError.toFixed(1)}`}</p>}
        </div>
        <ol className="mt-4 space-y-1 text-sm">
          {result.leaderboard.slice(0, 10).map((p, i) => (
            <li key={p.playerId} className={`flex items-center justify-between rounded-lg px-2 py-1 ${p.playerId === me ? "bg-brand-500/10" : ""}`}>
              <span><span className="mr-2 inline-block w-5 text-center text-xs font-bold text-ink-400">{i + 1}</span>{p.nickname}</span>
              <span className="tabular-nums"><span className="mr-2 text-xs text-ink-400">{duel ? `${Math.round(100 - p.avgError)}%` : `±${p.avgError.toFixed(1)}`}</span><b>{p.totalPoints}</b></span>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex items-center justify-between text-xs text-ink-500 dark:text-ink-300">
          <span>{state.tournament ? "Tournament stage complete" : `Next session in ${Math.ceil(left / 1000)}s`}</span>
          <Link href="/" className="font-semibold text-brand-600 hover:underline">Change level →</Link>
        </div>
      </div>
    </div>
  );
}
