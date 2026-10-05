"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_OW_SETTINGS, OW_TIMER_CHOICES, type OwSettings } from "@monumental/shared";
import { getSocket } from "@/lib/socket";
import { getGuestId, getNickname, setNickname } from "@/lib/identity";
import { Rules } from "./OneWordGame";

const SAMPLE: { w: string; c: string }[] = [
  { w: "OCEAN", c: "bg-sky-500" }, { w: "CASTLE", c: "bg-[#efe6d2] !text-ink-900" }, { w: "TIGER", c: "bg-rose-500" },
  { w: "SHELL", c: "bg-sky-500" }, { w: "ROBOT", c: "bg-ink-900" },
];

/** /oneword — create a game (you're the host) or join one by code. */
export default function OneWordHome() {
  const router = useRouter();
  const [nick, setNick] = useState("");
  const [settings, setSettings] = useState<OwSettings>(DEFAULT_OW_SETTINGS);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setNick(getNickname()), []);

  const create = async () => {
    setBusy(true); setErr(null);
    const name = nick.trim() || getNickname();
    setNickname(name);
    const token = await fetch("/api/socket-token").then((r) => r.json()).then((d) => d.token ?? undefined).catch(() => undefined);
    getSocket().emit("ow_create", { settings, nickname: name, guestId: getGuestId(), userToken: token }, (a) => {
      setBusy(false);
      if (!a.ok || !a.code) return setErr(a.error ?? "Could not create the game — is the game server awake? Try again in 30 s.");
      router.push(`/oneword/${a.code}`);
    });
  };
  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase().replace(/.*\/ONEWORD\//, "");
    if (!/^[A-Z0-9]{4,10}$/.test(c)) return setErr("Enter the game code from the invite link");
    setNickname(nick.trim() || getNickname());
    router.push(`/oneword/${c}`);
  };

  return (
    <div className="min-h-[calc(100vh-56px)] bg-gradient-to-b from-[#16233a] to-[#121b2c] px-3 py-8 text-white md:px-4">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-wrap gap-1.5">
          {SAMPLE.map((s) => <span key={s.w} className={`rounded-lg px-3 py-1.5 text-sm font-black text-white shadow-[0_3px_0_rgba(0,0,0,.35)] ${s.c}`}>{s.w}</span>)}
        </div>
        <h1 className="mt-4 text-4xl font-black">ONE WORD</h1>
        <p className="mt-1 max-w-2xl text-white/80">Two teams, 25 words, one clue at a time. Your Spymaster links as many of your words as possible with a single word — guess right, dodge the other team&apos;s words, and never touch the 💣.</p>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl bg-white/5 p-5 ring-1 ring-white/10">
            <h2 className="text-lg font-black">Start a game</h2>
            <label className="mt-3 block text-xs font-bold uppercase tracking-wider text-white/60">Your name</label>
            <input className="mt-1 w-full rounded-xl bg-black/30 px-3 py-2" maxLength={20} value={nick} onChange={(e) => setNick(e.target.value)} />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-white/60">Timer</label>
                <select className="mt-1 w-full rounded-xl bg-black/30 px-3 py-2 text-sm" value={settings.timerSec} onChange={(e) => setSettings({ ...settings, timerSec: Number(e.target.value) })}>
                  {OW_TIMER_CHOICES.map((s) => <option key={s} value={s}>{s === 0 ? "No timer" : s % 60 === 0 ? `${s / 60} min` : `${s}s`}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-white/60">Words</label>
                <select className="mt-1 w-full rounded-xl bg-black/30 px-3 py-2 text-sm" value={settings.pack} onChange={(e) => setSettings({ ...settings, pack: e.target.value as OwSettings["pack"] })}>
                  <option value="standard">Standard</option>
                  <option value="easy">Easy</option>
                  <option value="mixed">Mixed</option>
                </select>
              </div>
            </div>
            <button className="btn-primary mt-4 w-full" data-testid="ow-create" disabled={busy} onClick={create}>{busy ? "Creating…" : "Create game & get invite link →"}</button>
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
