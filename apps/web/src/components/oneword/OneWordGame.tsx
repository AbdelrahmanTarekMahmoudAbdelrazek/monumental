"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { OW_TIMER_CHOICES, otherTeam, type OwChatMsg, type OwColor, type OwPlayerPublic, type OwPublicState, type OwTeam } from "@monumental/shared";
import { useOneWord } from "@/lib/useOneWord";
import { serverNow } from "@/lib/socket";
import { sfx } from "@/lib/sound";

const TEAM = {
  red: { name: "Red", text: "text-rose-300", bg: "bg-rose-600", panel: "from-rose-500 to-rose-700", ring: "ring-rose-400" },
  blue: { name: "Blue", text: "text-sky-300", bg: "bg-sky-600", panel: "from-sky-500 to-sky-700", ring: "ring-sky-400" },
} as const;

/** Card face colours: outer frame + inner word plate. */
const FACE: Record<OwColor | "hidden", { frame: string; plate: string; word: string }> = {
  hidden: { frame: "bg-[#efe6d2] border-[#d8c9a6]", plate: "bg-[#fffaf0] border-[#d8c9a6]", word: "text-ink-900" },
  red: { frame: "bg-rose-500 border-rose-700", plate: "bg-rose-700 border-rose-900", word: "text-white" },
  blue: { frame: "bg-sky-500 border-sky-700", plate: "bg-sky-700 border-sky-900", word: "text-white" },
  neutral: { frame: "bg-[#c9b98f] border-[#a8976a]", plate: "bg-[#a8976a] border-[#8a7a50]", word: "text-white" },
  bomb: { frame: "bg-ink-900 border-black", plate: "bg-black border-ink-700", word: "text-white" },
};
/** Spymaster tint for hidden cards. */
const TINT: Record<OwColor, string> = {
  red: "bg-rose-300 border-rose-500",
  blue: "bg-sky-300 border-sky-500",
  neutral: "bg-[#e2d7bb] border-[#c3b285]",
  bomb: "bg-ink-500 border-ink-800",
};

