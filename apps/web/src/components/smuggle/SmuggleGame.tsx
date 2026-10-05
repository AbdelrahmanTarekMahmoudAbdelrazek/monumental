"use client";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { SMUGGLE_LIMITS, SMUGGLE_SENTENCE_MAX, containsWord, type SmuggleAction, type SmugglePublicState } from "@monumental/shared";
import { useSmuggle } from "@/lib/useSmuggle";
import { serverNow } from "@/lib/socket";
import { sfx } from "@/lib/sound";

/** One colour per seat, used for author names and highlights. */
const COLORS = [
  { text: "text-rose-600", light: "text-rose-300", chip: "bg-rose-500", mark: "bg-rose-200" },
  { text: "text-sky-600", light: "text-sky-300", chip: "bg-sky-500", mark: "bg-sky-200" },
  { text: "text-emerald-600", light: "text-emerald-300", chip: "bg-emerald-500", mark: "bg-emerald-200" },
  { text: "text-violet-600", light: "text-violet-300", chip: "bg-violet-500", mark: "bg-violet-200" },
  { text: "text-amber-600", light: "text-amber-300", chip: "bg-amber-500", mark: "bg-amber-200" },
  { text: "text-pink-600", light: "text-pink-300", chip: "bg-pink-500", mark: "bg-pink-200" },
  { text: "text-teal-600", light: "text-teal-300", chip: "bg-teal-500", mark: "bg-teal-200" },
  { text: "text-orange-600", light: "text-orange-300", chip: "bg-orange-500", mark: "bg-orange-200" },
  { text: "text-indigo-600", light: "text-indigo-300", chip: "bg-indigo-500", mark: "bg-indigo-200" },
  { text: "text-lime-700", light: "text-lime-300", chip: "bg-lime-600", mark: "bg-lime-200" },
];

type Act = (a: SmuggleAction) => Promise<{ ok: boolean; error?: string }>;

