"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeLayout, rulerStep, type HelperLevel, type Monument } from "@monumental/shared";
import { sfx } from "@/lib/sound";
import { fmtPct, fmtM, fmtExact } from "@/lib/format";

export interface GameStageProps {
  base: Monument;
  target: Monument;
  /** Current guess (target height as % of base). Controlled. */
  guessPct: number;
  onGuessChange: (pct: number) => void;
  helpers: HelperLevel;
  /** When set the stage animates the target to the true size and shows the overlay. */
  reveal?: { realPct: number; guessPct: number | null; errorPct: number | null; points: number } | null;
  disabled?: boolean;
  /** Hide names (silhouette-only levels still show names; "mystery" would be a future mode). */
  className?: string;
}

const MIN_PCT = 0.2;
const MAX_PCT = 40000;

function useSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ w: 800, h: 480 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const r = e.contentRect;
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, size };
}

/** Exponential smoothing toward a target value every frame (used for zoom-to-fit + reveal). */
function useSmooth(target: number, speed = 0.18, snap = false) {
  const [v, setV] = useState(target);
  const raf = useRef<number | null>(null);
  const cur = useRef(target);
  useEffect(() => {
    if (snap) { cur.current = target; setV(target); return; }
    const step = () => {
      const diff = target - cur.current;
      if (Math.abs(diff) < Math.max(0.0005 * Math.abs(target), 0.001)) { cur.current = target; setV(target); raf.current = null; return; }
      cur.current += diff * speed;
      setV(cur.current);
      raf.current = requestAnimationFrame(step);
    };
    if (raf.current == null) raf.current = requestAnimationFrame(step);
    return () => { if (raf.current != null) { cancelAnimationFrame(raf.current); raf.current = null; } };
  }, [target, speed, snap]);
  return v;
}

