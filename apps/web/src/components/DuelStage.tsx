"use client";
import { useEffect, useRef, useState } from "react";
import { DUEL_CATEGORIES, fmtDuelValue, type DuelItem } from "@monumental/shared";
import { sfx } from "@/lib/sound";

/**
 * "Which is more?" split screen: two full-height cards with an OR badge between
 * them. Tap a side to answer; on reveal both values count up, the winner glows.
 * Side-by-side on wide screens, stacked top/bottom on phones.
 */
export interface DuelStageProps {
  a: DuelItem;
  b: DuelItem;
  myPick: "a" | "b" | null;
  onPick?: (side: "a" | "b") => void;
  /** Set during the reveal. */
  winner?: "a" | "b" | null;
  disabled?: boolean;
  /** Small per-side tally shown on reveal, e.g. how many players picked it. */
  tally?: { a: number; b: number };
  className?: string;
}

// Category palettes (two-stop gradients); the item id picks one deterministically.
const PALETTES: Record<string, [string, string][]> = {
  movies: [["#2b0f3a", "#7a1f4f"], ["#0f1c3a", "#3a2a7a"], ["#3a0f12", "#8a3216"], ["#0b2a2a", "#1f6b62"], ["#1a1a1a", "#5a4a1a"]],
  celebs: [["#3a1d0b", "#b8661c"], ["#0b2a3a", "#1f7aa6"], ["#2a0b3a", "#8a2fb0"], ["#0b3a22", "#1fa66b"], ["#3a0b1d", "#c23a5c"]],
  older: [["#3a2a0b", "#a67c1f"], ["#2a1f14", "#7a5a36"], ["#14262a", "#36707a"], ["#2a1414", "#7a3636"]],
  area: [["#0b2a3a", "#1f6ba6"], ["#0b3a2a", "#1fa67c"], ["#1d1a3a", "#4a3fb0"], ["#3a2a0b", "#b0801f"]],
  rivers: [["#06243a", "#0e6aa6"], ["#08302a", "#159a7a"], ["#0b1d3a", "#2f5fc4"], ["#062a33", "#0f8a9e"]],
  heavier: [["#2a2316", "#8a6a2a"], ["#1e2a16", "#5a7a2a"], ["#2a1a16", "#8a4a2a"], ["#16222a", "#3a5a6a"]],
  population: [["#3a0b26", "#b01f6b"], ["#0b263a", "#1f6bb0"], ["#26300b", "#6b8a1f"], ["#3a1a0b", "#b0521f"]],
};
function palette(item: DuelItem): [string, string] {
  const list = PALETTES[item.cat] ?? PALETTES.movies;
  let h = 0;
  for (const c of item.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

let outlinesPromise: Promise<Record<string, string>> | null = null;
function useOutline(key?: string) {
  const [d, setD] = useState<string | null>(null);
  useEffect(() => {
    if (!key) return;
    outlinesPromise ??= import("@/lib/countryOutlines.json").then((m) => (m.default ?? m) as Record<string, string>);
    let alive = true;
    void outlinesPromise.then((o) => alive && setD(o[key] ?? null));
    return () => { alive = false; };
  }, [key]);
  return d;
}

function useCountUp(target: number, run: boolean, ms = 900) {
  const [v, setV] = useState(run ? 0 : target);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (!run) { setV(target); return; }
    const t0 = performance.now();
    const from = target > 0 ? 0 : target;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setV(from + (target - from) * e);
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, run, ms]);
  return v;
}

