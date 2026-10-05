"use client";
import { tileOf } from "@monumental/shared";

/** Pip positions on a 3×3 grid for 0–6. */
const PIPS: Record<number, [number, number][]> = {
  0: [],
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

function Half({ n, y, hl }: { n: number; y: number; hl: boolean }) {
  return (
    <g>
      {PIPS[n].map(([cx, cy], i) => (
        <circle key={i} cx={9 + cx * 11} cy={y + 9 + cy * 11} r={3.6} className={hl ? "fill-brand-600" : "fill-ink-900"} />
      ))}
    </g>
  );
}

/**
 * A domino. `id` null → face down. Vertical by default (40×80 viewBox).
 * `highlight` colours the pips on halves matching that number.
 */
export default function DominoTile({
  id,
  size = 44,
  selected = false,
  highlight,
  onClick,
  disabled,
  className = "",
  flip = false,
  style,
}: {
  id: number | null;
  size?: number;
  selected?: boolean;
  highlight?: number | null;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  /** Play a flip-over animation (face-down → face-up) when mounted. */
  flip?: boolean;
  style?: React.CSSProperties;
}) {
  const w = size, h = size * 2;
  const face = id !== null ? tileOf(id) : null;
  const body = (
    <svg viewBox="0 0 40 80" width={w} height={h} className="block drop-shadow-[0_3px_4px_rgba(0,0,0,.35)]" aria-hidden>
      {face ? (
        <>
          <rect x="1" y="1" width="38" height="78" rx="6" className="fill-[#fbf7ec] stroke-ink-900/30" strokeWidth="1.5" />
          <line x1="6" x2="34" y1="40" y2="40" className="stroke-ink-900/40" strokeWidth="1.5" />
          <circle cx="20" cy="40" r="2" className="fill-ink-500" />
          <Half n={face[0]} y={2} hl={highlight != null && face[0] === highlight} />
          <Half n={face[1]} y={42} hl={highlight != null && face[1] === highlight} />
        </>
      ) : (
        <>
          <rect x="1" y="1" width="38" height="78" rx="6" fill="#1f2a44" stroke="#0b1020" strokeWidth="1.5" />
          <rect x="5" y="5" width="30" height="70" rx="4" fill="none" stroke="#f97316" strokeOpacity=".55" strokeWidth="1.5" />
          <path d="M20,22 L27,40 L20,58 L13,40 Z" fill="#f97316" fillOpacity=".5" />
        </>
      )}
    </svg>
  );
  const cls = `relative inline-block transition-transform duration-150 ${flip ? "animate-[tileFlip_.6s_ease-out_both]" : ""} ${selected ? "-translate-y-3" : ""} ${className}`;
  if (!onClick) return <span className={cls} style={style}>{body}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={face ? `Tile ${face[0]}|${face[1]}` : "Face-down tile"}
      className={`${cls} rounded-lg outline-none focus-visible:ring-4 focus-visible:ring-brand-400 ${selected ? "ring-4 ring-brand-500" : ""} ${disabled ? "cursor-default opacity-90" : selected ? "cursor-pointer" : "cursor-pointer hover:-translate-y-1"}`}
      style={style}
    >
      {body}
    </button>
  );
}

/** Small face-down fan showing how many tiles a player holds. */
export function TileFan({ count, max = 9 }: { count: number; max?: number }) {
  const n = Math.min(count, max);
  return (
    <div className="flex h-9 items-end" aria-label={`${count} tiles`}>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="-ml-2 first:ml-0" style={{ transform: `rotate(${(i - (n - 1) / 2) * 5}deg)` }}>
          <DominoTile id={null} size={14} />
        </span>
      ))}
    </div>
  );
}