export default function GameStage({ base, target, guessPct, onGuessChange, helpers, reveal, disabled, className }: GameStageProps) {
  const { ref, size } = useSize<HTMLDivElement>();
  const dragging = useRef<{ startY: number; startPct: number; ppm: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Displayed target height: the guess while playing, the truth after reveal (animated).
  const shownPct = reveal ? reveal.realPct : guessPct;
  const displayTargetH = useSmooth((shownPct / 100) * base.heightM, reveal ? 0.12 : 0.35, !reveal && isDragging);
  // Zoom-to-fit uses a slower-smoothed scale so the scene doesn't jitter while dragging.
  const layout = useMemo(
    () =>
      computeLayout({
        viewportW: size.w,
        viewportH: size.h,
        baseHeightM: base.heightM,
        baseSil: base.silhouette,
        targetHeightM: Math.max(displayTargetH, base.heightM * 0.004),
        targetSil: target.silhouette,
        fitHeightM: reveal && reveal.guessPct != null ? Math.max(reveal.realPct, reveal.guessPct) / 100 * base.heightM : undefined,
        topPad: 56,
        groundPad: 44,
      }),
    [size, base, target, displayTargetH, reveal],
  );

  // After reveal: ghost of the player's guess
  const guessH = reveal && reveal.guessPct != null ? (reveal.guessPct / 100) * base.heightM : null;

  useEffect(() => { if (reveal) sfx.reveal(); }, [reveal]);

  // ───────── drag handling (pointer events = mouse + touch + pen) ─────────
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || reveal) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragging.current = { startY: e.clientY, startPct: guessPct, ppm: layout.ppm };
      setIsDragging(true);
      e.preventDefault();
    },
    [disabled, reveal, guessPct, layout.ppm],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragging.current;
      if (!d) return;
      const dyPx = d.startY - e.clientY; // up = taller
      const dM = dyPx / d.ppm;
      let pct = ((d.startPct / 100) * base.heightM + dM) / base.heightM * 100;
      pct = Math.min(MAX_PCT, Math.max(MIN_PCT, pct));
      // Precision: snap to 0.5% below 200%, 1% up to 1000%, else 5%
      const step = pct < 10 ? 0.1 : pct < 200 ? 0.5 : pct < 1000 ? 1 : 5;
      pct = Math.round(pct / step) * step;
      if (pct !== guessPct) { onGuessChange(pct); if (Math.abs(pct - guessPct) >= step) sfx.tick(); }
    },
    [base.heightM, guessPct, onGuessChange],
  );
  const endDrag = useCallback(() => { dragging.current = null; setIsDragging(false); }, []);

  // Keyboard accessibility on the handle
  const onKey = (e: React.KeyboardEvent) => {
    if (disabled || reveal) return;
    const big = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") onGuessChange(Math.min(MAX_PCT, guessPct + big));
    if (e.key === "ArrowDown" || e.key === "ArrowLeft") onGuessChange(Math.max(MIN_PCT, guessPct - big));
  };

  const { base: B, target: T, groundY, ppm, visibleMetres } = layout;
  const showGrid = helpers === "full";
  const showRuler = helpers === "full" || helpers === "ruler";
  const step = rulerStep(visibleMetres);
  const ticks: number[] = [];
  for (let m = step; m <= visibleMetres + 1e-9; m += step) ticks.push(m);

  // Space pairs (planets, stars) get a night-sky scene.
  const space = base.category === "space" && target.category === "space";

  const handleY = groundY - displayTargetH * ppm;
  const handleX = T.x + T.w / 2;

  return (
    <div ref={ref} className={`relative h-full w-full select-none touch-none ${className ?? ""}`} style={{ minHeight: 320 }}>
      <svg width={size.w} height={size.h} className="absolute inset-0 block" role="img" aria-label={`${base.name} next to ${target.name}`}>
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="[stop-color:#bfe3ff] dark:[stop-color:#0d1b3a]" />
            <stop offset="70%" className="[stop-color:#e9f5ff] dark:[stop-color:#1a2a52]" />
            <stop offset="100%" className="[stop-color:#fff3e0] dark:[stop-color:#2b2446]" />
          </linearGradient>
          <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="[stop-color:#c9b28a] dark:[stop-color:#3a3350]" />
            <stop offset="100%" className="[stop-color:#a98e63] dark:[stop-color:#241f36]" />
          </linearGradient>
          <linearGradient id="silBase" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="[stop-color:#3b4a6b] dark:[stop-color:#aab4d0]" />
            <stop offset="100%" className="[stop-color:#1f2a44] dark:[stop-color:#6f7ea3]" />
          </linearGradient>
          <linearGradient id="silTarget" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="[stop-color:#fb923c] dark:[stop-color:#fdba74]" />
            <stop offset="100%" className="[stop-color:#c2410c] dark:[stop-color:#ea580c]" />
          </linearGradient>
          <linearGradient id="spaceSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#03040c" />
            <stop offset="65%" stopColor="#0b1030" />
            <stop offset="100%" stopColor="#1d1846" />
          </linearGradient>
          <linearGradient id="spaceGround" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#272247" />
            <stop offset="100%" stopColor="#120f26" />
          </linearGradient>
          <linearGradient id="silBaseSpace" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#dbe4ff" />
            <stop offset="100%" stopColor="#8f9bc4" />
          </linearGradient>
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="6" stdDeviation="6" floodOpacity="0.25" />
          </filter>
        </defs>

        {/* sky */}
        <rect x="0" y="0" width={size.w} height={groundY} fill={space ? "url(#spaceSky)" : "url(#sky)"} />
        {space ? (
          <Stars w={size.w} h={groundY} />
        ) : (
          <g className="opacity-70 dark:opacity-20" style={{ animation: "drift 90s linear infinite" }}>
            <Cloud x={size.w * 0.1} y={40} s={1} />
            <Cloud x={size.w * 0.55} y={80} s={0.7} />
          </g>
        )}

        {/* grid (level 1-2) */}
        {showGrid &&
          ticks.map((m) => (
            <line key={m} x1={0} x2={size.w} y1={groundY - m * ppm} y2={groundY - m * ppm} className="stroke-ink-900/10 dark:stroke-white/10" strokeDasharray="4 6" />
          ))}

        {/* ground */}
        <rect x="0" y={groundY} width={size.w} height={size.h - groundY} fill={space ? "url(#spaceGround)" : "url(#ground)"} />
        <line x1="0" x2={size.w} y1={groundY} y2={groundY} className="stroke-ink-900/40 dark:stroke-white/30" strokeWidth={2} />

        {/* ruler (levels 1-4) */}
        {showRuler && (
          <g className={`text-[10px] font-medium ${space ? "fill-ink-200" : "fill-ink-700 dark:fill-ink-200"}`}>
            <line x1={8} x2={8} y1={groundY} y2={groundY - visibleMetres * ppm} className="stroke-ink-900/40 dark:stroke-white/40" />
            {ticks.map((m) => (
              <g key={m}>
                <line x1={4} x2={12} y1={groundY - m * ppm} y2={groundY - m * ppm} className="stroke-ink-900/50 dark:stroke-white/50" />
                <text x={16} y={groundY - m * ppm + 3}>{fmtM(m)}</text>
              </g>
            ))}
          </g>
        )}

        {/* base monument */}
        <g transform={`translate(${B.x} ${B.y}) scale(${B.h / 100})`} filter="url(#shadow)">
          <path d={base.silhouette.d} fill={space ? "url(#silBaseSpace)" : "url(#silBase)"} />
        </g>
        {/* base labels (on the ground strip) */}
        <g className={`text-[12px] font-bold ${space ? "fill-white" : "fill-ink-900 dark:fill-ink-50"}`}>
          <text x={B.x + B.w / 2} y={groundY + 16} textAnchor="middle">{base.name}</text>
          <text x={B.x + B.w / 2} y={groundY + 31} textAnchor="middle" className={`text-[11px] font-medium ${space ? "fill-ink-200" : "fill-ink-800 dark:fill-ink-200"}`}>
            {fmtExact(base.heightM)} · 100%
          </text>
        </g>

        {/* target monument */}
        <g transform={`translate(${T.x} ${T.y}) scale(${Math.max(T.h, 0.01) / 100})`} filter="url(#shadow)">
          <path d={target.silhouette.d} fill="url(#silTarget)" />
        </g>
        <g className={`text-[12px] font-bold ${space ? "fill-white" : "fill-ink-900 dark:fill-ink-50"}`}>
          <text x={T.x + T.w / 2} y={groundY + 16} textAnchor="middle">{target.name}</text>
          <text x={T.x + T.w / 2} y={groundY + 31} textAnchor="middle" className={`text-[11px] font-medium ${space ? "fill-ink-200" : "fill-ink-800 dark:fill-ink-200"}`}>
            {reveal ? `${fmtExact(target.heightM)} · ${fmtPct(reveal.realPct)}` : "?"}
          </text>
        </g>

        {/* ghost of the guess after reveal */}
        {guessH != null && reveal && (
          <g className="animate-rise">
            {/* CSS animations override SVG transform attributes, so the geometry lives on an inner group */}
            <g transform={`translate(${T.x + T.w / 2 - ((target.silhouette.w / 100) * guessH * ppm) / 2} ${groundY - guessH * ppm}) scale(${(guessH * ppm) / 100})`}>
              <path d={target.silhouette.d} className="fill-white/35 stroke-brand-700 dark:fill-black/30 dark:stroke-brand-200" strokeWidth={100 / Math.max(1, guessH * ppm) * 2} strokeDasharray={`${100 / Math.max(1, guessH * ppm) * 6} ${100 / Math.max(1, guessH * ppm) * 4}`} />
              <text x={target.silhouette.w / 2} y={-6} textAnchor="middle" className="fill-brand-700 dark:fill-brand-300" style={{ fontSize: `${100 / Math.max(1, guessH * ppm) * 11}px`, fontWeight: 700 }}>your guess</text>
            </g>
          </g>
        )}

        {/* height guide line from base top */}
        <line x1={B.x + B.w} x2={T.x} y1={B.y} y2={B.y} className="stroke-ink-900/25 dark:stroke-white/25" strokeDasharray="3 5" />

        {/* drag handle */}
        {!reveal && (
          <g
            role="slider"
            aria-label="Target height"
            aria-valuemin={MIN_PCT}
            aria-valuemax={MAX_PCT}
            aria-valuenow={guessPct}
            tabIndex={disabled ? -1 : 0}
            onKeyDown={onKey}
            className={`outline-none ${disabled ? "cursor-not-allowed" : "cursor-ns-resize"}`}
          >
            <line x1={T.x - 10} x2={T.x + T.w + 10} y1={handleY} y2={handleY} className="stroke-brand-600 dark:stroke-brand-300" strokeWidth={2} strokeDasharray="6 4" />
            {!disabled && !isDragging && <circle cx={handleX} cy={handleY} r={18} className="animate-ping fill-brand-500/40" style={{ transformOrigin: `${handleX}px ${handleY}px` }} />}
            <circle cx={handleX} cy={handleY} r={isDragging ? 22 : 18} className="fill-brand-500 stroke-white transition-[r] dark:stroke-ink-900" strokeWidth={3} />
            <path d={`M${handleX - 6},${handleY - 4} l6,-6 l6,6 M${handleX - 6},${handleY + 4} l6,6 l6,-6`} fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            {/* big invisible hit area for touch */}
            <rect x={T.x - 30} y={handleY - 40} width={T.w + 60} height={80} fill="transparent" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} />
          </g>
        )}
      </svg>

      {/* live readout */}
      <div className="pointer-events-none absolute left-1/2 top-3 w-[min(92%,560px)] -translate-x-1/2 px-16 sm:px-0">
        {!reveal ? (
          <div className="mx-auto w-fit max-w-full rounded-full bg-white/85 px-3 py-1.5 text-center text-xs font-semibold text-ink-800 shadow backdrop-blur dark:bg-ink-900/80 dark:text-ink-50 sm:px-4 sm:text-sm">
            <span className="hidden sm:inline">Your guess: </span><span className="tabular-nums text-brand-600 dark:text-brand-300">{fmtPct(guessPct)}</span> of the base
            <span className="ml-2 font-medium text-ink-500 dark:text-ink-300">≈ {fmtM((guessPct / 100) * base.heightM)}</span>
          </div>
        ) : (
          <RevealCard reveal={reveal} base={base} target={target} />
        )}
      </div>
    </div>
  );
}

