"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { SHAK_LIMITS, tileHas, type ShakPlayerPublic, type ShakPublicState } from "@monumental/shared";
import { useShak } from "@/lib/useShak";
import { serverNow } from "@/lib/socket";
import { sfx } from "@/lib/sound";
import DominoTile, { TileFan } from "./DominoTile";

/** The أشك table: lobby, felt, seats, my hand, reveal and results. */
export default function ShakTable({ code, userToken }: { code: string; userToken: string | null }) {
  const g = useShak(code, userToken);
  const { state, hand, me } = g;
  const [sel, setSel] = useState<number[]>([]);
  const [num, setNum] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => serverNow());
  const lastLog = useRef(0);
  const lastTurn = useRef<string | null>(null);
  const lastPhase = useRef<string | null>(null);

  useEffect(() => { const t = setInterval(() => setNow(serverNow()), 250); return () => clearInterval(t); }, []);

  // toasts + sounds (keyed on the log timestamp so later state pushes don't reset the timer)
  const log = state?.log;
  useEffect(() => {
    if (!log || log.at === lastLog.current) return;
    lastLog.current = log.at;
    if (log.kind === "play") { sfx.lock(); setToast(null); return; }
    if (log.kind === "pass") sfx.tick();
    else if (log.kind === "clear") sfx.miss();
    else if (log.kind === "out") sfx.points();
    setToast(log.text);
    const t = setTimeout(() => setToast((cur) => (cur === log.text ? null : cur)), 3200);
    return () => clearTimeout(t);
  }, [log?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!state) return;
    if (state.phase !== lastPhase.current) {
      if (state.phase === "reveal") sfx.reveal();
      if (state.phase === "finished") sfx.win();
      lastPhase.current = state.phase;
    }
    if (state.turnId !== lastTurn.current) {
      lastTurn.current = state.turnId;
      if (state.turnId === me && state.phase === "playing") sfx.roundStart();
      setSel([]);
      setNum(null);
    }
  }, [state, me]);
  // drop selections of tiles no longer in hand
  useEffect(() => { setSel((s) => s.filter((t) => hand.includes(t))); }, [hand]);

  if (g.error) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-5xl">🁫</p>
        <p className="mt-3 text-lg font-bold">{g.error}</p>
        <Link href="/shak" className="btn-primary mt-6">Back to أشك</Link>
      </div>
    );
  }
  if (!state) return <div className="p-10 text-center text-sm text-ink-500">{g.connected ? "Joining the table…" : "Waking up the game server… (can take ~30 s)"}</div>;

  const isHost = state.hostId === me;
  const mine = state.players.find((p) => p.id === me) ?? null;
  const myTurn = state.phase === "playing" && state.turnId === me;
  const mustStart = myTurn && state.number === null;
  const lastPlay = state.plays[state.plays.length - 1];
  const inRound = !!mine && mine.outRank === null && (mine.tiles > 0 || mine.pendingExit);
  const canDoubt = state.phase === "playing" && state.doubtOpen && !!lastPlay && lastPlay.by !== me && inRound;
  const max = state.settings.maxPerPlay || 99;
  const secs = Math.max(0, Math.ceil((state.turnEndsAt - now) / 1000));
  const name = (id?: string | null) => state.players.find((p) => p.id === id)?.nickname ?? "?";

  const act = async (p: Promise<{ ok: boolean; error?: string }>) => {
    const r = await p;
    if (!r.ok) { setErr(r.error ?? "Not allowed"); setTimeout(() => setErr(null), 2500); }
  };
  const toggle = (t: number) => {
    if (!myTurn) return;
    setSel((s) => (s.includes(t) ? s.filter((x) => x !== t) : s.length >= max ? s : [...s, t]));
  };
  const doPlay = () => {
    if (!sel.length || (mustStart && num === null)) return;
    void act(g.play(sel, mustStart ? num! : undefined));
  };

  // seats around the table, me at the bottom
  const myIdx = state.players.findIndex((p) => p.id === me);
  const others = myIdx >= 0 ? [...state.players.slice(myIdx + 1), ...state.players.slice(0, myIdx)] : state.players;

  if (state.phase === "waiting") return <Lobby state={state} me={me} isHost={isHost} g={g} err={err} act={act} />;

  const hl = state.phase === "reveal" ? state.reveal!.number : (state.number ?? num);

  return (
    <div className="mx-auto max-w-5xl px-2 py-3 md:px-4" dir="ltr">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-ink-500 dark:text-ink-300">
        <span>Table <b className="font-mono text-ink-800 dark:text-ink-100">{state.code}</b> · Round {state.round}{state.excludedCount ? ` · ${state.excludedCount} tile set aside` : ""}</span>
        {!g.connected && <span className="font-bold text-rose-500">Reconnecting…</span>}
      </div>

      {/* felt */}
      <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-b from-emerald-700 to-emerald-900 p-3 shadow-2xl ring-8 ring-amber-900/70 md:p-5">
        <div className="pointer-events-none absolute inset-0 opacity-20 [background:radial-gradient(circle_at_50%_40%,white,transparent_60%)]" />

        {/* opponents */}
        <div className="relative flex flex-wrap justify-center gap-2 md:gap-4">
          {others.map((p) => <Seat key={p.id} p={p} turn={state.turnId === p.id && state.phase === "playing"} secs={secs} host={p.id === state.hostId} />)}
        </div>

        {/* center pile */}
        <div className="relative my-4 flex min-h-[170px] flex-col items-center justify-center md:my-6">
          {state.number !== null ? (
            <div className="mb-2 flex items-center gap-2 rounded-full bg-black/30 px-4 py-1.5 text-white">
              <span className="text-xs uppercase tracking-wider opacity-80">The number · الرقم</span>
              <span className="grid h-9 w-9 place-items-center rounded-full bg-amber-400 text-xl font-black text-ink-950 shadow" data-testid="shak-number">{state.number}</span>
            </div>
          ) : (
            <div className="mb-2 rounded-full bg-black/30 px-4 py-1.5 text-sm font-semibold text-white">
              {state.phase === "playing" ? `${name(state.turnId)} starts a new pile · يبدأ كومة جديدة` : "—"}
            </div>
          )}
          <Pile count={state.tableCount} />
          {lastPlay && state.phase === "playing" && (
            <p className="mt-2 text-center text-sm text-white/90">
              Last: <b>{name(lastPlay.by)}</b> put {lastPlay.count} — “{lastPlay.count > 1 ? "all" : "it's a"} {state.number}”
              {state.doubtOpen && <span className="ml-1 rounded bg-rose-500/80 px-1.5 py-0.5 text-[11px] font-bold">can be doubted</span>}
            </p>
          )}
          <div className="mt-2 flex min-h-[34px] items-center justify-center">
            {toast && (
              <div key={toast} className="animate-[slideL_.25s_ease-out] rounded-2xl bg-ink-950/80 px-4 py-1.5 text-center text-sm font-semibold text-white shadow-xl" data-testid="shak-toast">
                <bdi>{toast}</bdi>
              </div>
            )}
          </div>
        </div>

        {/* my seat */}
        {mine ? (
          <div className="relative rounded-3xl bg-black/25 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-white">
              <div className="flex items-center gap-2 text-sm font-bold">
                {mine.nickname} (you){isHost && " · host"}
                {mine.crowns > 0 && <span title="Kings won">👑×{mine.crowns}</span>}
                {mine.outRank && <span className="rounded-full bg-amber-400 px-2 text-xs text-ink-950">{mine.outRank === 1 ? "👑 King" : `Out #${mine.outRank}`}</span>}
              </div>
              {myTurn && <span className={`rounded-full px-3 py-0.5 text-sm font-black ${secs <= 5 ? "bg-rose-500" : "bg-amber-400 text-ink-950"}`}>Your turn · <bdi>دورك</bdi> · {secs}s</span>}
            </div>

            {mustStart && (
              <div className="mb-3 flex flex-wrap items-center gap-1.5 text-white">
                <span className="mr-1 text-sm">Announce a number · اختار الرقم:</span>
                {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                  <button key={n} onClick={() => setNum(n)} data-testid={`shak-num-${n}`}
                    className={`h-9 w-9 rounded-full text-lg font-black transition ${num === n ? "bg-amber-400 text-ink-950 scale-110" : "bg-white/15 hover:bg-white/30"}`}>{n}</button>
                ))}
              </div>
            )}

            <div className="flex flex-wrap justify-center gap-1.5 pt-3" data-testid="shak-hand">
              {hand.length === 0 && <p className="py-6 text-sm text-white/80">{mine.outRank ? "You're out — watch the others fight it out." : "No tiles."}</p>}
              {hand.map((t) => (
                <DominoTile key={t} id={t} size={38} selected={sel.includes(t)} highlight={hl} onClick={() => toggle(t)} disabled={!myTurn} />
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <button className="btn-primary min-w-[120px]" data-testid="shak-play" disabled={!myTurn || !sel.length || (mustStart && num === null)} onClick={doPlay}>
                Play {sel.length || ""} · <bdi>ضع</bdi>
              </button>
              <button className="btn-ghost min-w-[100px]" data-testid="shak-pass" disabled={!myTurn || mustStart} onClick={() => void act(g.pass())}>Pass · <bdi>باص</bdi></button>
              <button data-testid="shak-doubt" disabled={!canDoubt} onClick={() => void act(g.doubt())}
                className="btn min-w-[120px] bg-rose-600 text-white shadow-lg shadow-rose-600/30 hover:bg-rose-700">
                <bdi dir="rtl">أشك!</bdi> Doubt
              </button>
            </div>
            {myTurn && sel.length > 0 && hl !== null && (
              <p className="mt-2 text-center text-xs text-white/80">
                {sel.every((t) => tileHas(t, hl)) ? "✅ Honest play" : "🤫 Bluff — hope nobody doubts you"}
              </p>
            )}
            {err && <p className="mt-2 text-center text-sm font-bold text-rose-200">{err}</p>}
          </div>
        ) : (
          <p className="text-center text-sm text-white/80">You're watching. Join next round when it ends.</p>
        )}


        {state.phase === "reveal" && state.reveal && <RevealOverlay r={state.reveal} name={name} me={me} />}
        {state.phase === "finished" && state.result && <Results state={state} me={me} isHost={isHost} g={g} act={act} />}
      </div>

      <RulesCard compact />
    </div>
  );
}

