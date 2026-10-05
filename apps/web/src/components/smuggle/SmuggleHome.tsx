"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_SMUGGLE_SETTINGS, type SmuggleSettings } from "@monumental/shared";
import { getSocket } from "@/lib/socket";
import { getGuestId, getNickname, setNickname } from "@/lib/identity";
import { Rules } from "./SmuggleGame";

/** /smugglers — create a game (you're the host) or join one by code. */
export default function SmuggleHome() {
  const router = useRouter();
  const [nick, setNick] = useState("");
  const [settings, setSettings] = useState<SmuggleSettings>(DEFAULT_SMUGGLE_SETTINGS);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setNick(getNickname()), []);

  const create = async () => {
    setBusy(true); setErr(null);
    const name = nick.trim() || getNickname();
    setNickname(name);
    const token = await fetch("/api/socket-token").then((r) => r.json()).then((d) => d.token ?? undefined).catch(() => undefined);
    getSocket().emit("sm_create", { settings, nickname: name, guestId: getGuestId(), userToken: token }, (a) => {
      setBusy(false);
      if (!a.ok || !a.code) return setErr(a.error ?? "Could not create the game — is the game server awake? Try again in 30 s.");
      router.push(`/smugglers/${a.code}`);
    });
  };
  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase().replace(/.*\/SMUGGLERS\//, "");
    if (!/^[A-Z0-9]{4,10}$/.test(c)) return setErr("Enter the game code from the invite link");
    setNickname(nick.trim() || getNickname());
    router.push(`/smugglers/${c}`);
  };

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[radial-gradient(ellipse_at_top,#2a2140,#120e1c_70%)] px-3 py-8 text-white md:px-4">
      <div className="mx-auto max-w-4xl">
        <div className="rounded-3xl bg-[#fbf6ea] p-5 font-serif text-lg leading-relaxed text-ink-900 shadow-2xl md:w-3/4 md:-rotate-1">
          “The guard whispered: <i>is that a</i> <mark className="rounded bg-amber-300 px-1 font-black">giraffe</mark>?”
          <div className="mt-1 font-sans text-xs font-bold uppercase tracking-wider text-ink-400">— a story written by 5 friends</div>
        </div>
        <h1 className="mt-6 text-4xl font-black">📦 SMUGGLERS</h1>
        <p className="mt-1 max-w-2xl text-white/80">Write a story together, one sentence each — while secretly sneaking your word into it. Then catch everyone else&apos;s. Part storytelling, part bluffing, part detective game. 3–10 players.</p>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl bg-white/5 p-5 ring-1 ring-white/10">
            <h2 className="text-lg font-black">Start a game</h2>
            <label className="mt-3 block text-xs font-bold uppercase tracking-wider text-white/60">Your name</label>
            <input className="mt-1 w-full rounded-xl bg-black/30 px-3 py-2" maxLength={20} value={nick} onChange={(e) => setNick(e.target.value)} />
            <div className="mt-3 grid grid-cols-3 gap-2">
              <label className="text-xs font-bold uppercase tracking-wider text-white/60">Laps
                <select className="mt-1 block w-full rounded-xl bg-black/30 px-2 py-2 text-sm normal-case" value={settings.laps} onChange={(e) => setSettings({ ...settings, laps: Number(e.target.value) })}>
                  {[2, 3, 4, 5].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold uppercase tracking-wider text-white/60">Time
                <select className="mt-1 block w-full rounded-xl bg-black/30 px-2 py-2 text-sm normal-case" value={settings.turnSec} onChange={(e) => setSettings({ ...settings, turnSec: Number(e.target.value) })}>
                  {[30, 45, 60, 90].map((v) => <option key={v} value={v}>{v}s</option>)}
                </select>
              </label>
              <label className="text-xs font-bold uppercase tracking-wider text-white/60">Words
                <select className="mt-1 block w-full rounded-xl bg-black/30 px-2 py-2 text-sm normal-case" value={settings.wordsPer} onChange={(e) => setSettings({ ...settings, wordsPer: Number(e.target.value) === 2 ? 2 : 1 })}>
                  <option value={1}>1 each</option>
                  <option value={2}>2 each</option>
                </select>
              </label>
            </div>
            <button className="btn-primary mt-4 w-full" data-testid="sm-create" disabled={busy} onClick={create}>{busy ? "Creating…" : "Create game & get invite link →"}</button>
          </div>
          <form className="rounded-3xl bg-white/5 p-5 ring-1 ring-white/10" onSubmit={join}>
            <h2 className="text-lg font-black">Join a game</h2>
            <p className="mt-1 text-sm text-white/70">Got an invite link? Just open it. Or type the game code:</p>
            <input className="mt-3 w-full rounded-xl bg-black/30 px-3 py-2 font-mono uppercase" placeholder="ABCDE" maxLength={60} value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="btn mt-4 w-full border border-white/30 text-white hover:bg-white/10">Join →</button>
          </form>
        </div>
        {err && <p className="mt-3 text-sm font-semibold text-rose-300">{err}</p>}
        <Rules />
      </div>
    </div>
  );
}
