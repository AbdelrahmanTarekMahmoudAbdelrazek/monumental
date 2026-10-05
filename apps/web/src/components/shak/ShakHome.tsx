"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_SHAK_SETTINGS, SHAK_LIMITS, type ShakSettings } from "@monumental/shared";
import { getSocket } from "@/lib/socket";
import { getGuestId, getNickname, setNickname } from "@/lib/identity";
import DominoTile from "./DominoTile";
import { RulesCard } from "./ShakTable";

/** /shak — create a table (you're the host) or join one by code. */
export default function ShakHome() {
  const router = useRouter();
  const [nick, setNick] = useState("");
  const [settings, setSettings] = useState<ShakSettings>(DEFAULT_SHAK_SETTINGS);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setNick(getNickname()), []);

  const create = async () => {
    setBusy(true); setErr(null);
    const name = nick.trim() || getNickname();
    setNickname(name);
    const token = await fetch("/api/socket-token").then((r) => r.json()).then((d) => d.token ?? undefined).catch(() => undefined);
    getSocket().emit("shak_create", { settings, nickname: name, guestId: getGuestId(), userToken: token }, (a) => {
      setBusy(false);
      if (!a.ok || !a.code) return setErr(a.error ?? "Could not create the table — is the game server awake? Try again in 30 s.");
      router.push(`/shak/${a.code}`);
    });
  };
  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase().replace(/.*\/SHAK\//, "");
    if (!/^[A-Z0-9]{4,10}$/.test(c)) return setErr("Enter the table code from the invite link");
    setNickname(nick.trim() || getNickname());
    router.push(`/shak/${c}`);
  };

  return (
    <div className="mx-auto max-w-4xl px-3 py-6 md:px-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex -space-x-3">
          {[27, 6, 20].map((t, i) => <DominoTile key={t} id={i === 1 ? null : t} size={30} style={{ transform: `rotate(${(i - 1) * 12}deg)` }} />)}
        </div>
        <div>
          <h1 className="text-3xl font-black">أشك <span className="text-xl font-bold text-ink-500">· Domino Shak</span></h1>
          <p className="text-sm text-ink-600 dark:text-ink-200">The Egyptian domino bluffing game. Put tiles face-down, claim a number, and catch the liars. 3–7 players, bots fill empty seats.</p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="card">
          <h2 className="text-lg font-black">Start a table · افتح ترابيزة</h2>
          <label className="label mt-3">Your name</label>
          <input className="input" maxLength={20} value={nick} onChange={(e) => setNick(e.target.value)} />
          <label className="label mt-3">Time per turn: {settings.turnSec}s</label>
          <input type="range" className="w-full accent-brand-500" min={SHAK_LIMITS.turnSec.min} max={SHAK_LIMITS.turnSec.max} step={5}
            value={settings.turnSec} onChange={(e) => setSettings({ ...settings, turnSec: Number(e.target.value) })} />
          <label className="label mt-3">Max tiles per play: {settings.maxPerPlay || "no limit"}</label>
          <input type="range" className="w-full accent-brand-500" min={0} max={SHAK_LIMITS.maxPerPlay.max}
            value={settings.maxPerPlay} onChange={(e) => setSettings({ ...settings, maxPerPlay: Number(e.target.value) })} />
          <button className="btn-primary mt-4 w-full" data-testid="shak-create" disabled={busy} onClick={create}>
            {busy ? "Creating…" : "Create table & get invite link →"}
          </button>
        </div>
        <form className="card" onSubmit={join}>
          <h2 className="text-lg font-black">Join a table · ادخل ترابيزة</h2>
          <p className="mt-1 text-sm text-ink-600 dark:text-ink-200">Got an invite link? Just open it. Or type the table code:</p>
          <input className="input mt-3 font-mono uppercase" placeholder="ABCDE" maxLength={60} value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn-ghost mt-4 w-full">Join →</button>
        </form>
      </div>
      {err && <p className="mt-3 text-sm font-semibold text-rose-500">{err}</p>}
      <RulesCard />
    </div>
  );
}