function Seat({ p, turn, secs, host }: { p: ShakPlayerPublic; turn: boolean; secs: number; host: boolean }) {
  return (
    <div className={`min-w-[110px] rounded-2xl px-3 py-2 text-white transition ${turn ? "bg-amber-400/30 ring-2 ring-amber-300" : "bg-black/25"} ${!p.connected && !p.isBot ? "opacity-50" : ""}`} data-testid="shak-seat">
      <div className="flex items-center gap-1 text-sm font-bold">
        <span className="truncate max-w-[110px]">{p.isBot ? "🤖 " : ""}{p.nickname}</span>
        {host && <span className="text-[10px] opacity-70">host</span>}
      </div>
      <div className="flex items-center justify-between gap-2">
        {p.outRank ? <span className="py-2 text-sm font-bold text-amber-300">{p.outRank === 1 ? "👑 King" : `Out #${p.outRank}`}</span> : <TileFan count={p.tiles} />}
        <span className="text-xs font-bold">{p.outRank ? "" : p.tiles}</span>
      </div>
      <div className="flex items-center justify-between text-[11px] opacity-80">
        <span>{p.crowns > 0 ? `👑×${p.crowns}` : ""}{p.pendingExit ? " last tile!" : ""}</span>
        {turn && <span className="font-black">{secs}s</span>}
      </div>
    </div>
  );
}