export default function SmuggleGame({ code, userToken }: { code: string; userToken: string | null }) {
  const g = useSmuggle(code, userToken);
  const { state, me, words } = g;
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => serverNow());
  const lastEv = useRef(0);
  const lastTurn = useRef<string | null>(null);

  useEffect(() => { const t = setInterval(() => setNow(serverNow()), 500); return () => clearInterval(t); }, []);
  const evAt = state?.event?.at;
  useEffect(() => {
    if (!state?.event || state.event.at === lastEv.current) return;
    lastEv.current = state.event.at;
    setToast(state.event.text);
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [evAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const turnId = state?.turnId ?? null;
  useEffect(() => {
    if (turnId !== lastTurn.current) {
      lastTurn.current = turnId;
      if (turnId && turnId === me) sfx.roundStart();
      else if (turnId) sfx.tick();
    }
  }, [turnId, me]);
  const phase = state?.phase;
  useEffect(() => { if (phase === "reveal") sfx.win(); if (phase === "guessing") sfx.reveal(); }, [phase]);

  if (g.error) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-5xl">📦</p>
        <p className="mt-3 text-lg font-bold">{g.error}</p>
        <Link href="/smugglers" className="btn-primary mt-6">Back to SMUGGLERS</Link>
      </div>
    );
  }
  if (!state) return <div className="p-10 text-center text-sm text-ink-500">{g.connected ? "Joining…" : "Waking up the game server… (can take ~30 s)"}</div>;

  const act: Act = async (a) => {
    const r = await g.act(a);
    if (!r.ok) { setErr(r.error ?? "Not allowed"); setTimeout(() => setErr(null), 2600); }
    return r;
  };
  const isHost = state.hostId === me;
  const colorOf = (id: string | null) => {
    const i = state.players.findIndex((p) => p.id === id);
    return COLORS[(i < 0 ? 0 : i) % COLORS.length];
  };
  const name = (id: string | null) => state.players.find((p) => p.id === id)?.nickname ?? "?";
  const mine = state.players.find((p) => p.id === me);
  const secs = state.turnEndsAt ? Math.max(0, Math.ceil((state.turnEndsAt - now) / 1000)) : null;

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[radial-gradient(ellipse_at_top,#2a2140,#120e1c_70%)] px-3 pb-16 pt-4 text-white md:px-4">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-white/70">
            <span className="rounded-full border border-white/20 px-3 py-1 font-semibold">📦 SMUGGLERS · <span className="font-mono">{state.code}</span>{state.game ? ` · Game ${state.game}` : ""}</span>
            <InviteButton code={state.code} />
            {!g.connected && <span className="font-bold text-rose-300">Reconnecting…</span>}
          </div>
          {isHost && state.phase !== "lobby" && <button className="rounded-full border border-white/20 px-3 py-1 font-semibold hover:bg-white/10" onClick={() => void act({ type: "to_lobby" })}>Lobby & settings</button>}
        </div>

        {state.phase === "lobby" && <Lobby state={state} me={me} isHost={isHost} act={act} colorOf={colorOf} />}

        {state.phase !== "lobby" && (
          <>
            {mine?.inGame && words.length > 0 && state.phase !== "reveal" && <SecretCard words={words} />}
            {!mine?.inGame && state.phase !== "reveal" && <p className="mt-4 rounded-2xl bg-white/5 p-3 text-center text-sm text-white/70">You joined mid-game — watch this round, you&apos;ll play the next one.</p>}

            {state.phase === "writing" && (
              <TurnBar state={state} me={me} secs={secs} colorOf={colorOf} />
            )}

            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_280px]">
              <div>
                <Story state={state} colorOf={colorOf} name={name} me={me} />
                {state.phase === "writing" && state.turnId === me && <Writer words={words} onSend={(text) => act({ type: "write", text })} />}
                {state.phase === "guessing" && mine?.inGame && <Guessing state={state} me={me} words={words} colorOf={colorOf} act={act} secs={secs} />}
                {state.phase === "guessing" && !mine?.inGame && <p className="mt-4 text-center text-white/70">Players are guessing… ⏱ {secs}s</p>}
                {state.phase === "reveal" && <Results state={state} me={me} colorOf={colorOf} name={name} isHost={isHost} act={act} />}
                {err && <p className="mt-3 text-center text-sm font-bold text-rose-300">{err}</p>}
              </div>
              <Scoreboard state={state} me={me} colorOf={colorOf} />
            </div>
          </>
        )}
      </div>
      {toast && <div className="pointer-events-none fixed left-1/2 top-16 z-30 max-w-[92vw] -translate-x-1/2 animate-[slideL_.25s_ease-out] rounded-2xl bg-black/85 px-4 py-2 text-center text-sm font-semibold shadow-xl ring-1 ring-white/20" data-testid="sm-toast">{toast}</div>}
    </div>
  );
}

function SecretCard({ words }: { words: string[] }) {
  const [hidden, setHidden] = useState(false);
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-3 text-ink-950 shadow-xl" data-testid="sm-secret">
      <div>
        <div className="text-[11px] font-black uppercase tracking-widest opacity-70">🤫 Your secret word{words.length > 1 ? "s" : ""} — sneak {words.length > 1 ? "them" : "it"} into YOUR sentences</div>
        <div className="mt-0.5 flex flex-wrap gap-2 text-2xl font-black tracking-wide">
          {words.map((w) => <span key={w} className={hidden ? "blur-md select-none" : ""}>{w}</span>)}
        </div>
      </div>
      <button className="rounded-full bg-black/15 px-3 py-1 text-xs font-bold hover:bg-black/25" onClick={() => setHidden((h) => !h)}>{hidden ? "👁 Show" : "🙈 Hide"}</button>
    </div>
  );
}