export default function DuelStage({ a, b, myPick, onPick, winner, disabled, tally, className }: DuelStageProps) {
  const cat = DUEL_CATEGORIES[a.cat];
  const revealed = winner != null;
  useEffect(() => {
    if (!revealed) return;
    if (myPick == null) sfx.miss();
    else if (myPick === winner) sfx.win();
    else sfx.miss();
  }, [revealed, myPick, winner]);

  return (
    <div className={`relative flex h-full w-full flex-col overflow-hidden md:flex-row ${className ?? ""}`}>
      <DuelCard item={a} side="a" myPick={myPick} winner={winner} disabled={disabled} onPick={onPick} count={tally?.a} />
      <DuelCard item={b} side="b" myPick={myPick} winner={winner} disabled={disabled} onPick={onPick} count={tally?.b} />

      {/* OR badge */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
        <div className={`flex h-16 w-16 items-center justify-center rounded-full bg-white text-xl font-black text-ink-900 shadow-2xl ring-4 ring-black/10 md:h-24 md:w-24 md:text-3xl ${revealed ? "" : "animate-pop"}`}>
          {revealed ? (myPick == null ? "⏱" : myPick === winner ? "✓" : "✗") : "OR"}
        </div>
      </div>

      {/* question */}
      <div className="pointer-events-none absolute left-1/2 top-3 z-20 w-[min(92%,640px)] -translate-x-1/2 text-center">
        <div className="mx-auto w-fit rounded-full bg-black/45 px-4 py-1.5 text-sm font-bold text-white shadow backdrop-blur md:text-base">
          {cat.emoji} {cat.question}
        </div>
      </div>
      {revealed && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 z-20 w-[min(92%,640px)] -translate-x-1/2 text-center text-[11px] text-white/70">
          {cat.source}
        </div>
      )}
    </div>
  );
}

function DuelCard({ item, side, myPick, winner, disabled, onPick, count }: {
  item: DuelItem; side: "a" | "b"; myPick: "a" | "b" | null; winner?: "a" | "b" | null;
  disabled?: boolean; onPick?: (s: "a" | "b") => void; count?: number;
}) {
  const [c1, c2] = palette(item);
  const revealed = winner != null;
  const isWinner = revealed && winner === side;
  const picked = myPick === side;
  const outline = useOutline(item.outline);
  const shown = useCountUp(item.value, revealed && item.cat !== "older");
  const canPick = !disabled && !revealed && myPick == null && !!onPick;

  return (
    <button
      type="button"
      data-side={side}
      disabled={!canPick}
      onClick={() => { if (canPick) { sfx.lock(); onPick!(side); } }}
      className={`group relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden p-6 text-center text-white transition duration-300
        ${canPick ? "cursor-pointer hover:brightness-110 active:scale-[0.99]" : "cursor-default"}
        ${revealed && !isWinner ? "brightness-[.55] saturate-50" : ""}
        ${side === "a" ? "animate-[slideL_.45s_ease-out_both]" : "animate-[slideR_.45s_ease-out_both]"}`}
      style={{ background: `radial-gradient(120% 90% at ${side === "a" ? "30%" : "70%"} 20%, ${c2} 0%, ${c1} 70%)` }}
      aria-label={`${item.name}${revealed ? `: ${fmtDuelValue(item.cat, item.value)}` : ""}`}
    >
      <CardArt item={item} outline={outline} />

      <div className="relative z-10 flex flex-col items-center">
        <div className="max-w-md text-balance text-2xl font-black leading-tight drop-shadow md:text-4xl">{item.name}</div>
        <div className="mt-1 text-sm font-semibold uppercase tracking-widest text-white/75">{item.sub}</div>

        <div className="mt-5 h-14">
          {revealed ? (
            <div className={`animate-pop rounded-2xl px-5 py-2 text-3xl font-black tabular-nums shadow-xl md:text-5xl ${isWinner ? "bg-emerald-500" : "bg-black/50"}`}>
              {item.cat === "older" ? fmtDuelValue(item.cat, item.value) : fmtDuelValue(item.cat, roundFor(item.cat, shown))}
            </div>
          ) : picked ? (
            <div className="rounded-full bg-white px-5 py-2 text-sm font-black uppercase tracking-wider text-ink-900 shadow-xl">Your pick</div>
          ) : canPick ? (
            <div className="rounded-full border-2 border-white/70 px-5 py-2 text-sm font-bold uppercase tracking-wider opacity-0 transition group-hover:opacity-100 md:opacity-70">Tap to choose</div>
          ) : null}
        </div>
        {revealed && count != null && <div className="mt-2 text-xs text-white/80">{count} player{count === 1 ? "" : "s"} picked this</div>}
      </div>

      {/* pick / win rings */}
      {picked && <div className={`pointer-events-none absolute inset-2 rounded-2xl ring-4 ${revealed ? (isWinner ? "ring-emerald-400" : "ring-rose-500") : "ring-white"}`} />}
      {isWinner && <div className="pointer-events-none absolute inset-0 animate-[glow_1.6s_ease-in-out_infinite] bg-emerald-400/10" />}
    </button>
  );
}