export default function OneWordGame({ code, userToken }: { code: string; userToken: string | null }) {
  const g = useOneWord(code, userToken);
  const { state, key, me } = g;
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<OwPublicState["event"] | null>(null);
  const [now, setNow] = useState(() => serverNow());
  const lastEvent = useRef(0);

  useEffect(() => { const t = setInterval(() => setNow(serverNow()), 500); return () => clearInterval(t); }, []);
  const ev = state?.event;
  useEffect(() => {
    if (!ev || ev.at === lastEvent.current) return;
    lastEvent.current = ev.at;
    setToast(ev);
    if (ev.text.startsWith("💣")) sfx.miss();
    else if (ev.text.startsWith("✅")) sfx.points();
    else if (ev.text.startsWith("❌") || ev.text.startsWith("😐")) sfx.tick();
    const t = setTimeout(() => setToast((c) => (c?.at === ev.at ? null : c)), 3500);
    return () => clearTimeout(t);
  }, [ev?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const phase = state?.phase;
  useEffect(() => { if (phase === "finished") sfx.win(); if (phase === "playing") sfx.roundStart(); }, [phase]);

  if (g.error) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-5xl">🕵️</p>
        <p className="mt-3 text-lg font-bold">{g.error}</p>
        <Link href="/oneword" className="btn-primary mt-6">Back to ONE WORD</Link>
      </div>
    );
  }
  if (!state) return <div className="p-10 text-center text-sm text-ink-500">{g.connected ? "Joining…" : "Waking up the game server… (can take ~30 s)"}</div>;

  const mine = state.players.find((p) => p.id === me) ?? null;
  const isHost = state.hostId === me;
  const act = async (a: Parameters<typeof g.act>[0]) => {
    const r = await g.act(a);
    if (!r.ok) { setErr(r.error ?? "Not allowed"); setTimeout(() => setErr(null), 2600); }
    return r;
  };

  if (state.phase === "lobby") return <Lobby state={state} me={me} isHost={isHost} act={act} err={err} />;

  const isSpy = mine?.role === "spymaster";
  const myTurnSpy = state.phase === "playing" && state.stage === "clue" && isSpy && mine?.team === state.turn;
  const myTurnGuess = state.phase === "playing" && state.stage === "guess" && mine?.role === "operative" && mine?.team === state.turn;
  const secs = state.turnEndsAt ? Math.max(0, Math.ceil((state.turnEndsAt - now) / 1000)) : null;
  const name = (id: string) => state.players.find((p) => p.id === id)?.nickname ?? "?";
  const spyOf = (t: OwTeam) => state.players.find((p) => p.team === t && p.role === "spymaster");

  const status = (() => {
    if (state.phase === "finished") return `${TEAM[state.winner!].name} team wins!`;
    const t = TEAM[state.turn].name;
    if (state.stage === "clue") return myTurnSpy ? "Your turn — give your team ONE word" : `${t} Spymaster ${spyOf(state.turn)?.nickname ?? ""} is thinking of a clue…`;
    return myTurnGuess ? "Your turn — tap the words that match the clue" : `${t} team is guessing…`;
  })();

  return (
    <div className="min-h-[calc(100vh-56px)] bg-gradient-to-b from-[#16233a] via-[#1b2c47] to-[#121b2c] px-2 pb-28 pt-3 text-white md:px-4" dir="ltr">
      <div className="mx-auto max-w-7xl">
        {/* top bar */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-white/70">
            <span className="rounded-full border border-white/25 px-3 py-1 font-semibold">Game {state.game} · <span className="font-mono">{state.code}</span></span>
            <InviteButton code={state.code} />
            {!g.connected && <span className="font-bold text-rose-300">Reconnecting…</span>}
          </div>
          <div className="flex items-center gap-2">
            {mine && <span className={`rounded-full px-3 py-1 text-xs font-bold ${TEAM[mine.team ?? "red"].bg}`}>You: {TEAM[mine.team ?? "red"].name} {mine.role === "spymaster" ? "Spymaster 🕵️" : "Guesser"}</span>}
            {isHost && <button className="rounded-full border border-white/25 px-3 py-1 text-xs font-semibold hover:bg-white/10" onClick={() => void act({ type: "to_lobby" })}>Teams & settings</button>}
          </div>
        </div>

        {/* status line */}
        <div className="mt-3 text-center">
          <h1 className={`text-lg font-black uppercase tracking-wide md:text-2xl ${state.phase === "finished" ? TEAM[state.winner!].text : ""}`} data-testid="ow-status">{status}</h1>
          {state.clue && state.phase === "playing" && (
            <div className="mt-2 inline-flex items-center gap-3 rounded-2xl bg-white px-5 py-2 text-ink-900 shadow-xl" data-testid="ow-clue">
              <span className={`h-3 w-3 rounded-full ${TEAM[state.turn].bg}`} />
              <span className="text-2xl font-black uppercase tracking-wide">{state.clue.word}</span>
              <span className={`grid h-9 w-9 place-items-center rounded-full text-lg font-black text-white ${TEAM[state.turn].bg}`}>{state.clue.count === 0 ? "∞" : state.clue.count}</span>
              {state.guessesLeft < 99 && <span className="text-xs font-semibold text-ink-500">{state.guessesLeft} guess{state.guessesLeft === 1 ? "" : "es"} left</span>}
            </div>
          )}
          {secs !== null && state.phase === "playing" && <div className={`mt-1 text-sm font-bold ${secs <= 10 ? "text-rose-300" : "text-white/70"}`}>⏱ {secs}s</div>}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[200px_1fr_220px]">
          <TeamPanel team="red" state={state} me={me} className="order-2 self-start lg:order-1" />

          {/* board */}
          <div className="order-1 lg:order-2">
            <div className="grid grid-cols-5 gap-1.5 sm:gap-2.5" data-testid="ow-board">
              {state.cards.map((c, i) => {
                const known = c.color;
                const spyColor = isSpy && !c.revealed && key ? key[i] : null;
                const face = known ? FACE[known] : FACE.hidden;
                const tint = !c.revealed && spyColor ? TINT[spyColor] : "";
                const marked = c.marks.length > 0;
                const canTap = myTurnGuess && !c.revealed;
                const mineMarked = canTap && c.marks.includes(me ?? "");
                const done = c.revealed; // guessed → covered in its colour and greyed out
                return (
                  <div key={i} className="relative" data-testid="ow-card" data-color={known ?? spyColor ?? ""} data-revealed={done ? "1" : ""}>
                    <button
                      type="button"
                      disabled={!canTap}
                      onClick={() => void act({ type: "mark", index: i })}
                      className={`group relative flex aspect-[4/3] w-full flex-col justify-end overflow-hidden rounded-lg border-2 p-1 transition sm:rounded-xl sm:p-2 ${tint || face.frame} ${done ? "shadow-inner saturate-[.65] brightness-75" : "shadow-[0_4px_0_rgba(0,0,0,.35)]"} ${state.phase === "finished" && !done ? "opacity-70" : ""} ${canTap ? "cursor-pointer hover:-translate-y-0.5 hover:brightness-105" : "cursor-default"} ${marked && !done ? `ring-4 ${TEAM[state.turn].ring}` : ""} ${done ? "animate-[tileFlip_.5s_ease-out_both]" : ""}`}
                    >
                      {done && known !== "bomb" && (
                        <span className="absolute inset-0 grid place-items-center text-3xl font-black text-white/70 sm:text-5xl" aria-hidden>
                          {known === "neutral" ? "—" : "✓"}
                        </span>
                      )}
                      {known === "bomb" && <span className="absolute inset-0 grid place-items-center text-2xl sm:text-4xl">💣</span>}
                      {!done && spyColor === "bomb" && <span className="absolute right-1 top-1 text-sm sm:text-lg">💣</span>}
                      <span className={`relative block truncate rounded-md border-2 px-0.5 py-0.5 text-center text-[9px] font-black uppercase leading-tight tracking-tight sm:py-1.5 sm:text-sm md:text-base lg:text-lg ${done ? "border-black/20 bg-black/35 text-white/55 line-through decoration-2" : "border-[#d8c9a6] bg-[#fffaf0] text-ink-900"}`}>
                        {c.word}
                      </span>
                    </button>
                    {marked && !done && !mineMarked && (
                      <div className="pointer-events-none absolute left-1 top-1 flex max-w-[90%] flex-wrap gap-0.5">
                        {c.marks.slice(0, 3).map((id) => <span key={id} className="truncate rounded bg-white/90 px-1 text-[8px] font-bold text-ink-900 sm:text-[10px]">👉 {name(id)}</span>)}
                      </div>
                    )}
                    {mineMarked && (
                      <button type="button" onClick={() => void act({ type: "reveal", index: i })} data-testid="ow-reveal"
                        className="absolute inset-x-1 top-1 z-10 rounded-md bg-amber-400 py-1 text-[10px] font-black uppercase text-ink-950 shadow-lg ring-2 ring-white hover:bg-amber-300 sm:inset-x-2 sm:top-2 sm:py-2 sm:text-sm">
                        🔒 Lock in
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {myTurnGuess && <p className="mt-2 text-center text-xs text-white/60">Tap a word to point at it (your team sees it), then press 🔒 Lock in to reveal it.</p>}
            {err && <p className="mt-2 text-center text-sm font-bold text-rose-300">{err}</p>}
          </div>

          <div className="order-3 space-y-4 self-start">
            <TeamPanel team="blue" state={state} me={me} />
            {mine?.role === "operative" && mine.team && <TeamChat team={mine.team} msgs={g.chat} me={me} send={(text) => act({ type: "chat", text })} />}
            <GameLog state={state} />
          </div>
        </div>
      </div>

      {toast && (
        <div key={toast.at} className="pointer-events-none fixed bottom-24 left-1/2 z-30 max-w-[92vw] text-center -translate-x-1/2 animate-[slideL_.25s_ease-out] rounded-2xl bg-ink-950/90 px-4 py-2 text-sm font-semibold shadow-xl ring-1 ring-white/20" data-testid="ow-toast">{toast.text}</div>
      )}

      {/* bottom action bar */}
      {state.phase === "playing" && (myTurnSpy || myTurnGuess) && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-[#0f1726]/95 px-2 py-3 backdrop-blur">
          {myTurnSpy ? <ClueBar onSend={(word, count) => act({ type: "clue", word, count })} team={state.turn} /> : (
            <div className="flex flex-wrap justify-center gap-2">
              {(() => {
                const pick = state.cards.findIndex((c) => !c.revealed && c.marks.includes(me ?? ""));
                return pick >= 0 ? (
                  <button className="btn bg-amber-400 text-ink-950 hover:bg-amber-300" data-testid="ow-lockin" onClick={() => void act({ type: "reveal", index: pick })}>
                    🔒 Lock in “{state.cards[pick].word}”
                  </button>
                ) : <span className="self-center text-sm text-white/60">Tap a word, then lock it in</span>;
              })()}
              <button className="btn border border-white/30 text-white hover:bg-white/10" data-testid="ow-end-turn" onClick={() => void act({ type: "end_turn" })}>End turn ⏭</button>
            </div>
          )}
        </div>
      )}

      {state.phase === "finished" && <Finished state={state} isHost={isHost} act={act} />}
    </div>
  );
}

function ClueBar({ onSend, team }: { onSend: (w: string, n: number) => Promise<{ ok: boolean }>; team: OwTeam }) {
  const [word, setWord] = useState("");
  const [n, setN] = useState(1);
  const [busy, setBusy] = useState(false);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!word.trim()) return;
    setBusy(true);
    const r = await onSend(word, n);
    setBusy(false);
    if (r.ok) { setWord(""); setN(1); }
  };
  return (
    <form onSubmit={send} className="mx-auto flex max-w-3xl items-center gap-2" data-testid="ow-cluebar">
      <input
        className="h-12 min-w-0 flex-1 rounded-xl bg-white px-4 text-center text-xl font-black uppercase tracking-wide text-ink-900 outline-none ring-amber-400 focus:ring-4"
        placeholder="Type ONE word" maxLength={24} value={word} autoFocus
        onChange={(e) => setWord(e.target.value.replace(/\s/g, ""))} data-testid="ow-clue-input"
      />
      <div className="flex items-center rounded-xl bg-white/10">
        <button type="button" className="h-12 w-9 text-xl font-black" onClick={() => setN((x) => (x <= 0 ? 9 : x - 1))}>−</button>
        <span className={`grid h-10 w-10 place-items-center rounded-full text-lg font-black ${TEAM[team].bg}`} data-testid="ow-count">{n === 0 ? "∞" : n}</span>
        <button type="button" className="h-12 w-9 text-xl font-black" onClick={() => setN((x) => (x >= 9 ? 0 : x + 1))}>+</button>
      </div>
      <button className="btn h-12 bg-amber-400 px-5 text-ink-950 hover:bg-amber-300" disabled={busy || !word.trim()} data-testid="ow-send">Give clue ➤</button>
    </form>
  );
}

function TeamPanel({ team, state, me, className = "" }: { team: OwTeam; state: OwPublicState; me: string | null; className?: string }) {
  const T = TEAM[team];
  const members = state.players.filter((p) => p.team === team);
  const spy = members.find((p) => p.role === "spymaster");
  const ops = members.filter((p) => p.role === "operative");
  const active = state.phase === "playing" && state.turn === team;
  return (
    <div className={`rounded-2xl bg-gradient-to-b ${T.panel} p-3 shadow-xl transition ${active ? "ring-4 ring-amber-300" : "opacity-90"} ${className}`} data-testid={`ow-team-${team}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-black uppercase tracking-wider">{T.name} team</span>
        <span className="text-4xl font-black leading-none drop-shadow" data-testid={`ow-left-${team}`}>{state.remaining[team]}</span>
      </div>
      <p className="text-[11px] uppercase tracking-wider text-white/70">words left · {state.wins[team]} win{state.wins[team] === 1 ? "" : "s"}</p>
      <div className="mt-2 text-[11px] font-bold uppercase tracking-wider text-white/70">Spymaster</div>
      <Member p={spy} me={me} spy />
      <div className="mt-2 text-[11px] font-bold uppercase tracking-wider text-white/70">Guessers</div>
      <div className="flex flex-wrap gap-1">{ops.length ? ops.map((p) => <Member key={p.id} p={p} me={me} />) : <span className="text-xs text-white/60">—</span>}</div>
    </div>
  );
}

function Member({ p, me, spy }: { p?: OwPlayerPublic; me: string | null; spy?: boolean }) {
  if (!p) return <span className="text-xs text-white/60">— empty —</span>;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-xs font-semibold ${p.connected ? "" : "opacity-50"} ${p.id === me ? "ring-2 ring-white" : ""}`}>
      {spy ? "🕵️" : "🙂"} {p.nickname}{p.id === me ? " (you)" : ""}
    </span>
  );
}

function TeamChat({ team, msgs, me, send }: { team: OwTeam; msgs: OwChatMsg[]; me: string | null; send: (t: string) => Promise<{ ok: boolean }> }) {
  const [text, setText] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const seen = useRef(0);
  const last = msgs[msgs.length - 1]?.id ?? 0;
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
    if (last > seen.current && seen.current !== 0 && msgs[msgs.length - 1]?.by !== me) sfx.tick();
    seen.current = last;
  }, [last]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText("");
    const r = await send(t);
    if (!r.ok) setText(t);
  };
  return (
    <div className={`rounded-2xl bg-black/30 p-3 ring-2 ${team === "red" ? "ring-rose-500/60" : "ring-sky-500/60"}`} data-testid="ow-chat">
      <div className="text-xs font-black uppercase tracking-wider">💬 {TEAM[team].name} team chat</div>
      <div className="text-[10px] text-white/50">Guessers only · your Spymaster can&apos;t see it</div>
      <div ref={box} className="mt-2 h-44 space-y-1.5 overflow-y-auto pr-1 text-sm" data-testid="ow-chat-msgs">
        {msgs.length === 0 && <p className="pt-12 text-center text-xs text-white/40">Discuss your guesses here…</p>}
        {msgs.map((m) => (
          <div key={m.id} className={`flex ${m.by === me ? "justify-end" : ""}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-1.5 ${m.by === me ? `${TEAM[team].bg} rounded-br-sm` : "rounded-bl-sm bg-white/10"}`}>
              {m.by !== me && <div className="text-[10px] font-bold text-white/60">{m.nickname}</div>}
              <div className="break-words">{m.text}</div>
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={submit} className="mt-2 flex gap-1.5">
        <input className="min-w-0 flex-1 rounded-xl bg-white/10 px-3 py-2 text-sm outline-none ring-amber-400 placeholder:text-white/40 focus:ring-2"
          placeholder="Message your team…" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} data-testid="ow-chat-input" />
        <button className="rounded-xl bg-amber-400 px-3 text-sm font-black text-ink-950 hover:bg-amber-300 disabled:opacity-40" disabled={!text.trim()} data-testid="ow-chat-send">➤</button>
      </form>
    </div>
  );
}

function GameLog({ state }: { state: OwPublicState }) {
  return (
    <div className="rounded-2xl bg-black/30 p-3 ring-1 ring-white/10">
      <div className="text-center text-xs font-black uppercase tracking-wider text-white/60">Game log</div>
      <ol className="mt-2 max-h-72 space-y-2 overflow-y-auto text-xs" data-testid="ow-log">
        {state.log.length === 0 && <li className="text-center text-white/40">No clues yet</li>}
        {[...state.log].reverse().map((l, i) => (
          <li key={i} className="rounded-lg bg-white/5 p-2">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${TEAM[l.team].bg}`} />
              <b className="uppercase">{l.word}</b> <span className="text-white/60">{l.count === 0 ? "∞" : l.count}</span>
            </div>
            {l.guesses.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {l.guesses.map((g, j) => (
                  <span key={j} className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${g.color === "red" ? "bg-rose-600" : g.color === "blue" ? "bg-sky-600" : g.color === "bomb" ? "bg-black" : "bg-[#a8976a]"}`}>{g.word}</span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Finished({ state, isHost, act }: { state: OwPublicState; isHost: boolean; act: (a: Parameters<ReturnType<typeof useOneWord>["act"]>[0]) => Promise<unknown> }) {
  const w = state.winner!;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#0f1726]/95 px-3 py-4 backdrop-blur" data-testid="ow-finished">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-3 text-center">
        <span className="text-3xl">{state.winReason === "bomb" ? "💣" : "🏆"}</span>
        <div>
          <div className={`text-xl font-black ${TEAM[w].text}`}>{TEAM[w].name} team wins!</div>
          <div className="text-xs text-white/70">{state.winReason === "bomb" ? `${TEAM[otherTeam(w)].name} hit the bomb.` : "They found all their words."} Score: Red {state.wins.red} – {state.wins.blue} Blue</div>
        </div>
        {isHost ? (
          <>
            <button className="btn-primary" data-testid="ow-again" onClick={() => void act({ type: "start" })}>Play again ↻</button>
            <button className="btn border border-white/30 text-white hover:bg-white/10" onClick={() => void act({ type: "to_lobby" })}>Change teams</button>
          </>
        ) : <span className="text-sm text-white/70">Waiting for the host…</span>}
      </div>
    </div>
  );
}

function InviteButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = `${window.location.origin}/oneword/${code}`;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share && /Mobi|Android/i.test(navigator.userAgent)) { try { await nav.share({ title: "Play ONE WORD with me", url }); return; } catch { /* fall through */ } }
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  };
  return <button onClick={share} className="rounded-full border border-white/25 px-3 py-1 font-semibold hover:bg-white/10">{copied ? "Copied ✓" : "🔗 Invite"}</button>;
}

type Act = (a: Parameters<ReturnType<typeof useOneWord>["act"]>[0]) => Promise<unknown>;

function Lobby({ state, me, isHost, act, err }: { state: OwPublicState; me: string | null; isHost: boolean; act: Act; err: string | null }) {
  const url = typeof window !== "undefined" ? `${window.location.origin}/oneword/${state.code}` : `/oneword/${state.code}`;
  return (
    <div className="min-h-[calc(100vh-56px)] bg-gradient-to-b from-[#16233a] to-[#121b2c] px-3 py-6 text-white md:px-4">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-3xl font-black">ONE WORD <span className="text-lg font-bold text-white/60">· pick your team</span></h1>
        <div className="mt-4 rounded-3xl bg-white/5 p-4 ring-1 ring-white/10">
          <label className="text-xs font-bold uppercase tracking-wider text-white/60">Invite link</label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <code className="flex-1 truncate rounded-xl bg-black/30 px-3 py-2 text-sm" data-testid="ow-invite">{url}</code>
            <InviteButton code={state.code} />
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {(["red", "blue"] as OwTeam[]).map((t) => {
            const members = state.players.filter((p) => p.team === t);
            const spy = members.find((p) => p.role === "spymaster");
            const ops = members.filter((p) => p.role === "operative");
            return (
              <div key={t} className={`rounded-3xl bg-gradient-to-b ${TEAM[t].panel} p-4 shadow-xl`} data-testid={`ow-lobby-${t}`}>
                <h2 className="text-xl font-black uppercase">{TEAM[t].name} team</h2>
                <div className="mt-3 text-xs font-bold uppercase tracking-wider text-white/70">Spymaster — sees the key, gives one-word clues</div>
                <div className="mt-1 flex items-center gap-2">
                  <Member p={spy} me={me} spy />
                  {spy?.id !== me && (!spy || !spy.connected) && <button className="rounded-full bg-white/90 px-3 py-1 text-xs font-bold text-ink-900 hover:bg-white" data-testid={`ow-join-${t}-spy`} onClick={() => void act({ type: "join_team", team: t, role: "spymaster" })}>{spy ? "Take over" : "Be Spymaster"}</button>}
                </div>
                <div className="mt-3 text-xs font-bold uppercase tracking-wider text-white/70">Guessers</div>
                <div className="mt-1 flex flex-wrap gap-1">{ops.map((p) => <Member key={p.id} p={p} me={me} />)}</div>
                {!(ops.some((p) => p.id === me)) && <button className="mt-2 rounded-full bg-black/30 px-3 py-1 text-xs font-bold hover:bg-black/40" data-testid={`ow-join-${t}-op`} onClick={() => void act({ type: "join_team", team: t, role: "operative" })}>Join as guesser</button>}
              </div>
            );
          })}
        </div>

        {isHost ? (
          <div className="mt-4 flex flex-wrap items-end gap-4 rounded-3xl bg-white/5 p-4 ring-1 ring-white/10">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-white/60">Timer</label>
              <select className="mt-1 block rounded-xl bg-black/30 px-3 py-2 text-sm" value={state.settings.timerSec} onChange={(e) => void act({ type: "settings", settings: { timerSec: Number(e.target.value) } })}>
                {OW_TIMER_CHOICES.map((s) => <option key={s} value={s}>{s === 0 ? "No timer" : `${s / 60 >= 1 && s % 60 === 0 ? `${s / 60} min` : `${s}s`} per turn`}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-white/60">Words</label>
              <select className="mt-1 block rounded-xl bg-black/30 px-3 py-2 text-sm" value={state.settings.pack} onChange={(e) => void act({ type: "settings", settings: { pack: e.target.value as "standard" } })}>
                <option value="standard">Standard</option>
                <option value="easy">Easy (kids & family)</option>
                <option value="mixed">Mixed</option>
              </select>
            </div>
            <button className="btn border border-white/30 text-white hover:bg-white/10" onClick={() => void act({ type: "shuffle_teams" })}>🔀 Random teams</button>
            <button className="btn-primary ml-auto" data-testid="ow-start" onClick={() => void act({ type: "start" })}>Start game ▶</button>
          </div>
        ) : (
          <p className="mt-4 text-sm text-white/70">Waiting for <b>{state.players.find((p) => p.id === state.hostId)?.nickname ?? "the host"}</b> to start…</p>
        )}
        {err && <p className="mt-3 text-sm font-bold text-rose-300">{err}</p>}
        <Rules />
      </div>
    </div>
  );
}

export function Rules() {
  return (
    <details className="mt-4 rounded-3xl bg-white/5 p-4 text-sm ring-1 ring-white/10">
      <summary className="cursor-pointer text-lg font-black">How to play</summary>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-white/85">
        <li>Two teams, Red and Blue. Each team has one <b>Spymaster</b>; everyone else guesses. You need at least 4 players.</li>
        <li>25 words are on the board. The team that starts owns 9, the other team 8, 7 are bystanders and 1 is the 💣 bomb.</li>
        <li>Only the Spymasters see which word belongs to whom.</li>
        <li>On your turn your Spymaster types <b>one word and a number</b> — e.g. <i>OCEAN 3</i> — linking as many of your words as possible. The clue can&apos;t be a word on the board.</li>
        <li>Guessers tap words: your colour → keep guessing (up to number + 1); a bystander or the other team&apos;s word → your turn ends; the bomb → you lose instantly.</li>
        <li>First team to uncover all of its words wins.</li>
      </ul>
    </details>
  );
}