function RevealCard({ reveal, base, target }: { reveal: NonNullable<GameStageProps["reveal"]>; base: Monument; target: Monument }) {
  const err = reveal.errorPct;
  const grade = err == null ? "miss" : err < 2 ? "perfect" : err < 6 ? "great" : err < 15 ? "close" : "off";
  const colors: Record<string, string> = {
    perfect: "bg-emerald-500 text-white",
    great: "bg-emerald-400 text-ink-900",
    close: "bg-amber-400 text-ink-900",
    off: "bg-rose-400 text-white",
    miss: "bg-ink-500 text-white",
  };
  useEffect(() => {
    if (reveal.points >= 3) sfx.win();
    else if (reveal.points > 0) sfx.points();
    else sfx.miss();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="animate-pop rounded-2xl bg-white/95 px-5 py-3 text-center shadow-xl backdrop-blur dark:bg-ink-900/95">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-ink-300">
        {target.name}&apos;s {target.measure === "diameter" ? "diameter" : target.measure === "length" ? "length" : "height"} is <span className="font-bold text-ink-800 dark:text-ink-50">{fmtPct(reveal.realPct)}</span> of {base.name}
      </div>
      <div className="mt-1 flex items-center justify-center gap-4 text-sm">
        <div>
          <div className="text-[11px] text-ink-500 dark:text-ink-300">Your guess</div>
          <div className="font-bold tabular-nums text-brand-600 dark:text-brand-300">{reveal.guessPct == null ? "—" : fmtPct(reveal.guessPct)}</div>
        </div>
        <div>
          <div className="text-[11px] text-ink-500 dark:text-ink-300">Real</div>
          <div className="font-bold tabular-nums text-ink-800 dark:text-ink-50">{fmtPct(reveal.realPct)}</div>
        </div>
        <div>
          <div className="text-[11px] text-ink-500 dark:text-ink-300">Error</div>
          <div className={`rounded-full px-2 font-bold tabular-nums ${colors[grade]}`}>{err == null ? "no guess" : `${err.toFixed(1)} pts`}</div>
        </div>
        <div>
          <div className="text-[11px] text-ink-500 dark:text-ink-300">Points</div>
          <div className="font-black tabular-nums text-ink-800 dark:text-ink-50">+{reveal.points}</div>
        </div>
      </div>
      <div className="mt-1 text-[11px] text-ink-500 dark:text-ink-300">
        {fmtExact(target.heightM)} — {target.heightNote}
      </div>
    </div>
  );
}

/** Deterministic twinkling starfield (no Math.random so SSR and client agree). */
function Stars({ w, h }: { w: number; h: number }) {
  const stars = useMemo(() => {
    const out: { x: number; y: number; r: number; d: number }[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 90; i++) out.push({ x: rnd() * w, y: rnd() * h, r: rnd() * 1.4 + 0.3, d: rnd() * 4 });
    return out;
  }, [w, h]);
  return (
    <g>
      {stars.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="white" style={{ animation: `twinkle ${3 + (i % 4)}s ease-in-out ${s.d}s infinite` }} />
      ))}
    </g>
  );
}

function Cloud({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} className="fill-white">
      <ellipse cx="0" cy="0" rx="34" ry="14" />
      <ellipse cx="22" cy="-8" rx="24" ry="16" />
      <ellipse cx="-20" cy="-4" rx="20" ry="12" />
    </g>
  );
}

export { fmtPct, fmtM, fmtExact } from "@/lib/format";