function roundFor(cat: string, v: number) {
  if (cat === "movies") return Math.round(v * 10) / 10;
  if (cat === "celebs") return Math.round(v * 100) / 100;
  if (cat === "population") return v >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return Math.round(v);
}

/** Decorative, original background art per category (no posters or photos). */
function CardArt({ item, outline }: { item: DuelItem; outline: string | null }) {
  if (item.outline) {
    return (
      <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 m-auto h-[78%] w-[78%] opacity-35 drop-shadow-[0_10px_30px_rgba(0,0,0,.4)] transition-opacity duration-500" preserveAspectRatio="xMidYMid meet" aria-hidden>
        {outline && <path d={outline} fill="white" />}
      </svg>
    );
  }
  if (item.cat === "movies") {
    // film-strip edges + a big star, all original vector shapes
    const strip = "repeating-linear-gradient(to bottom, transparent 0 10px, rgba(0,0,0,.85) 10px 26px, transparent 26px 40px)";
    return (
      <div className="pointer-events-none absolute inset-0 opacity-[.16]" aria-hidden>
        <div className="absolute inset-y-0 left-0 w-8 bg-white" style={{ maskImage: strip, WebkitMaskImage: strip }} />
        <div className="absolute inset-y-0 left-0 w-8 border-r-2 border-white" />
        <div className="absolute inset-y-0 right-0 w-8 bg-white" style={{ maskImage: strip, WebkitMaskImage: strip }} />
        <div className="absolute inset-y-0 right-0 w-8 border-l-2 border-white" />
        <div className="absolute inset-0 flex items-center justify-center text-[14rem] font-black leading-none text-white">★</div>
      </div>
    );
  }
  if (item.cat === "celebs") {
    const initials = item.name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
    return (
      <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 m-auto h-[85%] w-[85%] opacity-[.14]" aria-hidden>
        <text x="50" y="66" textAnchor="middle" fontSize="54" fontWeight="900" fill="white">{initials}</text>
        {Array.from({ length: 11 }, (_, i) => <rect key={i} x="2" y={4 + i * 9} width={i % 5 === 0 ? 10 : 5} height="1.2" fill="white" />)}
      </svg>
    );
  }
  if (item.cat === "rivers") {
    // flowing water: layered animated waves
    return (
      <svg viewBox="0 0 200 200" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full opacity-[.18]" aria-hidden>
        {[40, 75, 110, 145, 180].map((y, i) => (
          <path key={y} d={`M-40,${y} C0,${y - 18} 40,${y + 18} 80,${y} S160,${y - 18} 200,${y} S280,${y + 18} 320,${y}`} fill="none" stroke="white" strokeWidth={6 - i * 0.6} strokeLinecap="round" style={{ animation: `riverFlow ${6 + i}s linear infinite` }} />
        ))}
      </svg>
    );
  }
  if (item.cat === "heavier") {
    // balance scale
    return (
      <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 m-auto h-[70%] w-[70%] opacity-[.13]" aria-hidden>
        <rect x="48" y="14" width="4" height="66" fill="white" />
        <rect x="30" y="80" width="40" height="6" rx="2" fill="white" />
        <circle cx="50" cy="14" r="4" fill="white" />
        <g style={{ transformOrigin: "50px 20px", animation: "sway 4s ease-in-out infinite" }}>
          <rect x="12" y="18" width="76" height="3" fill="white" />
          <path d="M14,21 L6,46 L22,46 Z M86,21 L78,46 L94,46 Z" fill="none" stroke="white" strokeWidth="1.5" />
          <path d="M2,46 C2,54 26,54 26,46 Z M74,46 C74,54 98,54 98,46 Z" fill="white" />
        </g>
      </svg>
    );
  }
  // older: big year-ish hourglass
  return (
    <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 m-auto h-[70%] w-[70%] opacity-[.12]" aria-hidden>
      <path d="M25,8 L75,8 L75,14 C75,32 56,42 56,50 C56,58 75,68 75,86 L75,92 L25,92 L25,86 C25,68 44,58 44,50 C44,42 25,32 25,14 Z M31,14 C31,28 50,38 50,46 C50,38 69,28 69,14 Z M33,86 L67,86 C67,74 50,66 50,58 C50,66 33,74 33,86 Z" fill="white" fillRule="evenodd" />
    </svg>
  );
}
