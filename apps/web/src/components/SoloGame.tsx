"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { LEVELS, getLevel, pickSessionPairs, realPercent, roundTo, REVEAL_SECONDS, sizeQuestion, GROUP_LABEL, groupOf, type Monument } from "@monumental/shared";
import { useCatalog } from "@/lib/catalog";
import { sfx } from "@/lib/sound";
import { fmtExact } from "@/lib/format";
import GameStage, { fmtPct } from "./GameStage";

/**
 * Phase-1 single-player practice. Runs the round loop locally (no server) with
 * the same level config, timers, helpers and reveal as multiplayer.
 * Practice points: error ≤2% → 3, ≤5% → 2, ≤10% → 1. Not persisted.
 */
const ROUNDS = 5;

function practicePoints(err: number) {
  return err <= 2 ? 3 : err <= 5 ? 2 : err <= 10 ? 1 : 0;
}

export default function SoloGame(props: { levelId?: number }) {
  // Rounds are seeded randomly, so render only in the browser (avoids a server/client mismatch).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="p-10 text-center text-sm text-ink-500">Loading…</div>;
  return <SoloInner {...props} />;
}

function SoloInner({ levelId: initialLevel = 1 }: { levelId?: number }) {
  const catalog = useCatalog();
  const [levelId, setLevelId] = useState(initialLevel);
  const level = getLevel(levelId);
  const [seed, setSeed] = useState(() => String(Date.now()));
  const pairs = useMemo(() => pickSessionPairs(level, catalog.all(), ROUNDS, seed), [level, seed, catalog]);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<"round" | "reveal" | "done">("round");
  const [guess, setGuess] = useState(50);
  const [locked, setLocked] = useState(false);
  const [endsAt, setEndsAt] = useState(() => Date.now() + level.timerSec * 1000);
  const [left, setLeft] = useState(level.timerSec * 1000);
  const [results, setResults] = useState<{ base: Monument; target: Monument; guess: number; real: number; err: number; pts: number }[]>([]);
  const guessRef = useRef(guess);
  guessRef.current = guess;

  const pair = pairs[idx];
  const base = catalog.get(pair.baseId);
  const target = catalog.get(pair.targetId);

  // timer
  useEffect(() => {
    if (phase !== "round") return;
    const id = setInterval(() => {
      const l = endsAt - Date.now();
      setLeft(Math.max(0, l));
      if (l <= 0) finish();
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, endsAt]);

  function finish() {
    if (phase !== "round") return;
    const real = realPercent(base.heightM, target.heightM);
    const g = guessRef.current;
    const err = roundTo(Math.abs(g - real), 1);
    setResults((r) => [...r, { base, target, guess: g, real: roundTo(real, 1), err, pts: practicePoints(err) }]);
    setPhase("reveal");
    setTimeout(() => next(), REVEAL_SECONDS * 1000);
  }
  function next() {
    if (idx + 1 >= ROUNDS) { setPhase("done"); return; }
    setIdx((i) => i + 1);
    setGuess(50); setLocked(false);
    setEndsAt(Date.now() + level.timerSec * 1000);
    setLeft(level.timerSec * 1000);
    setPhase("round");
    sfx.roundStart();
  }
  function restart(newLevel = levelId) {
    setLevelId(newLevel); setSeed(String(Date.now())); setIdx(0); setResults([]);
    setGuess(50); setLocked(false); setEndsAt(Date.now() + getLevel(newLevel).timerSec * 1000); setPhase("round");
  }

  const last = results[results.length - 1];
  const reveal = phase === "reveal" && last ? { realPct: last.real, guessPct: last.guess, errorPct: last.err, points: last.pts } : null;
  const total = results.reduce((a, r) => a + r.pts, 0);
  const sec = Math.ceil(left / 1000);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 p-3 md:flex-row md:p-4">
      <div className="relative flex flex-1 flex-col overflow-hidden rounded-3xl shadow-xl ring-1 ring-ink-900/10 dark:ring-white/10" style={{ height: "min(72vh, 640px)", minHeight: 380 }}>
        <div className="pointer-events-none absolute left-3 top-3 z-10 hidden rounded-full bg-white/85 px-3 py-1 text-xs font-bold shadow backdrop-blur dark:bg-ink-900/80 sm:block">
          Practice · L{level.id} {level.name} <span className="ml-2 text-ink-500 dark:text-ink-300">Round {Math.min(idx + 1, ROUNDS)}/{ROUNDS}</span>
        </div>
        {phase === "round" && (
          <div className={`absolute right-3 top-3 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-xl font-black tabular-nums shadow dark:bg-ink-900/90 ${sec <= 5 ? "text-rose-500" : ""}`}>{sec}</div>
        )}
        {phase !== "done" ? (
          <GameStage base={base} target={target} guessPct={guess} onGuessChange={(p) => { if (!locked) setGuess(p); }} helpers={level.helpers} reveal={reveal} disabled={locked || phase !== "round"} className="h-full" />
        ) : (
          <div className="flex h-full min-h-[420px] flex-col items-center justify-center bg-gradient-to-b from-sky-200 to-amber-50 p-6 text-center dark:from-ink-900 dark:to-ink-800">
            <div className="text-xs font-semibold uppercase tracking-widest text-brand-600">Practice complete</div>
            <h2 className="mt-1 text-3xl font-black">{total} / {ROUNDS * 3} points</h2>
            <p className="mt-1 text-sm text-ink-500 dark:text-ink-300">Average error {(results.reduce((a, r) => a + r.err, 0) / results.length).toFixed(1)} pts</p>
            <ul className="mt-4 w-full max-w-sm space-y-1 text-left text-sm">
              {results.map((r, i) => (
                <li key={i} className="flex justify-between rounded-lg bg-white/70 px-3 py-1 dark:bg-ink-900/60">
                  <span className="truncate">{r.target.name} vs {r.base.name}</span>
                  <span className="tabular-nums">{fmtPct(r.guess)} → {fmtPct(r.real)} <b className="ml-1">+{r.pts}</b></span>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button onClick={() => restart()} className="rounded-full bg-brand-500 px-5 py-2 font-bold text-white hover:bg-brand-600">Play again</button>
              {levelId < LEVELS.length && <button onClick={() => restart(levelId + 1)} className="rounded-full bg-ink-800 px-5 py-2 font-bold text-white dark:bg-white dark:text-ink-900">Next level →</button>}
              <Link href={`/play/${levelId}`} className="rounded-full border border-ink-300 px-5 py-2 font-bold dark:border-ink-600">Go multiplayer</Link>
            </div>
          </div>
        )}
        {phase === "round" && (
          <div className="absolute bottom-14 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1">
            <button onClick={() => { setLocked(true); sfx.lock(); finish(); }} disabled={locked} className="rounded-full bg-brand-500 px-8 py-3 text-base font-black text-white shadow-lg hover:bg-brand-600 active:scale-95 disabled:bg-emerald-500">
              {locked ? "✓ Locked" : "Lock in"}
            </button>
          </div>
        )}
      </div>
      <aside className="flex w-full flex-col gap-3 md:w-72">
        <div className="rounded-2xl bg-white/80 p-3 shadow backdrop-blur dark:bg-ink-900/70">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-300">Level</div>
          <select value={levelId} onChange={(e) => restart(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-sm dark:border-ink-700 dark:bg-ink-800">
            {LEVELS.map((l) => <option key={l.id} value={l.id}>L{l.id} · {l.name} ({l.timerSec}s)</option>)}
          </select>
          <p className="mt-2 text-xs text-ink-500 dark:text-ink-300">{level.tagline}</p>
          <div className="mt-3 text-sm">Score: <b className="tabular-nums">{total}</b></div>
        </div>
        {phase === "round" && (
          <div className="rounded-2xl bg-white/80 p-3 text-xs text-ink-600 shadow backdrop-blur dark:bg-ink-900/70 dark:text-ink-200">
            <div className="font-semibold text-ink-800 dark:text-ink-50">{sizeQuestion(target)}</div>
            <div className="mt-1">{target.country} · {GROUP_LABEL[groupOf(target)]}</div>
            <div className="mt-2 border-t border-ink-100 pt-2 dark:border-ink-700">Base: <b>{base.name}</b> ({fmtExact(base.heightM)})</div>
          </div>
        )}
        {phase === "reveal" && <div className="animate-rise rounded-2xl bg-brand-500/10 p-3 text-xs"><span className="font-semibold">Did you know?</span> {target.funFact}</div>}
      </aside>
    </div>
  );
}
