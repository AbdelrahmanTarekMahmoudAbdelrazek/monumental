"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { DUEL_CATEGORIES, duelWinner, getDuelItem, pickDuelPairs, type DuelCategoryId } from "@monumental/shared";
import DuelStage from "./DuelStage";

/**
 * Solo streak: keep picking the right side; one wrong answer ends the run.
 * Best streak per category is remembered in this browser.
 */
const ALL: DuelCategoryId[] = ["movies", "celebs", "older", "area", "population", "rivers", "heavier"];

function loadBest(key: string) {
  try { return Number(localStorage.getItem(`howbig:best:${key}`) ?? 0) || 0; } catch { return 0; }
}
function saveBest(key: string, v: number) {
  try { localStorage.setItem(`howbig:best:${key}`, String(v)); } catch { /* ignore */ }
}

export default function DuelSolo({ initial }: { initial?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="p-10 text-center text-sm text-ink-500">Loading…</div>;
  return <Inner initial={initial} />;
}

function Inner({ initial }: { initial?: string }) {
  const [catKey, setCatKey] = useState<string>(ALL.includes(initial as DuelCategoryId) ? (initial as string) : "mix");
  const cats = catKey === "mix" ? ALL : [catKey as DuelCategoryId];
  const [seed, setSeed] = useState(() => String(Date.now()));
  const [pairs, setPairs] = useState(() => pickDuelPairs(cats, [1, 2, 3], 200, seed));
  const [idx, setIdx] = useState(0);
  const [pick, setPick] = useState<"a" | "b" | null>(null);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(() => loadBest(catKey));
  const [over, setOver] = useState(false);

  const restart = useCallback((key = catKey) => {
    const s = String(Date.now());
    const c = key === "mix" ? ALL : [key as DuelCategoryId];
    setCatKey(key); setSeed(s); setPairs(pickDuelPairs(c, [1, 2, 3], 200, s));
    setIdx(0); setPick(null); setStreak(0); setOver(false); setBest(loadBest(key));
  }, [catKey]);
  void seed;

  const pair = pairs[idx % pairs.length];
  const a = getDuelItem(pair.aId);
  const b = getDuelItem(pair.bId);
  const winner = duelWinner(a, b);

  const onPick = (side: "a" | "b") => {
    if (pick) return;
    setPick(side);
    const right = side === winner;
    setTimeout(() => {
      if (right) {
        const s = streak + 1;
        setStreak(s);
        if (s > best) { setBest(s); saveBest(catKey, s); }
        setIdx((i) => i + 1);
        setPick(null);
      } else {
        setOver(true);
      }
    }, right ? 1700 : 2200);
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 p-3 md:p-4">
      <div className="flex flex-wrap items-center gap-2">
        {[...ALL, "mix" as const].map((k) => (
          <button key={k} onClick={() => restart(k)} className={`rounded-full px-3 py-1.5 text-sm font-bold transition ${catKey === k ? "bg-brand-500 text-white" : "bg-white/70 ring-1 ring-ink-900/10 hover:bg-white dark:bg-ink-900/60 dark:ring-white/10"}`}>
            {k === "mix" ? "🎲 Mix" : `${DUEL_CATEGORIES[k].emoji} ${DUEL_CATEGORIES[k].label}`}
          </button>
        ))}
        <div className="ml-auto flex gap-3 text-sm font-bold">
          <span>Streak <span className="tabular-nums text-brand-600">{streak}</span></span>
          <span className="text-ink-500 dark:text-ink-300">Best <span className="tabular-nums">{best}</span></span>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-3xl shadow-xl ring-1 ring-ink-900/10 dark:ring-white/10" style={{ height: "min(78vh, 680px)", minHeight: 420 }}>
        <DuelStage key={pair.aId + pair.bId} a={a} b={b} myPick={pick} onPick={onPick} winner={pick ? winner : null} className="h-full" />
        {over && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="animate-pop mx-4 max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl dark:bg-ink-900">
              <div className="text-xs font-semibold uppercase tracking-widest text-brand-600">Run over</div>
              <div className="mt-1 text-4xl font-black">{streak} in a row</div>
              <p className="mt-1 text-sm text-ink-500 dark:text-ink-300">{streak >= best && streak > 0 ? "New best! 🎉" : `Your best: ${best}`}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button className="btn-primary" onClick={() => restart()}>Play again</button>
                <Link href="/#duels" className="btn-ghost">Play with friends</Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
