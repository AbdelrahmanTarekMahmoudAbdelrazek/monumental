"use client";
import { useState } from "react";
import { SITE_VERSION, SITE_VERSIONS } from "@monumental/shared";

/** The current update: number, name and the big change (so every update is easy to tell apart). */
export default function VersionBanner({ dark = false }: { dark?: boolean }) {
  const [open, setOpen] = useState(false);
  const v = SITE_VERSION;
  const box = dark ? "border-[#3E5A4A] bg-[#0E1411]/90 text-[#D9DED8]" : "border-brand-500/40 bg-brand-500/5 text-ink-800 dark:text-ink-100";
  const tag = dark ? "bg-[#E0675C] text-black" : "bg-brand-500 text-white";
  const sub = dark ? "text-[#9FA89F]" : "text-ink-500 dark:text-ink-300";
  return (
    <section className={`mt-4 rounded-2xl border px-4 py-3 ${box}`} data-testid="version-banner">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold tracking-wide ${tag}`}>v{v.v}</span>
        <span className="font-semibold">{v.name}</span>
        <span className={`text-sm ${sub}`}>{v.big}</span>
        <button className={`ml-auto text-xs underline underline-offset-4 ${sub}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Hide" : "What's new"}</button>
      </div>
      {open && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {SITE_VERSIONS.map((x) => (
            <div key={x.v}>
              <div className="text-sm font-semibold">v{x.v} · {x.name}</div>
              <ul className={`mt-1 list-disc space-y-0.5 pl-5 text-xs ${sub}`}>
                {(x.v === v.v ? x.more : [x.big, ...x.more]).map((m) => <li key={m}>{m}</li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