function Pile({ count }: { count: number }) {
  const shown = Math.min(count, 14);
  // deterministic scatter
  const spots = useMemo(() => Array.from({ length: 14 }, (_, i) => ({ x: ((i * 37) % 9) * 9 - 36, y: ((i * 53) % 5) * 6 - 12, r: ((i * 71) % 60) - 30 })), []);
  return (
    <div className="relative h-[110px] w-[200px]" data-testid="shak-pile" aria-label={`${count} tiles on the table`}>
      {shown === 0 && <div className="absolute inset-0 grid place-items-center rounded-2xl border-2 border-dashed border-white/25 text-sm text-white/60">empty table</div>}
      {spots.slice(0, shown).map((s, i) => (
        <span key={i} className="absolute left-1/2 top-1/2" style={{ transform: `translate(calc(-50% + ${s.x}px), calc(-50% + ${s.y}px)) rotate(${s.r}deg)` }}>
          <DominoTile id={null} size={22} />
        </span>
      ))}
      {count > 0 && <span className="absolute -right-2 -top-2 grid h-8 min-w-8 place-items-center rounded-full bg-white px-2 text-sm font-black text-ink-900 shadow">{count}</span>}
    </div>
  );
}

function RevealOverlay({ r, name, me }: { r: NonNullable<ShakPublicState["reveal"]>; name: (id?: string | null) => string; me: string | null }) {
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-ink-950/70 p-4 backdrop-blur-sm" data-testid="shak-reveal">
      <div className="w-full max-w-md rounded-3xl bg-white p-5 text-center text-ink-900 shadow-2xl dark:bg-ink-900 dark:text-ink-50">
        <p className="text-2xl font-black text-rose-600" dir="rtl">«أشك!»</p>
        <p className="text-sm text-ink-500 dark:text-ink-300"><b>{name(r.doubterId)}</b> doubts <b>{name(r.playerId)}</b>’s “{r.number}”</p>
        <div className="my-4 flex flex-wrap justify-center gap-2">
          {r.tiles.map((t, i) => (
            <span key={t} style={{ animationDelay: `${i * 0.15}s` }} className="animate-[tileFlip_.6s_ease-out_both]">
              <DominoTile id={t} size={40} highlight={r.number} className={tileHas(t, r.number) ? "" : "rounded-lg ring-4 ring-rose-500"} />
            </span>
          ))}
        </div>
        <p className={`animate-[slideR_.3s_.6s_ease-out_both] text-3xl font-black ${r.truthful ? "text-emerald-600" : "text-rose-600"}`}>
          {r.truthful ? <><bdi>صادق</bdi> · Truthful</> : <><bdi>كذاب</bdi> · Bluff!</>}
        </p>
        <p className="mt-2 animate-[slideR_.3s_.9s_ease-out_both] text-sm">
          <b>{r.loserId === me ? "You take" : `${name(r.loserId)} takes`}</b> {r.taken} tile{r.taken === 1 ? "" : "s"} from the table.
        </p>
      </div>
    </div>
  );
}

