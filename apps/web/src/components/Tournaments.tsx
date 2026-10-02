"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { LEVELS } from "@monumental/shared";
import { getGuestId, getNickname } from "@/lib/identity";

interface T {
  id: string; name: string; levelId: number; startsAt: string; status: string; isPrivate: boolean; inviteCode?: string;
  qualifyingRounds: number; finalRounds: number; advanceCount: number; entries: number; winnerName?: string | null;
}

const STATUS_LABEL: Record<string, string> = { SCHEDULED: "Scheduled", REGISTRATION: "Registration open", QUALIFYING: "Qualifying – live", FINAL: "Final – live", FINISHED: "Finished", CANCELLED: "Cancelled" };

export default function Tournaments({ signedIn }: { signedIn: boolean }) {
  const [list, setList] = useState<T[] | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = (c = code) => fetch(`/api/tournaments${c ? `?code=${encodeURIComponent(c)}` : ""}`).then((r) => r.json()).then((d) => setList(d.tournaments ?? [])).catch(() => setList([]));
  useEffect(() => { load(""); const id = setInterval(() => load(), 15000); return () => clearInterval(id); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  const register = async (t: T) => {
    setMsg(null);
    const r = await fetch(`/api/tournaments/${t.id}/register`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ guestId: getGuestId(), nickname: getNickname(), inviteCode: t.inviteCode ?? code }),
    });
    const d = await r.json();
    setMsg(r.ok ? `Registered for ${t.name} as ${d.entry.nickname}. Keep a game tab open at start time — you'll be sent to your qualifier room.` : d.error ?? "Failed");
    load();
  };

  return (
    <div className="mx-auto max-w-4xl px-3 py-6 md:px-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black">Tournaments</h1>
          <p className="mt-1 text-sm text-ink-600 dark:text-ink-200">Qualifiers → top players advance → final. Hourly opens run automatically.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate((s) => !s)}>{showCreate ? "Close" : "Create private tournament"}</button>
      </div>

      {showCreate && <CreateForm signedIn={signedIn} onCreated={(t) => { setShowCreate(false); setCode(t.inviteCode ?? ""); setMsg(t.inviteCode ? `Created! Invite code: ${t.inviteCode} — share the link ${window.location.origin}/tournaments?code=${t.inviteCode}` : "Created!"); load(t.inviteCode ?? ""); }} />}

      <form className="card mt-4 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); load(code); }}>
        <div><label className="label">Have an invite code?</label><input className="input w-40 uppercase tracking-widest" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC123" maxLength={8} /></div>
        <button className="btn-ghost" type="submit">Find private tournament</button>
      </form>

      {msg && <div className="mt-3 animate-rise rounded-2xl bg-brand-500/10 p-3 text-sm">{msg}</div>}

      <div className="mt-4 space-y-3">
        {list === null && <div className="text-ink-400">Loading…</div>}
        {list?.length === 0 && <div className="card text-ink-500">No tournaments scheduled. The server creates hourly opens automatically when a database is connected.</div>}
        {list?.map((t) => {
          const lvl = LEVELS.find((l) => l.id === t.levelId);
          const live = t.status === "QUALIFYING" || t.status === "FINAL";
          return (
            <div key={t.id} className="card flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-black">{t.name}</h3>
                  {t.isPrivate && <span className="rounded-full bg-ink-100 px-2 text-[10px] font-bold uppercase dark:bg-ink-800">private</span>}
                  <span className={`rounded-full px-2 text-[10px] font-bold uppercase ${live ? "bg-emerald-500 text-white" : t.status === "FINISHED" ? "bg-ink-200 dark:bg-ink-700" : "bg-brand-500/15 text-brand-700 dark:text-brand-300"}`}>{STATUS_LABEL[t.status] ?? t.status}</span>
                </div>
                <div className="mt-1 text-sm text-ink-600 dark:text-ink-200">
                  L{t.levelId} {lvl?.name} · starts {new Date(t.startsAt).toLocaleString()} · {t.qualifyingRounds}-round qualifiers, top {t.advanceCount} → {t.finalRounds}-round final · {t.entries} registered
                  {t.winnerName && <> · 🏆 <b>{t.winnerName}</b></>}
                </div>
              </div>
              <div className="flex gap-2">
                <Link href={`/tournaments/${t.id}`} className="btn-ghost">Details</Link>
                {(t.status === "SCHEDULED" || t.status === "REGISTRATION") && <button className="btn-primary" onClick={() => register(t)}>Register</button>}
                {live && <Link href="/play/1" className="btn-primary">Open game →</Link>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CreateForm({ signedIn, onCreated }: { signedIn: boolean; onCreated: (t: T) => void }) {
  const [name, setName] = useState("Friday night showdown");
  const [levelId, setLevelId] = useState(3);
  const [startsAt, setStartsAt] = useState(() => { const d = new Date(Date.now() + 10 * 60e3); d.setSeconds(0, 0); return toLocalInput(d); });
  const [isPrivate, setIsPrivate] = useState(true);
  const [q, setQ] = useState(5); const [f, setF] = useState(10); const [adv, setAdv] = useState(8);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    const r = await fetch("/api/tournaments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, levelId, startsAt: new Date(startsAt).toISOString(), isPrivate, qualifyingRounds: q, finalRounds: f, advanceCount: adv }) });
    const d = await r.json();
    if (!r.ok) return setErr(d.error ?? "Failed");
    onCreated(d.tournament);
  };
  return (
    <form onSubmit={submit} className="card mt-4 grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2"><label className="label">Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></div>
      <div><label className="label">Level</label><select className="input" value={levelId} onChange={(e) => setLevelId(Number(e.target.value))}>{LEVELS.map((l) => <option key={l.id} value={l.id}>L{l.id} {l.name}</option>)}</select></div>
      <div><label className="label">Starts at (local)</label><input className="input" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></div>
      <div><label className="label">Qualifying rounds</label><input className="input" type="number" min={3} max={15} value={q} onChange={(e) => setQ(Number(e.target.value))} /></div>
      <div><label className="label">Final rounds</label><input className="input" type="number" min={3} max={20} value={f} onChange={(e) => setF(Number(e.target.value))} /></div>
      <div><label className="label">Players advancing to final</label><input className="input" type="number" min={2} max={50} value={adv} onChange={(e) => setAdv(Number(e.target.value))} /></div>
      <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} disabled={!signedIn} /> Private (invite code){!signedIn && <span className="text-xs text-ink-400">— public tournaments need an admin account</span>}</label>
      {err && <div className="text-sm font-semibold text-rose-500 sm:col-span-2">{err}</div>}
      <div className="sm:col-span-2"><button className="btn-primary" type="submit">Schedule tournament</button></div>
    </form>
  );
}

function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