function TurnBar({ state, me, secs, colorOf }: { state: SmugglePublicState; me: string | null; secs: number | null; colorOf: (id: string | null) => (typeof COLORS)[number] }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
      <span className="text-xs font-bold uppercase tracking-wider text-white/60">Lap {Math.min(state.lap, state.settings.laps)}/{state.settings.laps}</span>
      <div className="flex flex-1 flex-wrap gap-1.5">
        {state.order.map((id) => {
          const p = state.players.find((x) => x.id === id);
          const cur = id === state.turnId;
          return (
            <span key={id} className={`rounded-full px-2.5 py-1 text-xs font-bold ${cur ? `${colorOf(id).chip} ring-2 ring-white` : "bg-white/10 text-white/70"} ${p?.connected === false ? "opacity-50" : ""}`}>
              {cur ? "✍️ " : ""}{p?.nickname ?? "?"}{id === me ? " (you)" : ""}
            </span>
          );
        })}
      </div>
      {secs !== null && <span className={`rounded-full px-3 py-1 text-sm font-black ${secs <= 10 ? "bg-rose-500" : "bg-white/15"}`}>⏱ {secs}s</span>}
    </div>
  );
}

/** Highlights the secret words (reveal only) inside a line. */
function Highlighted({ text, words, mark }: { text: string; words: string[]; mark: string }) {
  if (!words.length) return <>{text}</>;
  const re = new RegExp(`\\b(${words.map((w) => w.toLowerCase()).join("|")})(s|es|'s)?\\b`, "gi");
  const parts = text.split(re);
  const out: React.ReactNode[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === undefined) continue;
    if (words.some((w) => w.toLowerCase() === p.toLowerCase())) {
      const suffix = parts[i + 1] ?? "";
      out.push(<mark key={i} className={`rounded px-0.5 font-black text-ink-950 ${mark}`}>{p}{suffix}</mark>);
      i++;
    } else out.push(<Fragment key={i}>{p}</Fragment>);
  }
  return <>{out}</>;
}

function Story({ state, colorOf, name, me }: { state: SmugglePublicState; colorOf: (id: string | null) => (typeof COLORS)[number]; name: (id: string | null) => string; me: string | null }) {
  const end = useRef<HTMLDivElement>(null);
  const reveal = state.phase === "reveal";
  useEffect(() => { if (state.phase === "writing") end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [state.story.length, state.phase]);
  const wordsOf = (id: string | null) => (reveal ? state.results?.find((r) => r.playerId === id)?.words ?? [] : []);
  return (
    <div className="relative rounded-3xl bg-[#fbf6ea] p-5 text-ink-900 shadow-2xl ring-1 ring-black/10 md:p-7" data-testid="sm-story">
      <div className="pointer-events-none absolute inset-y-0 left-8 w-px bg-rose-300/60 md:left-10" />
      <div className="space-y-3 pl-6 font-serif text-[17px] leading-relaxed md:pl-8 md:text-lg">
        {state.story.map((l, i) => (
          <div key={i} className={`animate-[slideR_.3s_ease-out] ${l.skipped ? "italic text-ink-400" : ""}`}>
            {l.by ? (
              <span className={`mr-2 align-middle font-sans text-[11px] font-black uppercase tracking-wider ${colorOf(l.by).text}`}>{name(l.by)}{l.by === me ? " (you)" : ""}</span>
            ) : (
              <span className="mr-2 align-middle font-sans text-[11px] font-black uppercase tracking-wider text-ink-400">Opening</span>
            )}
            <span className={l.by ? "" : "font-semibold"}>
              <Highlighted text={l.text} words={wordsOf(l.by)} mark={colorOf(l.by).mark} />
            </span>
          </div>
        ))}
        {state.phase === "writing" && (
          <div className="font-sans text-sm text-ink-400">
            <span className={`font-bold ${colorOf(state.turnId).text}`}>{name(state.turnId)}</span> is writing<span className="animate-pulse">…</span>
          </div>
        )}
        <div ref={end} />
      </div>
    </div>
  );
}

function Writer({ words, onSend }: { words: string[]; onSend: (t: string) => Promise<{ ok: boolean }> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const hits = words.filter((w) => containsWord(text, w));
  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (text.trim().length < 3 || busy) return;
    setBusy(true);
    const r = await onSend(text);
    setBusy(false);
    if (r.ok) setText("");
  };
  return (
    <form onSubmit={send} className="mt-3 rounded-3xl bg-amber-400/10 p-3 ring-2 ring-amber-400" data-testid="sm-writer">
      <div className="mb-2 text-sm font-black text-amber-300">✍️ Your turn — add the next sentence</div>
      <textarea
        autoFocus rows={2} maxLength={SMUGGLE_SENTENCE_MAX} value={text}
        onChange={(e) => setText(e.target.value.replace(/\n/g, " "))}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void send(); } }}
        placeholder="Continue the story… (sneak your word in, but don't be obvious 😏)"
        className="w-full resize-none rounded-2xl bg-white px-4 py-3 font-serif text-lg text-ink-900 outline-none ring-amber-400 focus:ring-4"
        data-testid="sm-input"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-white/70">
          {words.map((w) => <span key={w} className={`mr-2 rounded-full px-2 py-0.5 font-bold ${hits.includes(w) ? "bg-emerald-500 text-white" : "bg-white/10"}`}>{hits.includes(w) ? "✅" : "⬜"} {w}</span>)}
          {text.length}/{SMUGGLE_SENTENCE_MAX}
        </span>
        <button className="btn bg-amber-400 text-ink-950 hover:bg-amber-300" disabled={busy || text.trim().length < 3} data-testid="sm-send">Add to story ➤</button>
      </div>
    </form>
  );
}