type G = ReturnType<typeof useShak>;
type Act = (p: Promise<{ ok: boolean; error?: string }>) => Promise<void>;

function Results({ state, me, isHost, g, act }: { state: ShakPublicState; me: string | null; isHost: boolean; g: G; act: Act }) {
  const r = state.result!;
  const p = (id: string) => state.players.find((x) => x.id === id);
  return (
    <div className="absolute inset-0 z-20 grid place-items-center overflow-y-auto bg-ink-950/75 p-3 backdrop-blur-sm" data-testid="shak-results">
      <div className="w-full max-w-lg rounded-3xl bg-white p-5 text-ink-900 shadow-2xl dark:bg-ink-900 dark:text-ink-50">
        <h2 className="text-center text-2xl font-black">Round {state.round} over</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 text-center">
          <div className="rounded-2xl bg-amber-100 p-3 dark:bg-amber-500/20">
            <div className="text-4xl">👑</div>
            <div className="text-xs uppercase tracking-wider text-ink-500 dark:text-ink-300">King · الملك</div>
            <div className="font-black">{p(r.kingId)?.nickname ?? "?"}{r.kingId === me ? " (you)" : ""}</div>
          </div>
          <div className="rounded-2xl bg-rose-100 p-3 dark:bg-rose-500/20">
            <div className="text-4xl">🤡</div>
            <div className="text-xs uppercase tracking-wider text-ink-500 dark:text-ink-300">Fool · الأهبل</div>
            <div className="font-black">{r.foolId ? `${p(r.foolId)?.nickname ?? "?"}${r.foolId === me ? " (you)" : ""}` : "—"}</div>
          </div>
        </div>
        <ol className="mt-4 space-y-2">
          {r.order.map((id, i) => {
            const h = r.hands.find((x) => x.id === id)?.tiles ?? [];
            return (
              <li key={id} className="flex items-center gap-3 rounded-xl bg-ink-50 px-3 py-2 dark:bg-ink-800">
                <span className="w-6 text-center font-black">{i + 1}</span>
                <span className="flex-1 truncate font-semibold">{p(id)?.nickname ?? "?"}{id === me ? " (you)" : ""}</span>
                <span className="text-xs">👑×{p(id)?.crowns ?? 0}</span>
                {h.length > 0 && <span className="flex gap-0.5">{h.slice(0, 8).map((t) => <DominoTile key={t} id={t} size={12} />)}</span>}
              </li>
            );
          })}
        </ol>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {isHost ? (
            <>
              <button className="btn-primary" data-testid="shak-again" onClick={() => void act(g.start())}>Play again · <bdi>كمان دور</bdi></button>
              <BotButtons state={state} g={g} act={act} />
            </>
          ) : (
            <p className="text-sm text-ink-500 dark:text-ink-300">Waiting for the host to start the next round…</p>
          )}
          <InviteButton code={state.code} small />
        </div>
      </div>
    </div>
  );
}

