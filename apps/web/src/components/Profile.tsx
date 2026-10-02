"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getGuestId, getNickname, setNickname } from "@/lib/identity";
import { LEVELS } from "@monumental/shared";

interface Data {
  playerKey: string;
  user: { email?: string | null; nickname?: string | null; name?: string | null; role: string } | null;
  stats: { gamesPlayed: number; wins: number; totalPoints: number; roundsPlayed: number; avgError: number | null; bestError: number | null };
  history: { id: string; levelId: number; points: number; rank: number; playersCount: number; avgError: number; won: boolean; createdAt: string; tournament?: { name: string } | null }[];
  tournaments: { id: string; qualifyingPoints: number; finalPoints: number; finalRank: number | null; advanced: boolean; tournament: { id: string; name: string; status: string } }[];
}

export default function Profile({ signedIn, authEnabled }: { signedIn: boolean; authEnabled: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [nick, setNick] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setNick(getNickname());
    fetch(`/api/profile?guestId=${encodeURIComponent(getGuestId())}`).then((r) => r.json()).then(setData).catch(() => {});
  }, []);
  const save = async () => {
    setNickname(nick);
    if (signedIn) await fetch("/api/profile", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ nickname: nick }) });
    setSaved(true); setTimeout(() => setSaved(false), 1500);
  };
  const s = data?.stats;
  return (
    <div className="mx-auto max-w-3xl px-3 py-6 md:px-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black">{data?.user?.nickname ?? data?.user?.name ?? nick}</h1>
          <p className="text-sm text-ink-500 dark:text-ink-300">{signedIn ? data?.user?.email : "Guest — stats are tied to this browser."}</p>
        </div>
        {!signedIn && authEnabled && <Link href="/auth/signin" className="btn-primary">Sign in to save your stats</Link>}
        {signedIn && <form action="/api/auth/signout" method="post"><button className="btn-ghost">Sign out</button></form>}
      </div>

      <div className="card mt-4 flex flex-wrap items-end gap-2">
        <div className="flex-1"><label className="label">Nickname</label><input className="input" value={nick} maxLength={20} onChange={(e) => setNick(e.target.value)} /></div>
        <button className="btn-primary" onClick={save}>{saved ? "Saved ✓" : "Save"}</button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Games played" value={s?.gamesPlayed ?? 0} />
        <Stat label="Wins" value={s?.wins ?? 0} />
        <Stat label="Avg error" value={s?.avgError != null ? `±${s.avgError.toFixed(1)}` : "—"} />
        <Stat label="Best accuracy" value={s?.bestError != null ? `±${s.bestError.toFixed(1)}` : "—"} />
      </div>

      <div className="card mt-4">
        <h2 className="font-black">Recent sessions</h2>
        <ul className="mt-2 divide-y divide-ink-100 text-sm dark:divide-ink-800">
          {data?.history.map((h) => (
            <li key={h.id} className="flex items-center justify-between py-2">
              <span>{h.won ? "🏆 " : ""}L{h.levelId} {LEVELS.find((l) => l.id === h.levelId)?.name}{h.tournament ? ` · ${h.tournament.name}` : ""}<span className="ml-2 text-xs text-ink-400">{new Date(h.createdAt).toLocaleString()}</span></span>
              <span className="tabular-nums">#{h.rank}/{h.playersCount} · <b>{h.points} pts</b> · ±{h.avgError.toFixed(1)}</span>
            </li>
          ))}
          {data && data.history.length === 0 && <li className="py-3 text-ink-400">No sessions yet.</li>}
        </ul>
      </div>

      {data && data.tournaments.length > 0 && (
        <div className="card mt-4">
          <h2 className="font-black">Tournaments</h2>
          <ul className="mt-2 divide-y divide-ink-100 text-sm dark:divide-ink-800">
            {data.tournaments.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2">
                <Link href={`/tournaments/${t.tournament.id}`} className="font-semibold hover:underline">{t.tournament.name}</Link>
                <span className="tabular-nums text-xs">{t.tournament.status} · Q {t.qualifyingPoints}{t.advanced ? ` · F ${t.finalPoints}${t.finalRank ? ` · #${t.finalRank}` : ""}` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="card !p-4"><div className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-300">{label}</div><div className="mt-1 text-2xl font-black tabular-nums">{value}</div></div>;
}
