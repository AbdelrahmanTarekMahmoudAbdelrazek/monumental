import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma, withDb } from "@/lib/db";
import { LEVELS } from "@monumental/shared";
import TournamentLive from "@/components/TournamentLive";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await withDb(() => prisma.tournament.findUnique({ where: { id }, include: { entries: { orderBy: [{ finalRank: "asc" }, { finalPoints: "desc" }, { qualifyingPoints: "desc" }] } } }), null);
  if (!t) notFound();
  const lvl = LEVELS.find((l) => l.id === t.levelId);
  const live = t.status === "QUALIFYING" || t.status === "FINAL";
  return (
    <div className="mx-auto max-w-3xl px-3 py-6 md:px-4">
      <Link href="/tournaments" className="text-sm text-brand-600 hover:underline">← All tournaments</Link>
      <h1 className="mt-2 text-3xl font-black">{t.name}</h1>
      <p className="mt-1 text-sm text-ink-600 dark:text-ink-200">
        L{t.levelId} {lvl?.name} · {t.status} · starts {t.startsAt.toLocaleString()} · {t.entries.length} players
        {t.winnerName && <> · 🏆 <b>{t.winnerName}</b></>}
      </p>
      <div className="card mt-4 text-sm">
        <b>Format:</b> qualifiers of {t.qualifyingRounds} rounds in rooms of up to {t.qualifyingRoomSize} → top {t.advanceCount} by points (tie-break: average error) → {t.finalRounds}-round final.
      </div>
      {live && <TournamentLive tournamentId={t.id} />}
      <div className="card mt-4">
        <h2 className="font-black">Standings</h2>
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-xs uppercase text-ink-500"><tr><th>#</th><th>Player</th><th className="text-right">Qualifying</th><th className="text-right">Final</th></tr></thead>
          <tbody>
            {t.entries.map((e, i) => (
              <tr key={e.id} className="border-t border-ink-100 dark:border-ink-800">
                <td className="py-1.5 text-ink-400">{e.finalRank ?? i + 1}</td>
                <td className="py-1.5 font-semibold">{e.nickname}{e.advanced && <span className="ml-1 rounded-full bg-emerald-500/15 px-1.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">finalist</span>}</td>
                <td className="py-1.5 text-right tabular-nums">{e.qualifyingPoints}{e.qualifyingAvgError != null && <span className="ml-1 text-xs text-ink-400">±{e.qualifyingAvgError.toFixed(1)}</span>}</td>
                <td className="py-1.5 text-right tabular-nums font-bold">{e.advanced ? e.finalPoints : "—"}</td>
              </tr>
            ))}
            {t.entries.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-ink-400">No one registered yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
