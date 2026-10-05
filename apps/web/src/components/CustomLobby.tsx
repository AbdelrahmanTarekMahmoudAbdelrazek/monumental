"use client";
import { useEffect, useState } from "react";
import { DUEL_CATEGORIES, getLevel, type CustomRoomSettings, type RoomState, type SessionResult } from "@monumental/shared";
import RoomSettingsForm from "./RoomSettingsForm";

/**
 * Overlay shown in host-run rooms while waiting for the host (before the first
 * game and between games). Host sees Start / Play again and can edit settings;
 * everyone sees the invite link, who's in, and the current settings.
 */
export default function CustomLobby({
  state,
  me,
  sessionResult,
  onStart,
  onUpdate,
}: {
  state: RoomState;
  me: string | null;
  sessionResult: SessionResult | null;
  onStart: () => Promise<{ ok: boolean; error?: string }>;
  onUpdate: (s: CustomRoomSettings) => Promise<{ ok: boolean; error?: string }>;
}) {
  const custom = state.custom!;
  const isHost = me === custom.hostId;
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CustomRoomSettings>(custom.settings);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const host = state.players.find((p) => p.id === custom.hostId);
  const connected = state.players.filter((p) => p.connected);
  const code = state.roomId.replace(/^c:/, "");

  useEffect(() => setLink(`${window.location.origin}/r/${code}`), [code]);
  useEffect(() => { if (!editing) setDraft(custom.settings); }, [custom.settings, editing]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); } catch { /* ignore */ }
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };
  const share = async () => {
    const text = `Join my How Big? game "${custom.level.name}" — code ${code}`;
    if (navigator.share) { try { await navigator.share({ title: "How Big?", text, url: link }); return; } catch { /* cancelled */ } }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${link}`)}`, "_blank");
  };
  const start = async () => {
    setBusy(true); setErr(null);
    const r = await onStart();
    setBusy(false);
    if (!r.ok) setErr(r.error ?? "Could not start");
  };
  const save = async () => {
    setBusy(true); setErr(null);
    const r = await onUpdate(draft);
    setBusy(false);
    if (r.ok) setEditing(false); else setErr(r.error ?? "Could not save");
  };

  const s = custom.settings;
  const content = s.kind === "duel"
    ? s.duelCats.map((c) => `${DUEL_CATEGORIES[c].emoji} ${DUEL_CATEGORIES[c].label}`).join(" · ")
    : `${getLevel(s.baseLevelId).name} · ${{ full: "grid + ruler", ruler: "ruler", none: "no helpers", silhouette: "silhouettes" }[s.helpers]}`;
  const winner = sessionResult?.leaderboard[0];

  return (
    <div className="absolute inset-0 z-30 overflow-auto bg-ink-950/70 backdrop-blur-sm">
      <div className="flex min-h-full items-center justify-center p-3">
        <div className="animate-pop w-full max-w-xl rounded-3xl bg-white p-5 shadow-2xl dark:bg-ink-900 md:p-6">
          {/* results of the game that just ended */}
          {state.phase === "finished" && sessionResult && (
            <div className="mb-5 rounded-2xl bg-brand-500/10 p-4">
              <div className="text-xs font-semibold uppercase tracking-widest text-brand-600">Game over</div>
              <div className="mt-1 text-xl font-black">{winner && sessionResult.winnerId ? `🏆 ${winner.nickname} wins with ${winner.totalPoints} pts` : "No winner this time"}</div>
              <ol className="mt-2 space-y-0.5 text-sm">
                {sessionResult.leaderboard.slice(0, 8).map((p, i) => (
                  <li key={p.playerId} className={`flex justify-between rounded-lg px-2 py-0.5 ${p.playerId === me ? "bg-brand-500/10" : ""}`}>
                    <span><span className="mr-2 inline-block w-4 text-xs font-bold text-ink-400">{i + 1}</span>{p.nickname}</span>
                    <b className="tabular-nums">{p.totalPoints}</b>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-widest text-brand-600">Private room · {code}</div>
              <h2 className="text-2xl font-black">{custom.level.name}</h2>
              <p className="text-sm text-ink-500 dark:text-ink-300">Hosted by {host?.nickname ?? "…"}{isHost ? " (you)" : ""}</p>
            </div>
            <div className="rounded-2xl bg-ink-100 px-3 py-2 text-center dark:bg-ink-800">
              <div className="text-2xl font-black tabular-nums">{connected.length}</div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">in room</div>
            </div>
          </div>

          {/* invite */}
          <div className="mt-4">
            <label className="label">Invite link</label>
            <div className="flex gap-2">
              <input className="input font-mono text-xs" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
              <button className="btn-ghost shrink-0 !px-3 text-sm" onClick={copy}>{copied ? "Copied ✓" : "Copy"}</button>
              <button className="btn-ghost shrink-0 !px-3 text-sm" onClick={share}>Share</button>
            </div>
          </div>

          {/* players */}
          <div className="mt-4 flex flex-wrap gap-1.5">
            {connected.map((p) => (
              <span key={p.id} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${p.id === custom.hostId ? "bg-brand-500 text-white" : "bg-ink-100 dark:bg-ink-800"}`}>
                {p.id === custom.hostId ? "👑 " : ""}{p.nickname}{p.id === me ? " (you)" : ""}
              </span>
            ))}
          </div>

          {/* settings */}
          {editing && isHost ? (
            <div className="mt-5 rounded-2xl ring-1 ring-ink-900/10 p-4 dark:ring-white/10">
              <RoomSettingsForm value={draft} onChange={setDraft} compact />
              <div className="mt-4 flex gap-2">
                <button className="btn-primary" disabled={busy} onClick={save}>Save settings</button>
                <button className="btn-ghost" onClick={() => { setEditing(false); setDraft(custom.settings); }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="mt-5 grid grid-cols-3 gap-2 text-center text-sm">
              <Stat label="Rounds" value={String(s.rounds)} />
              <Stat label="Per round" value={`${s.timerSec}s`} />
              <Stat label="Answer shown" value={`${s.revealSec}s`} />
              <div className="col-span-3 rounded-xl bg-ink-50 px-3 py-2 text-xs text-ink-600 dark:bg-ink-800 dark:text-ink-200">
                {s.kind === "duel" ? "⚖️ Which is more? — " : "📐 How big? — "}{content}
              </div>
            </div>
          )}

          {err && <p className="mt-3 text-sm font-semibold text-rose-500">{err}</p>}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {isHost ? (
              <>
                <button className="btn-primary flex-1 py-3 text-lg" disabled={busy || editing} onClick={start}>
                  {state.phase === "finished" ? "Play again ▶" : `Start game ▶`}
                </button>
                {!editing && <button className="btn-ghost" onClick={() => setEditing(true)}>⚙️ Settings</button>}
              </>
            ) : (
              <div className="w-full rounded-2xl bg-ink-50 py-3 text-center text-sm font-semibold text-ink-600 dark:bg-ink-800 dark:text-ink-200">
                <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                Waiting for {host?.nickname ?? "the host"} to {state.phase === "finished" ? "start the next game" : "start"}…
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-ink-50 py-2 dark:bg-ink-800">
      <div className="text-lg font-black tabular-nums">{value}</div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">{label}</div>
    </div>
  );
}
