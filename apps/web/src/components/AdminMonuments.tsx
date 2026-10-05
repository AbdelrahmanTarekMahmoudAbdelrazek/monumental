"use client";
import { useEffect, useState } from "react";

interface Row {
  id: string; name: string; country: string; heightM: number; heightNote: string; category: string; tier: number; funFact: string;
  silhouetteW: number; silhouetteD: string; imageUrl?: string | null; imageAttribution?: string | null; enabled: boolean; source: "db" | "builtin";
}
const CATS = ["ancient", "religious", "tower", "statue", "skyscraper", "bridge", "landmark", "animal", "nature", "vehicle", "space"];
const EMPTY: Row = { id: "", name: "", country: "", heightM: 50, heightNote: "", category: "landmark", tier: 3, funFact: "", silhouetteW: 30, silhouetteD: "M0,0 L30,0 L30,100 L0,100 Z", enabled: true, source: "db" };

export default function AdminMonuments() {
  const [rows, setRows] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const load = () => fetch("/api/admin/monuments").then(async (r) => { if (r.status === 403) { setStatus("You need an ADMIN account (set ADMIN_EMAILS and sign in)."); return; } setRows((await r.json()).monuments ?? []); });
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!edit) return;
    const { source, ...body } = edit;
    void source;
    const r = await fetch("/api/admin/monuments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, heightM: Number(body.heightM), tier: Number(body.tier), silhouetteW: Number(body.silhouetteW), imageUrl: body.imageUrl || null, imageAttribution: body.imageAttribution || null }) });
    const d = await r.json();
    setStatus(r.ok ? `Saved ${d.monument.name}. The game server picks it up within 3 minutes.` : `Error: ${d.error ?? "failed"} ${d.issues ? JSON.stringify(d.issues.map((i: { path: string[]; message: string }) => i.path.join(".") + ": " + i.message)) : ""}`);
    if (r.ok) { setEdit(null); load(); }
  };
  const remove = async (id: string) => {
    if (!confirm("Remove the database override for this monument?")) return;
    await fetch(`/api/admin/monuments?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    load();
  };

  const filtered = rows.filter((r) => (r.name + r.country + r.id).toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="mx-auto max-w-5xl px-3 py-6 md:px-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl font-black">Catalogue admin</h1><p className="text-sm text-ink-500 dark:text-ink-300">{rows.length} items · edits are stored in the database and override the built-in dataset.</p></div>
        <button className="btn-primary" onClick={() => setEdit({ ...EMPTY })}>+ Add item</button>
      </div>
      {status && <div className="mt-3 rounded-2xl bg-brand-500/10 p-3 text-sm">{status}</div>}
      <input className="input mt-4" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />

      {edit && (
        <div className="card mt-4 grid gap-3 md:grid-cols-[1fr_220px]">
          <div className="grid gap-2 sm:grid-cols-2">
            <F label="id (slug)"><input className="input" value={edit.id} disabled={edit.source === "builtin" || rows.some((r) => r.id === edit.id && r.source === "db")} onChange={(e) => setEdit({ ...edit, id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} /></F>
            <F label="Name"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></F>
            <F label="Country"><input className="input" value={edit.country} onChange={(e) => setEdit({ ...edit, country: e.target.value })} /></F>
            <F label="Size in metres (height, or diameter for space)"><input className="input" type="number" step="0.1" value={edit.heightM} onChange={(e) => setEdit({ ...edit, heightM: Number(e.target.value) })} /></F>
            <F label="Height note (what's included — antenna / pedestal?)" wide><input className="input" value={edit.heightNote} onChange={(e) => setEdit({ ...edit, heightNote: e.target.value })} /></F>
            <F label="Category"><select className="input" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></F>
            <F label="Difficulty tier (1 famous … 4 obscure)"><input className="input" type="number" min={1} max={4} value={edit.tier} onChange={(e) => setEdit({ ...edit, tier: Number(e.target.value) })} /></F>
            <F label="Fun fact" wide><textarea className="input" rows={2} value={edit.funFact} onChange={(e) => setEdit({ ...edit, funFact: e.target.value })} /></F>
            <F label="Silhouette width (box is W × 100, ground at y=100)"><input className="input" type="number" value={edit.silhouetteW} onChange={(e) => setEdit({ ...edit, silhouetteW: Number(e.target.value) })} /></F>
            <F label="Enabled"><select className="input" value={edit.enabled ? "1" : "0"} onChange={(e) => setEdit({ ...edit, enabled: e.target.value === "1" })}><option value="1">yes</option><option value="0">hidden</option></select></F>
            <F label="Silhouette SVG path (original drawing; y=0 top, y=100 ground)" wide><textarea className="input font-mono text-xs" rows={4} value={edit.silhouetteD} onChange={(e) => setEdit({ ...edit, silhouetteD: e.target.value })} /></F>
            <F label="Image URL (public domain / CC, optional)"><input className="input" value={edit.imageUrl ?? ""} onChange={(e) => setEdit({ ...edit, imageUrl: e.target.value })} /></F>
            <F label="Image attribution"><input className="input" value={edit.imageAttribution ?? ""} onChange={(e) => setEdit({ ...edit, imageAttribution: e.target.value })} /></F>
            <div className="flex gap-2 sm:col-span-2"><button className="btn-primary" onClick={save}>Save</button><button className="btn-ghost" onClick={() => setEdit(null)}>Cancel</button></div>
          </div>
          <div>
            <div className="label">Preview</div>
            <svg viewBox={`-10 -10 ${Math.max(edit.silhouetteW, 40) + 20} 120`} className="w-full rounded-2xl bg-gradient-to-b from-sky-200 to-amber-50 dark:from-ink-900 dark:to-ink-800">
              <path d={edit.silhouetteD} className="fill-ink-800 dark:fill-ink-200" />
              <line x1="-10" x2={edit.silhouetteW + 10} y1="100" y2="100" className="stroke-ink-900/40 dark:stroke-white/40" strokeWidth="1" />
            </svg>
            <p className="mt-2 text-xs text-ink-500 dark:text-ink-300">Draw with clockwise sub-paths (nonzero fill). Height is normalised to 100 units; aspect ratio comes from the width.</p>
          </div>
        </div>
      )}

      <table className="mt-4 w-full text-sm">
        <thead className="text-left text-xs uppercase text-ink-500"><tr><th className="pb-2">Preview</th><th className="pb-2">Name</th><th className="pb-2">Country</th><th className="pb-2 text-right">Height</th><th className="pb-2">Tier</th><th className="pb-2">Source</th><th className="pb-2"></th></tr></thead>
        <tbody>
          {filtered.map((r) => (
            <tr key={r.id} className={`border-t border-ink-100 dark:border-ink-800 ${!r.enabled ? "opacity-40" : ""}`}>
              <td className="py-1"><svg viewBox={`0 0 ${Math.max(r.silhouetteW, 30)} 100`} className="h-8 w-12"><path d={r.silhouetteD} className="fill-ink-700 dark:fill-ink-200" /></svg></td>
              <td className="py-1 font-semibold">{r.name}<div className="text-[10px] font-normal text-ink-400">{r.id} · {r.category}</div></td>
              <td className="py-1">{r.country}</td>
              <td className="py-1 text-right tabular-nums">{r.heightM} m</td>
              <td className="py-1">{r.tier}</td>
              <td className="py-1"><span className={`rounded-full px-2 text-[10px] font-bold uppercase ${r.source === "db" ? "bg-brand-500/15 text-brand-700" : "bg-ink-100 dark:bg-ink-800"}`}>{r.source}</span></td>
              <td className="py-1 text-right"><button className="text-brand-600 hover:underline" onClick={() => setEdit(r)}>Edit</button>{r.source === "db" && <button className="ml-2 text-rose-500 hover:underline" onClick={() => remove(r.id)}>Reset</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function F({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <div className={wide ? "sm:col-span-2" : ""}><label className="label">{label}</label>{children}</div>;
}
