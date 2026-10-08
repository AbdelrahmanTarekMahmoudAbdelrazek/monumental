"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LEVELS, MONUMENTS, MIXED_GROUPS, GROUP_LABEL, groupOf, type CatalogGroup, type LevelConfig } from "@monumental/shared";
import { getNickname, setNickname as persistNickname, randomNickname } from "@/lib/identity";

interface Overview { levels: { levelId: number; players: number; phase: string; roundIndex: number }[]; offline?: boolean }

export default function Home({ signedInNickname }: { signedInNickname?: string | null }) {
  const router = useRouter();
  const [nick, setNick] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [code, setCode] = useState("");
  const [codeLevel, setCodeLevel] = useState(3);

  useEffect(() => { setNick(signedInNickname ?? getNickname()); }, [signedInNickname]);
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/rooms").then((r) => r.json()).then((d) => alive && setOverview(d)).catch(() => {});
    load();
    const id = setInterval(load, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const saveNick = () => { if (!signedInNickname) persistNickname(nick || randomNickname()); };
  const play = (lvl: number) => { saveNick(); router.push(`/play/${lvl}`); };
  const joinPrivate = (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (c.length < 4) return;
    saveNick();
    router.push(`/play/room/${encodeURIComponent(`p:${c}:${codeLevel}`)}`);
  };
  const createPrivate = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const c = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    setCode(c);
  };

  return (
    <div className="mx-auto max-w-6xl px-3 md:px-4">
      {/* hero */}
      <section className="mt-6 grid gap-6 md:mt-10 md:grid-cols-[1.2fr_1fr] md:items-center">
        <div>
          <h1 className="font-display text-4xl font-black leading-tight tracking-tight md:text-6xl">
            How big is a <span className="text-brand-500">blue whale</span>…<br />next to the <span className="text-ink-500 dark:text-ink-300">Statue of Liberty</span>?
          </h1>
          <p className="mt-4 max-w-xl text-ink-600 dark:text-ink-200">
            Drag one thing to the size you think is right next to another — monuments, animals, mountains, rockets, planets and stars. Everyone in the room plays the same round on the same clock, and the closest guess takes 3 points. {MONUMENTS.length} things to compare, a "Which is more?" duel mode, {LEVELS.length} levels and hourly tournaments.
          </p>
          <div className="mt-5 flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Your nickname</label>
              <input className="input w-56" value={nick} maxLength={20} disabled={!!signedInNickname} onChange={(e) => setNick(e.target.value)} onBlur={saveNick} placeholder="Nickname" />
            </div>
            <button className="btn-primary" onClick={() => play(12)}>Play Mixed →</button>
            <button className="btn-ghost" onClick={() => play(25)}>Which is more?</button>
            <Link href="/host" className="btn-ghost" onClick={saveNick}>Host a game</Link>
            <Link href="/solo" className="btn-ghost" onClick={saveNick}>Practice solo</Link>
          </div>
          {overview?.offline && <p className="mt-3 text-xs font-semibold text-rose-500">Game server is offline — multiplayer unavailable. Practice mode still works.</p>}
        </div>
        <HeroArt />
      </section>

      {/* levels */}
      <section className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-xl font-black">Mixed mode</h2>
            <p className="text-sm text-ink-500 dark:text-ink-300">Everything against everything — a giraffe vs a bus, Everest vs a moon of Mars.</p>
          </div>
          <span className="text-xs text-ink-500 dark:text-ink-300">Live rooms · {overview?.levels.reduce((a, l) => a + l.players, 0) ?? 0} players online</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {MIXED_GROUPS.map((g) => (
            <span key={g} className="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold ring-1 ring-ink-900/5 dark:bg-ink-900/60 dark:ring-white/10">
              {GROUP_ICON[g]} {GROUP_LABEL[g]} · {MONUMENTS.filter((m) => groupOf(m) === g).length}
            </span>
          ))}
        </div>
        <LevelGrid levels={LEVELS.filter((l) => l.mode === "mixed")} overview={overview} play={play} />
      </section>

      <section id="duels" className="mt-10 scroll-mt-20">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-xl font-black">Which is more?</h2>
            <p className="text-sm text-ink-500 dark:text-ink-300">Two cards, one tap. Higher IMDb rating, taller celebrity, older invention, bigger country, more people, longer river, heavier animal.</p>
          </div>
          <Link href="/duel" className="btn-ghost text-sm" onClick={saveNick}>Solo streak →</Link>
        </div>
        <LevelGrid levels={LEVELS.filter((l) => l.mode === "duel")} overview={overview} play={play} />
      </section>

      <section className="mt-10">
        <Link href="/squad" onClick={saveNick} className="relative flex flex-col items-start gap-3 overflow-hidden rounded-3xl bg-[#0B1118] p-5 text-white shadow-lg ring-1 ring-[#FFB224]/40 transition hover:-translate-y-0.5 hover:shadow-xl sm:flex-row sm:items-center sm:gap-4">
          <div className="flex shrink-0 gap-1" aria-hidden>
            {["#3DD68C", "#A9B6C6", "#FFB224"].map((c) => <span key={c} className="h-12 w-3 rounded-full" style={{ background: c }} />)}
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-black">SQUAD RUSH <span className="ml-1 rounded-full bg-[#FFB224] px-2 py-0.5 align-middle text-xs font-bold text-[#0B1118]">NEW</span></h2>
            <p className="text-sm text-white/75">Red vs Blue team shooter. Healer, Tank or Fighter — knock enemies down, revive your squad, grab power-ups. Bots fill the teams.</p>
          </div>
          <span className="btn w-full bg-[#FFB224] text-[#0B1118] sm:w-auto">Open a team room →</span>
        </Link>
      </section>

      <section className="mt-6">
        <Link href="/neon" onClick={saveNick} className="relative flex flex-col items-start gap-3 overflow-hidden rounded-3xl bg-[#05070f] p-5 text-white shadow-lg ring-1 ring-fuchsia-500/40 transition hover:-translate-y-0.5 hover:shadow-xl sm:flex-row sm:items-center sm:gap-4">
          <svg viewBox="0 0 120 50" className="h-14 w-32 shrink-0" aria-hidden>
            <path d="M5 40 C 30 40, 30 12, 60 12 S 95 30, 100 22" fill="none" stroke="#ff7a7a" strokeWidth="9" strokeOpacity=".25" strokeLinecap="round" />
            <path d="M5 40 C 30 40, 30 12, 60 12 S 95 30, 100 22" fill="none" stroke="#ff7a7a" strokeWidth="3.5" strokeLinecap="round" />
            <rect x="98" y="15" width="18" height="11" rx="3" fill="#ef4444" transform="rotate(-20 107 20)" />
          </svg>
          <div className="flex-1">
            <h2 className="text-xl font-black">NEON DRIFT <span className="ml-1 rounded-full bg-fuchsia-500 px-2 py-0.5 align-middle text-xs font-bold">NEW</span></h2>
            <p className="text-sm text-white/75">Your car leaves a glowing trail — anyone who touches it crashes. Grab gas to grow it, trap your friends, be the last car driving.</p>
          </div>
          <span className="btn w-full bg-fuchsia-500 text-white sm:w-auto">Race friends →</span>
        </Link>
      </section>

      <section className="mt-6">
        <Link href="/smugglers" onClick={saveNick} className="flex flex-col items-start gap-3 rounded-3xl bg-[radial-gradient(ellipse_at_top_left,#3b2d5c,#1a1426)] p-5 text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl sm:flex-row sm:items-center sm:gap-4">
          <span className="text-5xl" aria-hidden>📦</span>
          <div className="flex-1">
            <h2 className="text-xl font-black">SMUGGLERS <span className="ml-1 rounded-full bg-amber-400 px-2 py-0.5 align-middle text-xs font-bold text-ink-900">NEW</span></h2>
            <p className="text-sm text-white/75">Write a story together, one sentence each, while sneaking your secret word into it. Then catch everyone else&apos;s. 3–10 players.</p>
          </div>
          <span className="btn w-full bg-amber-400 text-ink-950 sm:w-auto">Start smuggling →</span>
        </Link>
      </section>

      <section className="mt-6">
        <Link href="/oneword" onClick={saveNick} className="flex flex-col items-start gap-3 rounded-3xl bg-gradient-to-br from-[#16233a] to-[#24395c] p-5 text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl sm:flex-row sm:items-center sm:gap-4">
          <span className="grid grid-cols-3 gap-1" aria-hidden>
            {["bg-rose-500", "bg-sky-500", "bg-[#efe6d2]", "bg-sky-500", "bg-ink-900", "bg-rose-500"].map((c, i) => <span key={i} className={`h-5 w-7 rounded ${c}`} />)}
          </span>
          <div className="flex-1">
            <h2 className="text-xl font-black">ONE WORD <span className="ml-1 rounded-full bg-amber-400 px-2 py-0.5 align-middle text-xs font-bold text-ink-900">NEW</span></h2>
            <p className="text-sm text-white/75">Red vs Blue word game for 4+ players. Your Spymaster gives one word to link your team&apos;s words — find them all before the other team, and avoid the 💣.</p>
          </div>
          <span className="btn bg-amber-400 text-ink-950 w-full sm:w-auto">Play with friends →</span>
        </Link>
      </section>

      <section className="mt-6">
        <Link href="/shak" onClick={saveNick} className="card flex flex-col items-start gap-3 transition hover:-translate-y-0.5 hover:shadow-xl sm:flex-row sm:items-center sm:gap-4">
          <span className="text-5xl" aria-hidden>🁫</span>
          <div className="flex-1">
            <h2 className="text-xl font-black">أشك · Domino bluff <span className="ml-1 rounded-full bg-brand-500/15 px-2 py-0.5 align-middle text-xs font-bold text-brand-700 dark:text-brand-300">NEW</span></h2>
            <p className="text-sm text-ink-500 dark:text-ink-300">The Egyptian domino game of lies: put tiles face-down, claim a number, shout «أشك!» to catch the bluffers. 3–7 players with an invite link, bots fill empty seats.</p>
          </div>
          <span className="btn-primary w-full sm:w-auto">Open a table →</span>
        </Link>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-black">Monuments</h2>
        <p className="text-sm text-ink-500 dark:text-ink-300">The classic game: famous landmarks first, obscure ones and razor-thin margins later.</p>
        <LevelGrid levels={LEVELS.filter((l) => l.mode === "classic")} overview={overview} play={play} />
      </section>

      {/* private rooms */}
      <section className="mt-10 grid gap-4 md:grid-cols-2">
        <form onSubmit={joinPrivate} className="card">
          <h3 className="text-lg font-black">Private room with friends</h3>
          <p className="mt-1 text-sm text-ink-600 dark:text-ink-200">
            Best option: <Link href="/host" className="font-bold text-brand-600 hover:underline">host a game</Link> — choose the game, categories, time per round and number of rounds, share the invite link, and start when everyone is in.
            Or use a quick code below (starts automatically).
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input className="input w-36 uppercase tracking-widest" placeholder="CODE" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={10} />
            <select className="input w-40" value={codeLevel} onChange={(e) => setCodeLevel(Number(e.target.value))}>
              {LEVELS.map((l) => <option key={l.id} value={l.id}>L{l.id} {l.name}</option>)}
            </select>
            <button className="btn-primary" type="submit">Join</button>
            <button className="btn-ghost" type="button" onClick={createPrivate}>New code</button>
          </div>
          {code && <p className="mt-2 text-xs text-ink-500 dark:text-ink-300">Invite link: <code className="rounded bg-ink-100 px-1 dark:bg-ink-800">{typeof window !== "undefined" ? window.location.origin : ""}/play/room/{`p:${code}:${codeLevel}`}</code></p>}
        </form>
        <div className="card">
          <h3 className="text-lg font-black">Tournaments</h3>
          <p className="mt-1 text-sm text-ink-600 dark:text-ink-200">Hourly open tournaments with qualifiers and a final, or schedule a private one for your group.</p>
          <Link href="/tournaments" className="btn-primary mt-3">See tournaments →</Link>
        </div>
      </section>

      <section className="mt-10 grid gap-3 text-sm text-ink-600 dark:text-ink-200 sm:grid-cols-3">
        <div className="card"><b className="text-ink-900 dark:text-ink-50">Scoring</b><br />Error = |your % − real %|. Closest gets 3, 2nd and 3rd get 1. Ties share points. Scored on the server.</div>
        <div className="card"><b className="text-ink-900 dark:text-ink-50">Difficulty</b><br />Famous → obscure monuments, wide → razor-thin ratios, 30s → 8s timers, grid → ruler → nothing → silhouettes.</div>
        <div className="card"><b className="text-ink-900 dark:text-ink-50">Fair play</b><br />The real answer never leaves the server until the reveal. Timers run on the server clock.</div>
      </section>
    </div>
  );
}

function HeroArt() {
  const base = MONUMENTS.find((m) => m.id === "statue_of_liberty")!;
  const target = MONUMENTS.find((m) => m.id === "blue_whale")!;
  const ppm = 1.6;
  const groundY = 180;
  const bh = base.heightM * ppm, bw = (base.silhouette.w / 100) * bh;
  const th = target.heightM * ppm, tw = (target.silhouette.w / 100) * th;
  return (
    <div className="relative overflow-hidden rounded-3xl shadow-xl ring-1 ring-ink-900/10 dark:ring-white/10">
      <svg viewBox="0 0 420 220" className="block w-full">
        <defs>
          <linearGradient id="hsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="[stop-color:#bfe3ff] dark:[stop-color:#0d1b3a]" /><stop offset="1" className="[stop-color:#fff3e0] dark:[stop-color:#2b2446]" /></linearGradient>
          <linearGradient id="hg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="[stop-color:#c9b28a] dark:[stop-color:#3a3350]" /><stop offset="1" className="[stop-color:#a98e63] dark:[stop-color:#241f36]" /></linearGradient>
        </defs>
        <rect width="420" height={groundY} fill="url(#hsky)" />
        <rect y={groundY} width="420" height="40" fill="url(#hg)" />
        <g transform={`translate(${110 - bw / 2} ${groundY - bh}) scale(${bh / 100})`}><path d={base.silhouette.d} className="fill-ink-800 dark:fill-ink-200" /></g>
        <g transform={`translate(${300 - tw / 2} ${groundY - th}) scale(${th / 100})`}><path d={target.silhouette.d} className="fill-brand-500" /></g>
        <line x1={300 - tw / 2 - 12} x2={300 + tw / 2 + 12} y1={groundY - th} y2={groundY - th} className="stroke-brand-600" strokeDasharray="5 4" strokeWidth="1.5" />
        <circle cx="300" cy={groundY - th} r="9" className="fill-brand-500 stroke-white" strokeWidth="2.5" />
        <text x="300" y={groundY - th - 16} textAnchor="middle" className="fill-ink-800 text-[11px] font-bold dark:fill-ink-50">Your guess: 27%</text>
        <text x="110" y={groundY + 26} textAnchor="middle" className="fill-ink-900 text-[10px] font-semibold dark:fill-ink-50">Statue of Liberty · 93 m</text>
        <text x="300" y={groundY + 26} textAnchor="middle" className="fill-ink-900 text-[10px] font-semibold dark:fill-ink-50">Blue whale · ?</text>
      </svg>
    </div>
  );
}

const GROUP_ICON: Record<CatalogGroup, string> = { monuments: "🏛️", animal: "🐘", nature: "🏔️", vehicle: "🚀", space: "🪐" };

function LevelGrid({ levels, overview, play }: { levels: LevelConfig[]; overview: Overview | null; play: (id: number) => void }) {
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {levels.map((l) => {
        const live = overview?.levels.find((x) => x.levelId === l.id);
        return (
          <button key={l.id} onClick={() => play(l.id)} className="card group text-left transition hover:-translate-y-0.5 hover:shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-widest text-brand-600">Level {l.id}</div>
                <div className="text-lg font-black">{l.name}</div>
              </div>
              <div className="text-right text-xs text-ink-500 dark:text-ink-300">
                <div className="font-bold text-ink-800 dark:text-ink-50">{l.timerSec}s</div>
                <div>{l.kind === "duel" ? "tap to pick" : { full: "grid + ruler", ruler: "ruler", none: "no helpers", silhouette: "silhouettes" }[l.helpers]}</div>
              </div>
            </div>
            <p className="mt-2 text-sm text-ink-600 dark:text-ink-200">{l.tagline}</p>
            <div className="mt-3 flex items-center justify-between text-xs">
              <span className="flex items-center gap-1 text-ink-500 dark:text-ink-300"><span className={`inline-block h-2 w-2 rounded-full ${live?.players ? "bg-emerald-500" : "bg-ink-300"}`} />{live?.players ?? 0} playing{live && live.roundIndex >= 0 && live.phase !== "finished" ? ` · round ${live.roundIndex + 1}` : ""}</span>
              <span className="font-bold text-brand-600 group-hover:underline">Join →</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