function BotButtons({ state, g, act }: { state: ShakPublicState; g: G; act: Act }) {
  const bots = state.players.filter((p) => p.isBot).length;
  return (
    <>
      <button className="btn-ghost" data-testid="shak-add-bot" disabled={state.players.length >= 4} onClick={() => void act(g.bot("add"))}>+ Bot</button>
      <button className="btn-ghost" disabled={bots === 0} onClick={() => void act(g.bot("remove"))}>− Bot</button>
    </>
  );
}

function InviteButton({ code, small }: { code: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? `${window.location.origin}/shak/${code}` : `/shak/${code}`;
  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share && /Mobi|Android/i.test(navigator.userAgent)) { try { await nav.share({ title: "أشك — play with me", url }); return; } catch { /* fallthrough */ } }
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  };
  return <button className={small ? "btn-ghost" : "btn-ghost shrink-0"} onClick={share}>{copied ? "Copied ✓" : "Copy invite link"}</button>;
}

function Lobby({ state, me, isHost, g, err, act }: { state: ShakPublicState; me: string | null; isHost: boolean; g: G; err: string | null; act: Act }) {
  const url = typeof window !== "undefined" ? `${window.location.origin}/shak/${state.code}` : `/shak/${state.code}`;
  const n = state.players.length;
  return (
    <div className="mx-auto max-w-3xl px-3 py-6 md:px-4">
      <h1 className="text-3xl font-black">أشك <span className="text-lg font-bold text-ink-500">· Domino bluff</span></h1>
      <div className="card mt-4">
        <label className="label">Invite link · لينك الدعوة</label>
        <div className="flex flex-wrap items-center gap-2">
          <code className="flex-1 truncate rounded-xl bg-ink-100 px-3 py-2 text-sm dark:bg-ink-800" data-testid="shak-invite">{url}</code>
          <InviteButton code={state.code} />
        </div>
        <p className="mt-2 text-xs text-ink-500 dark:text-ink-300">Table code <b className="font-mono">{state.code}</b>. 3 or 4 players — fill empty seats with bots.</p>

        <h3 className="mt-5 text-sm font-black uppercase tracking-wider text-ink-500">Players {n}/4</h3>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2" data-testid="shak-lobby-players">
          {state.players.map((p) => (
            <li key={p.id} className="flex items-center gap-2 rounded-xl bg-ink-50 px-3 py-2 dark:bg-ink-800">
              <span>{p.isBot ? "🤖" : "🙂"}</span>
              <span className="flex-1 truncate font-semibold">{p.nickname}{p.id === me ? " (you)" : ""}</span>
              {p.id === state.hostId && <span className="rounded-full bg-brand-500/15 px-2 text-xs font-bold text-brand-700 dark:text-brand-300">host</span>}
              {p.crowns > 0 && <span className="text-xs">👑×{p.crowns}</span>}
            </li>
          ))}
          {Array.from({ length: Math.max(0, 4 - n) }, (_, i) => (
            <li key={`e${i}`} className="rounded-xl border-2 border-dashed border-ink-200 px-3 py-2 text-sm text-ink-400 dark:border-ink-700">Empty seat</li>
          ))}
        </ul>

        {isHost ? (
          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap gap-2"><BotButtons state={state} g={g} act={act} /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Time per turn: {state.settings.turnSec}s</label>
                <input type="range" className="w-full accent-brand-500" min={SHAK_LIMITS.turnSec.min} max={SHAK_LIMITS.turnSec.max} step={5}
                  value={state.settings.turnSec} onChange={(e) => void act(g.updateSettings({ turnSec: Number(e.target.value) }))} />
              </div>
              <div>
                <label className="label">Max tiles per play: {state.settings.maxPerPlay || "no limit"}</label>
                <input type="range" className="w-full accent-brand-500" min={0} max={SHAK_LIMITS.maxPerPlay.max}
                  value={state.settings.maxPerPlay} onChange={(e) => void act(g.updateSettings({ maxPerPlay: Number(e.target.value) }))} />
              </div>
            </div>
            <button className="btn-primary w-full sm:w-auto" data-testid="shak-start" disabled={n < 3} onClick={() => void act(g.start())}>
              {n < 3 ? `Need ${3 - n} more player${3 - n > 1 ? "s" : ""}` : <>Start · <bdi>ابدأ</bdi></>}
            </button>
          </div>
        ) : (
          <p className="mt-5 text-sm text-ink-600 dark:text-ink-200">Waiting for <b>{state.players.find((p) => p.id === state.hostId)?.nickname ?? "the host"}</b> to start… ({state.settings.turnSec}s per turn)</p>
        )}
        {err && <p className="mt-3 text-sm font-semibold text-rose-500">{err}</p>}
      </div>
      <RulesCard />
    </div>
  );
}

