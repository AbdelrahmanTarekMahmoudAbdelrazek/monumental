"use client";

import { ECHO_TEENS, type EchoMeta, type EchoSummary } from "@monumental/shared";

const TITLE = "font-['Special_Elite',ui-monospace,monospace]";

const STATUS: Record<EchoSummary["players"][number]["status"], { text: string; tone: string }> = {
  escaped: { text: "Got out", tone: "text-[#9FD8B8]" },
  gone: { text: "Taken for good", tone: "text-[#E0675C]" },
  rode: { text: "Taken in the lift", tone: "text-[#E0675C]" },
  lost: { text: "Lost in the dark", tone: "text-[#C9A66B]" },
  left: { text: "Left", tone: "text-[#7E887E]" },
};

function fmt(sec: number) { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** How the night went: who made it, what the Copy did, and the moments that mattered. */
export function EchoResult({ meta, me, onAgain }: { meta: EchoMeta; me: number | null; onAgain: () => void }) {
  const g = meta.goal!;
  const s = g.summary;
  const win = g.result === "win";
  const color = (n: number) => meta.players.find((p) => p.n === n)?.color ?? "#C9C4B4";
  const out = s?.players.filter((p) => p.status === "escaped").length ?? 0;
  const title = win ? (s?.rode ? "Not all of you" : "You got out") : "The hospital kept you";
  const line = win
    ? s?.rode ? "The lift doors closed with one too many inside." : out === (s?.players.length ?? 0) ? "Every one of you. The doors closed on the dark." : `${out} of ${s?.players.length} made it to the lift.`
    : "Nobody reached the lift.";

  return (
    <div className="absolute inset-0 z-20 overflow-y-auto bg-[#050706] px-4 py-8" data-testid="eh-result">
      <div className="mx-auto w-full max-w-lg">
        <div className={`${TITLE} text-center text-4xl md:text-5xl ${win && !s?.rode ? "text-[#E9E4D6]" : "text-[#D9463B]"}`}>{title}</div>
        <p className="mt-2 text-center text-[#A6AFA6]">{line}</p>
        {s && <p className="mt-1 text-center text-xs text-[#6E786E]">{fmt(s.sec)} in the hospital</p>}

        {s && (
          <>
            <section className="mt-6 rounded-2xl border border-[#222924] bg-[#0C100E] p-4" aria-label="Who made it">
              <ul className="space-y-2.5">
                {s.players.map((p) => (
                  <li key={p.n} className="flex items-center gap-3" data-testid="eh-result-player">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color(p.n) }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[#E9E4D6]">{p.name}{p.n === me ? " (you)" : ""} <span className="text-xs text-[#6E786E]">· {ECHO_TEENS.find((t) => t.id === p.teen)?.name}</span></div>
                      <div className="text-xs text-[#7E887E]">{plural(p.fuses, "fuse")} in the box · {p.strikes ? `grabbed ${p.strikes === 1 ? "once" : "twice"}` : "never grabbed"}</div>
                    </div>
                    <span className={`shrink-0 text-sm ${STATUS[p.status].tone}`}>{STATUS[p.status].text}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="mt-4 rounded-2xl border border-[#3A1A16] bg-[#120B0A] p-4" aria-label="The Copy">
              <div className={`${TITLE} text-xl text-[#F1C9C4]`}>The Copy</div>
              <ul className="mt-2 space-y-1.5 text-sm text-[#D8C3BF]" data-testid="eh-result-copy">
                {s.faces.length > 0
                  ? <li>Wore {s.faces.map((f, i) => <span key={f.n}>{i > 0 && (i === s.faces.length - 1 ? " and " : ", ")}<b style={{ color: color(f.n) }}>{f.n === me ? "your" : `${f.name}'s`}</b> face for {fmt(f.sec)}</span>)}.</li>
                  : <li>Never woke up.</li>}
                {s.voices.length > 0 && <li>Spoke with {s.voices.map((v, i) => <span key={v.n}>{i > 0 && (i === s.voices.length - 1 ? " and " : ", ")}<b style={{ color: color(v.n) }}>{v.n === me ? "your" : `${v.name}'s`}</b> voice {plural(v.times, "time")}</span>)}.</li>}
                {s.stolen > 0 && <li>Moved {plural(s.stolen, "fuse")} while nobody was looking.</li>}
                {s.faces.length > 0 && <li>{s.exposed ? `Unmasked ${plural(s.exposed, "time")}.` : "Nobody ever unmasked it."}</li>}
                {s.rode && <li className="text-[#FF8A7A]">Rode the lift with you.</li>}
              </ul>
            </section>

            {s.moments.length > 0 && (
              <section className="mt-4 rounded-2xl border border-[#222924] bg-[#0C100E] p-4" aria-label="The night">
                <div className={`${TITLE} text-xl text-[#E9E4D6]`}>The night</div>
                <ol className="mt-2 space-y-2 text-sm" data-testid="eh-result-moments">
                  {s.moments.map((m, i) => (
                    <li key={i} className="flex gap-3"><span className="w-10 shrink-0 tabular-nums text-[#6E786E]">{fmt(m.at)}</span><span className="text-[#C9C4B4]">{m.text}</span></li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}

        <button className={`${TITLE} mt-6 h-14 w-full rounded-2xl bg-[#E9E4D6] text-xl text-black`} data-testid="eh-again" onClick={onAgain}>Play again</button>
        <div className="mt-3 text-center"><a href="/echo" className="text-sm text-[#7E887E] underline">Leave</a></div>
      </div>
    </div>
  );
}
