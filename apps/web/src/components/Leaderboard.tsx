"use client";
import { useEffect, useState } from "react";

type Period = "daily" | "weekly" | "alltime";
interface Row { rank: number; playerKey: string; nickname: string; points: number; sessions: number; wins: number; isGuest: boolean }

export default function Leaderboard({ compact = false }: { compact?: boolean }) {
  const [period, setPeriod] = useState<Period>("daily");
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    setRows(null);
    fetch(`/api/leaderboard?period=${period}&limit=${compact ? 10 : 50}`).then((r) => r.json()).then((d) => setRows(d.entries ?? [])).catch(() => setRows([]));
  }, [period, compact]);
  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-black">Global leaderboard</h2>
        <div className="flex gap-1 rounded-full bg-ink-100 p-1 text-xs font-bold dark:bg-ink-800">
          {(["daily", "weekly", "alltime"] as Period[]).map((p) => (
            <button key={p} onClick={() => setPeriod(p)} className={`rounded-full px-3 py-1 ${period === p ? "bg-white shadow dark:bg-ink-900" : "text-ink-500"}`}>{p === "alltime" ? "All-time" : p[0].toUpperCase() + p.slice(1)}</button>
          ))}
        </div>
      </div>
      <table className="mt-4 w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-ink-500 dark:text-ink-300"><tr><th className="pb-2">#</th><th className="pb-2">Player</th><th className="pb-2 text-right">Points</th><th className="pb-2 text-right">Sessions</th><th className="pb-2 text-right">Wins</th></tr></thead>
        <tbody>
          {rows === null && <tr><td colSpan={5} className="py-6 text-center text-ink-400">Loading…</td></tr>}
          {rows?.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-ink-400">No results yet — play a session!</td></tr>}
          {rows?.map((r) => (
            <tr key={r.playerKey} className="border-t border-ink-100 dark:border-ink-800">
              <td className="py-2 font-bold text-ink-400">{r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : r.rank}</td>
              <td className="py-2 font-semibold">{r.nickname}{r.isGuest && <span className="ml-1 text-[10px] font-normal text-ink-400">guest</span>}</td>
              <td className="py-2 text-right tabular-nums font-black">{r.points}</td>
              <td className="py-2 text-right tabular-nums">{r.sessions}</td>
              <td className="py-2 text-right tabular-nums">{r.wins}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