export function RulesCard({ compact }: { compact?: boolean }) {
  return (
    <details className="card mt-4" open={!compact}>
      <summary className="cursor-pointer text-lg font-black">How to play · طريقة اللعب</summary>
      <div className="mt-3 grid gap-4 text-sm md:grid-cols-2">
        <ul className="list-disc space-y-1 pl-5">
          <li>3–4 players. 4 players get 7 tiles each; 3 players get 9 and one tile is set aside.</li>
          <li>Whoever holds 6|6 (or the biggest double) starts: announce a number 0–6 and put tiles face-down, claiming each one has that number.</li>
          <li>On your turn: <b>Play</b> more tiles claiming the same number (truth or bluff), <b>Pass</b>, or shout <b>«أشك!»</b> to doubt the last play — only until the next move.</li>
          <li>Doubt: the tiles flip. All true → the doubter takes the whole table. One lie → the bluffer takes it. The tile-player then starts a new pile.</li>
          <li>If everyone passes in a row, the table is removed from the game.</li>
          <li>Play your last tile and survive the next move → you&apos;re out. First out is the 👑 king; the last one holding tiles is the 🤡 fool.</li>
        </ul>
        <ul dir="rtl" className="list-disc space-y-1 pr-5 text-right">
          <li>٣–٤ لاعبين. في الأربعة كل واحد ٧ حجارة، وفي التلاتة كل واحد ٩ وحجر بيتشال على جنب.</li>
          <li>اللي معاه الدُش ٦|٦ (أو أكبر دُش) يبدأ: يقول رقم من ٠ لـ ٦ ويحط حجارة مقلوبة على إنها كلها فيها الرقم ده.</li>
          <li>في دورك: <b>ضع</b> حجارة على نفس الرقم (صح أو كذب)، أو <b>باص</b>، أو قول <b>«أشك!»</b> على آخر لعبة بس قبل الحركة اللي بعدها.</li>
          <li>لو صادق: اللي شكّ ياخد كل الحجارة اللي على الترابيزة. لو كذاب: هو اللي ياخدها. وبعدها اللي لعب يبدأ كومة جديدة.</li>
          <li>لو الكل قال باص ورا بعض، الحجارة اللي على الترابيزة تتشال من اللعب.</li>
          <li>اللي يخلّص حجارته ومحدش يكشفه يخرج. أول واحد يخلص هو 👑 الملك، وآخر واحد معاه حجارة هو 🤡 الأهبل.</li>
        </ul>
      </div>
    </details>
  );
}
