"use client";
import {
  CUSTOM_LIMITS,
  DUEL_CAT_CHOICES,
  SIZE_LEVEL_CHOICES,
  getLevel,
  type CustomRoomSettings,
  type DuelCategoryId,
  type HelperLevel,
} from "@monumental/shared";

/**
 * The host "dashboard": game type, content, timer, rounds, reveal time.
 * Used on /host (create) and inside the waiting lobby (edit between games).
 */
export default function RoomSettingsForm({
  value,
  onChange,
  compact = false,
}: {
  value: CustomRoomSettings;
  onChange: (s: CustomRoomSettings) => void;
  compact?: boolean;
}) {
  const set = <K extends keyof CustomRoomSettings>(k: K, v: CustomRoomSettings[K]) => onChange({ ...value, [k]: v });
  const toggleCat = (c: DuelCategoryId) => {
    const has = value.duelCats.includes(c);
    const next = has ? value.duelCats.filter((x) => x !== c) : [...value.duelCats, c];
    if (next.length) set("duelCats", next);
  };
  const totalSec = value.rounds * (value.timerSec + value.revealSec);

  return (
    <div className={`grid gap-4 ${compact ? "" : "md:grid-cols-2"}`}>
      {!compact && (
        <div className="md:col-span-2">
          <label className="label">Room name (optional)</label>
          <input className="input" maxLength={CUSTOM_LIMITS.name.max} placeholder="e.g. Friday quiz night" value={value.name} onChange={(e) => set("name", e.target.value)} />
        </div>
      )}

      {/* game type */}
      <div className={compact ? "" : "md:col-span-2"}>
        <label className="label">Game</label>
        <div className="grid grid-cols-2 gap-2">
          {([
            ["duel", "⚖️ Which is more?", "Two cards — tap the bigger one"],
            ["size", "📐 How big?", "Drag to the size you think is right"],
          ] as const).map(([k, title, sub]) => (
            <button
              key={k}
              type="button"
              onClick={() => set("kind", k)}
              className={`rounded-2xl p-3 text-left ring-2 transition ${value.kind === k ? "bg-brand-500/10 ring-brand-500" : "bg-white/60 ring-ink-900/10 hover:ring-ink-900/30 dark:bg-ink-900/50 dark:ring-white/10"}`}
            >
              <div className="font-black">{title}</div>
              <div className="text-xs text-ink-500 dark:text-ink-300">{sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* content */}
      {value.kind === "duel" ? (
        <div className={compact ? "" : "md:col-span-2"}>
          <label className="label">Categories ({value.duelCats.length} selected)</label>
          <div className="flex flex-wrap gap-2">
            {DUEL_CAT_CHOICES.map((c) => {
              const on = value.duelCats.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleCat(c.id)}
                  className={`rounded-full px-3 py-1.5 text-sm font-bold transition ${on ? "bg-brand-500 text-white" : "bg-white/70 text-ink-600 ring-1 ring-ink-900/10 hover:bg-white dark:bg-ink-900/60 dark:text-ink-200 dark:ring-white/10"}`}
                >
                  {c.emoji} {c.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          <div>
            <label className="label">Content & difficulty</label>
            <select
              className="input"
              value={value.baseLevelId}
              onChange={(e) => {
                const id = Number(e.target.value);
                onChange({ ...value, baseLevelId: id, helpers: getLevel(id).helpers });
              }}
            >
              <optgroup label="Mixed (animals, nature, vehicles, space, monuments)">
                {SIZE_LEVEL_CHOICES.filter((l) => l.mode === "mixed").map((l) => <option key={l.id} value={l.id}>{l.name} — {l.tagline}</option>)}
              </optgroup>
              <optgroup label="Monuments only">
                {SIZE_LEVEL_CHOICES.filter((l) => l.mode === "classic").map((l) => <option key={l.id} value={l.id}>L{l.id} {l.name} — {l.tagline}</option>)}
              </optgroup>
            </select>
          </div>
          <div>
            <label className="label">On-screen help</label>
            <select className="input" value={value.helpers} onChange={(e) => set("helpers", e.target.value as HelperLevel)}>
              <option value="full">Grid + ruler (easiest)</option>
              <option value="ruler">Ruler only</option>
              <option value="none">No helpers</option>
              <option value="silhouette">Silhouettes, no helpers (hardest)</option>
            </select>
          </div>
        </>
      )}

      <Slider label="Time per round" unit="s" min={CUSTOM_LIMITS.timerSec.min} max={CUSTOM_LIMITS.timerSec.max} value={value.timerSec} onChange={(v) => set("timerSec", v)} />
      <Slider label="Rounds" unit="" min={CUSTOM_LIMITS.rounds.min} max={CUSTOM_LIMITS.rounds.max} value={value.rounds} onChange={(v) => set("rounds", v)} />
      <Slider label="Show answer for" unit="s" min={CUSTOM_LIMITS.revealSec.min} max={CUSTOM_LIMITS.revealSec.max} value={value.revealSec} onChange={(v) => set("revealSec", v)} />
      <div className="flex items-end text-sm text-ink-500 dark:text-ink-300">
        ≈ {Math.max(1, Math.round(totalSec / 60))} min per game
      </div>
    </div>
  );
}

function Slider({ label, unit, min, max, value, onChange }: { label: string; unit: string; min: number; max: number; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="label">{label}</label>
        <span className="text-sm font-black tabular-nums">{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-brand-500" aria-label={label} />
    </div>
  );
}
