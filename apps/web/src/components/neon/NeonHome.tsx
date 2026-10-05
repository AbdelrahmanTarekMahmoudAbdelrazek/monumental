"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_NEON_SETTINGS, type NeonSettings } from "@monumental/shared";
import { getSocket } from "@/lib/socket";
import { getGuestId, getNickname, setNickname } from "@/lib/identity";
import { Rules } from "./NeonGame";

/** /neon — create an arena (you're the host) or join one by code. */
export default function NeonHome() {
  const router = useRouter();
  const [nick, setNick] = useState("");
  const [settings, setSettings] = useState<NeonSettings>(DEFAULT_NEON_SETTINGS);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setNick(getNickname()), []);

  const create = async () => {
    setBusy(true); setErr(null);
    const name = nick.trim() || getNickname();
    setNickname(name);
    const token = await fetch("/api/socket-token").then((r) => r.json()).then((d) => d.token ?? undefined).catch(() => undefined);
    getSocket().emit("nd_create", { settings, nickname: name, guestId: getGuestId(), userToken: token }, (a) => {
      setBusy(false);
      if (!a.ok || !a.code) return setErr(a.error ?? "Could not create the arena — is the game server awake? Try again in 30 s.");
      router.push(`/neon/${a.code}`);
    });
  };
  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase().replace(/.*\/NEON\//, "");
    if (!/^[A-Z0-9]{4,10}$/.test(c)) return setErr("Enter the arena code from the invite link");
    setNickname(nick.trim() || getNickname());
    router.push(`/neon/${c}`);
  };

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[radial-gradient(ellipse_at_top,#1b1040,#05070f_65%)] px-3 py-8 text-white md:px-4">
      <div className="mx-auto max-w-4xl">
        <svg viewBox="0 0 400 90" className="w-full max-w-xl" aria-hidden>
          {[["#ff7a7a", "M10 70 C 80 70, 90 20, 170 20 S 260 60, 300 40"], ["#7cc4ff", "M10 20 C 60 20, 120 80, 200 75 S 300 30, 360 60"]].map(([c, d]) => (
            <g key={c}>
              <path d={d} fill="none" stroke={c} strokeWidth="14" strokeOpacity=".2" strokeLinecap="round" />
              <path d={d} fill="none" stroke={c} strokeWidth="5" strokeLinecap="round" />
            </g>
          ))}
        </svg>
        <h1 className="mt-2 text-4xl font-black">🏎️ NEON DRIFT</h1>
        <p className="mt-1 max-w-2xl text-white/80">Every car leaves a glowing trail. Touch one — even your own — and you crash. Grab ⛽ gas to make your trail longer, use power-ups, and box your friends in. Last car driving wins.</p>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl bg-white/5 p-5 ring-1 ring-fuchsia-500/30">
            <h2 className="text-lg font-black">Open an arena</h2>
            <label className="mt-3 block text-xs font-bold uppercase tracking-wider text-white/60">Your name</label>
            <input className="mt-1 w-full rounded-xl bg-black/40 px-3 py-2" maxLength={20} value={nick} onChange={(e) => setNick(e.target.value)} />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-xs font-bold uppercase tracking-wider text-white/60">Arena
                <select className="mt-1 block w-full rounded-xl bg-black/40 px-2 py-2 text-sm normal-case" value={settings.arena} onChange={(e) => setSettings({ ...settings, arena: e.target.value as NeonSettings["arena"] })}>
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </select>
              </label>
              <label className="text-xs font-bold uppercase tracking-wider text-white/60">Bots
                <select className="mt-1 block w-full rounded-xl bg-black/40 px-2 py-2 text-sm normal-case" value={settings.bots} onChange={(e) => setSettings({ ...settings, bots: Number(e.target.value) })}>
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
            <button className="btn mt-4 w-full bg-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/30 hover:bg-fuchsia-400" data-testid="nd-create" disabled={busy} onClick={create}>{busy ? "Opening…" : "Open arena & get invite link →"}</button>
          </div>
          <form className="rounded-3xl bg-white/5 p-5 ring-1 ring-white/10" onSubmit={join}>
            <h2 className="text-lg font-black">Join an arena</h2>
            <p className="mt-1 text-sm text-white/70">Got an invite link? Just open it. Or type the code:</p>
            <input className="mt-3 w-full rounded-xl bg-black/40 px-3 py-2 font-mono uppercase" placeholder="ABCDE" maxLength={60} value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="btn mt-4 w-full border border-white/30 text-white hover:bg-white/10">Join →</button>
          </form>
        </div>
        {err && <p className="mt-3 text-sm font-semibold text-rose-300">{err}</p>}
        <div className="mt-4 rounded-3xl bg-white/5 p-4 ring-1 ring-white/10"><Rules /></div>
      </div>
    </div>
  );
}