function Guessing({ state, me, words, colorOf, act, secs }: { state: SmugglePublicState; me: string | null; words: string[]; colorOf: (id: string | null) => (typeof COLORS)[number]; act: Act; secs: number | null }) {
  const others = state.players.filter((p) => p.inGame && p.id !== me);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const locked = state.players.find((p) => p.id === me)?.guessed;
  const taken = new Set(Object.values(picks));
  return (
    <div className="mt-4 rounded-3xl bg-white/5 p-4 ring-1 ring-white/10" data-testid="sm-guessing">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-black">🔍 Who smuggled what?</h2>
        {secs !== null && <span className={`rounded-full px-3 py-1 text-sm font-black ${secs <= 10 ? "bg-rose-500" : "bg-white/15"}`}>⏱ {secs}s</span>}
      </div>
      <p className="text-sm text-white/70">Pick the word you think each player was hiding. +1 for every one you get right.</p>
      <div className="mt-3 space-y-3">
        {others.map((p) => (
          <div key={p.id} className="rounded-2xl bg-black/20 p-3" data-testid="sm-guess-row">
            <div className={`text-sm font-black ${colorOf(p.id).light}`}>{p.nickname}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {state.options.filter((w) => !words.includes(w)).map((w) => {
                const on = picks[p.id] === w;
                return (
                  <button key={w} type="button" disabled={locked}
                    onClick={() => setPicks((x) => ({ ...x, [p.id]: on ? "" : w }))}
                    className={`rounded-full px-2.5 py-1 text-xs font-bold transition ${on ? `${colorOf(p.id).chip} ring-2 ring-white` : taken.has(w) ? "bg-white/5 text-white/40" : "bg-white/10 hover:bg-white/20"}`}>
                    {w}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className="btn bg-amber-400 text-ink-950 hover:bg-amber-300" disabled={locked} data-testid="sm-lock" onClick={() => void act({ type: "guess", guesses: picks })}>
          {locked ? "Locked in ✓" : "🔒 Lock in my guesses"}
        </button>
        <span className="text-xs text-white/60">{state.players.filter((p) => p.inGame && p.guessed).length}/{state.players.filter((p) => p.inGame).length} locked in</span>
      </div>
    </div>
  );
}

function Results({ state, me, colorOf, name, isHost, act }: { state: SmugglePublicState; me: string | null; colorOf: (id: string | null) => (typeof COLORS)[number]; name: (id: string | null) => string; isHost: boolean; act: Act }) {
  const rows = [...(state.results ?? [])].sort((a, b) => b.points - a.points);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const txt = state.story.map((l) => (l.by ? `${name(l.by)}: ${l.text}` : l.text)).join("\n") + "\n\n— written on How Big? · SMUGGLERS";
    try { await navigator.clipboard.writeText(txt); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  };
  return (
    <div className="mt-4 rounded-3xl bg-white/5 p-4 ring-1 ring-white/10" data-testid="sm-results">
      <h2 className="text-xl font-black">📦 The smugglers revealed</h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {rows.map((r, i) => (
          <div key={r.playerId} className={`rounded-2xl bg-black/25 p-3 ${r.playerId === me ? "ring-2 ring-amber-400" : ""}`}>
            <div className="flex items-center justify-between">
              <span className="font-black">{i === 0 ? "🏆 " : ""}<span className={colorOf(r.playerId).light}>{name(r.playerId)}</span>{r.playerId === me ? " (you)" : ""}</span>
              <span className="text-2xl font-black text-amber-300">+{r.points}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {r.words.map((w, j) => (
                <span key={w} className={`rounded-full px-2 py-0.5 text-xs font-black ${r.smuggled[j] ? "bg-emerald-500" : "bg-white/15 line-through"}`}>{w} {r.smuggled[j] ? "✅ smuggled" : "🐢 forgot"}</span>
              ))}
            </div>
            <div className="mt-1 text-xs text-white/70">
              {r.caughtBy.length ? <>🔍 Caught by {r.caughtBy.map(name).join(", ")}</> : r.smuggled.some(Boolean) ? <>😎 Nobody caught it (+3)</> : <>—</>}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {isHost ? <button className="btn-primary" data-testid="sm-again" onClick={() => void act({ type: "start" })}>Play again ↻</button> : <span className="self-center text-sm text-white/60">Waiting for the host to start the next story…</span>}
        <button className="btn border border-white/25 text-white hover:bg-white/10" onClick={copy}>{copied ? "Copied ✓" : "📋 Copy the story"}</button>
      </div>
    </div>
  );
}

function Scoreboard({ state, me, colorOf }: { state: SmugglePublicState; me: string | null; colorOf: (id: string | null) => (typeof COLORS)[number] }) {
  const rows = useMemo(() => [...state.players].sort((a, b) => b.score - a.score), [state.players]);
  return (
    <div className="self-start rounded-3xl bg-white/5 p-4 ring-1 ring-white/10" data-testid="sm-scores">
      <div className="text-xs font-black uppercase tracking-wider text-white/60">Scores</div>
      <ol className="mt-2 space-y-1.5">
        {rows.map((p, i) => (
          <li key={p.id} className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${p.id === me ? "bg-white/10" : ""} ${p.connected ? "" : "opacity-50"}`}>
            <span className="w-5 text-center text-xs font-black text-white/50">{i + 1}</span>
            <span className={`h-2.5 w-2.5 rounded-full ${colorOf(p.id).chip}`} />
            <span className="flex-1 truncate text-sm font-semibold">{p.nickname}{p.id === me ? " (you)" : ""}</span>
            {state.phase === "guessing" && p.inGame && <span className="text-xs">{p.guessed ? "✅" : "🤔"}</span>}
            <span className="text-sm font-black">{p.score}</span>
          </li>
        ))}
      </ol>
      <Rules compact />
    </div>
  );
}

function InviteButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = `${window.location.origin}/smugglers/${code}`;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share && /Mobi|Android/i.test(navigator.userAgent)) { try { await nav.share({ title: "Play SMUGGLERS with me", url }); return; } catch { /* fall through */ } }
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  };
  return <button onClick={share} className="rounded-full border border-white/20 px-3 py-1 font-semibold hover:bg-white/10">{copied ? "Copied ✓" : "🔗 Invite"}</button>;
}

function Lobby({ state, me, isHost, act, colorOf }: { state: SmugglePublicState; me: string | null; isHost: boolean; act: Act; colorOf: (id: string | null) => (typeof COLORS)[number] }) {
  const url = typeof window !== "undefined" ? `${window.location.origin}/smugglers/${state.code}` : `/smugglers/${state.code}`;
  const n = state.players.length;
  const need = SMUGGLE_LIMITS.players.min - n;
  return (
    <div className="mt-4">
      <h1 className="text-3xl font-black">📦 SMUGGLERS <span className="text-lg font-bold text-white/50">· waiting room</span></h1>
      <div className="mt-4 rounded-3xl bg-white/5 p-4 ring-1 ring-white/10">
        <label className="text-xs font-bold uppercase tracking-wider text-white/60">Invite link</label>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <code className="flex-1 truncate rounded-xl bg-black/30 px-3 py-2 text-sm" data-testid="sm-invite">{url}</code>
          <InviteButton code={state.code} />
        </div>
        <h3 className="mt-4 text-xs font-black uppercase tracking-wider text-white/60">Players {n}/{SMUGGLE_LIMITS.players.max}</h3>
        <div className="mt-2 flex flex-wrap gap-2" data-testid="sm-lobby-players">
          {state.players.map((p) => (
            <span key={p.id} className={`inline-flex items-center gap-2 rounded-full bg-black/25 px-3 py-1.5 text-sm font-semibold ${p.id === me ? "ring-2 ring-white" : ""}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${colorOf(p.id).chip}`} />
              {p.nickname}{p.id === me ? " (you)" : ""}{p.id === state.hostId ? " · host" : ""}{p.score ? ` · ${p.score} pts` : ""}
            </span>
          ))}
        </div>
      </div>
      {isHost ? (
        <div className="mt-4 flex flex-wrap items-end gap-4 rounded-3xl bg-white/5 p-4 ring-1 ring-white/10">
          <Sel label="Laps around the table" value={state.settings.laps} options={[2, 3, 4, 5].map((v) => [v, `${v} laps`])} onChange={(v) => void act({ type: "settings", settings: { laps: v } })} />
          <Sel label="Time to write" value={state.settings.turnSec} options={[30, 45, 60, 90].map((v) => [v, `${v}s`])} onChange={(v) => void act({ type: "settings", settings: { turnSec: v } })} />
          <Sel label="Secret words" value={state.settings.wordsPer} options={[[1, "1 each"], [2, "2 each (hard)"]]} onChange={(v) => void act({ type: "settings", settings: { wordsPer: v as 1 | 2 } })} />
          <button className="btn-primary ml-auto" data-testid="sm-start" disabled={need > 0} onClick={() => void act({ type: "start" })}>
            {need > 0 ? `Need ${need} more player${need > 1 ? "s" : ""}` : "Start the story ▶"}
          </button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-white/70">Waiting for <b>{state.players.find((p) => p.id === state.hostId)?.nickname ?? "the host"}</b> to start… ({state.settings.laps} laps, {state.settings.turnSec}s per sentence)</p>
      )}
      <Rules />
    </div>
  );
}

function Sel({ label, value, options, onChange }: { label: string; value: number; options: (readonly [number, string])[]; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="text-xs font-bold uppercase tracking-wider text-white/60">{label}</label>
      <select className="mt-1 block rounded-xl bg-black/30 px-3 py-2 text-sm" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

export function Rules({ compact }: { compact?: boolean }) {
  return (
    <details className={`${compact ? "mt-4 text-xs" : "mt-4 rounded-3xl bg-white/5 p-4 text-sm ring-1 ring-white/10"}`} open={!compact}>
      <summary className={`cursor-pointer font-black ${compact ? "text-white/60" : "text-lg"}`}>How to play</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-white/80">
        <li>Everyone gets a <b>secret word</b> like GIRAFFE or PICKLE. Don&apos;t show anyone!</li>
        <li>Take turns adding <b>one sentence</b> to a shared story. Sneak your word into one of your sentences — naturally.</li>
        <li>Plant fake clues to frame others 😈.</li>
        <li>When the story ends, guess each player&apos;s word from the list.</li>
        <li><b>+2</b> you smuggled it · <b>+3</b> nobody caught you · <b>+1</b> for every word you guess right.</li>
      </ul>
    </details>
  );
}
