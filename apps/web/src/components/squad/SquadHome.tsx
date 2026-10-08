"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_SQ_SETTINGS, SQ_ROLES, type SqRole } from "@monumental/shared";
import { getSocket } from "@/lib/socket";
import { getGuestId, getNickname, setNickname } from "@/lib/identity";
import { characterSvg } from "./sprites";

/** /squad — create a room (you're the host) or join one by code. */
export default function SquadHome() {
  const router = useRouter();
  const [nick, setNick] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setNick(getNickname()), []);

  const create = async () => {
    setBusy(true); setErr(null);
    const name = nick.trim() || getNickname();
    setNickname(name);
    const token = await fetch("/api/socket-token").then((r) => r.json()).then((d) => d.token ?? undefined).catch(() => undefined);
    getSocket().emit("sq_create", { settings: DEFAULT_SQ_SETTINGS, nickname: name, guestId: getGuestId(), userToken: token }, (a) => {
      setBusy(false);
      if (!a.ok || !a.code) return setErr(a.error ?? "Could not create the room — is the game server awake? Try again in 30 s.");
      router.push(`/squad/${a.code}`);
    });
  };
  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase().replace(/.*\/SQUAD\//, "");
    if (!/^[A-Z0-9]{4,10}$/.test(c)) return setErr("Enter the room code from the invite link");
    setNickname(nick.trim() || getNickname());
    router.push(`/squad/${c}`);
  };

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[#0B1118] bg-[radial-gradient(circle_at_50%_0%,rgba(255,178,36,0.12),transparent_55%)] px-3 py-8 text-white md:px-4">
      <div className="mx-auto max-w-5xl">
        <h1 className="font-['Chakra_Petch',system-ui,sans-serif] text-5xl font-bold tracking-[0.06em]">SQUAD RUSH</h1>
        <p className="mt-2 max-w-2xl text-white/80">Red vs Blue top-down team shooter. Pick a role, fight for power-ups, and keep your squad alive — knocked-down teammates can be revived.</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {(["healer", "tank", "fighter"] as SqRole[]).map((r) => {
            const d = SQ_ROLES[r];
            return (
              <div key={r} className="flex items-center gap-3 rounded-2xl border border-[#1F2B38] bg-[#111922] p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="" width={64} height={64} style={{ transform: "rotate(-90deg)" }} src={"data:image/svg+xml;charset=utf-8," + encodeURIComponent(characterSvg(r, "red"))} />
                <div>
                  <div className="font-bold tracking-wide" style={{ color: d.accent }}>{d.label.toUpperCase()}</div>
                  <div className="text-xs text-[#B6C1CE]">{d.tagline}</div>
                  <div className="mt-0.5 text-[11px] text-[#8A97A8]">{d.hp} HP · {d.weapon.name} · {d.ability.name}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border border-[#FFB224]/40 bg-[#111922] p-5">
            <h2 className="text-lg font-black">Open a team room</h2>
            <label className="mt-3 block text-xs font-bold uppercase tracking-wider text-white/60" htmlFor="sq-nick">Your name</label>
            <input id="sq-nick" className="mt-1 w-full rounded-xl bg-black/40 px-3 py-2" maxLength={20} value={nick} onChange={(e) => setNick(e.target.value)} />
            <button className="mt-4 w-full rounded-xl bg-[#FFB224] py-3 font-bold text-[#0B1118] disabled:opacity-60" data-testid="sq-create" disabled={busy} onClick={create}>{busy ? "Opening…" : "Create room & get invite link →"}</button>
            <p className="mt-2 text-xs text-white/50">Bots fill empty slots, so you can play right away.</p>
          </div>
          <form className="rounded-3xl border border-white/10 bg-[#111922] p-5" onSubmit={join}>
            <h2 className="text-lg font-black">Join a room</h2>
            <p className="mt-1 text-sm text-white/70">Got an invite link? Just open it. Or type the room code:</p>
            <label className="sr-only" htmlFor="sq-code">Room code</label>
            <input id="sq-code" className="mt-3 w-full rounded-xl bg-black/40 px-3 py-2 font-mono uppercase" placeholder="ABCDE" maxLength={60} value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="mt-4 w-full rounded-xl border border-white/30 py-3 font-bold hover:bg-white/10">Join →</button>
          </form>
        </div>
        {err && <p className="mt-3 text-sm font-semibold text-rose-300">{err}</p>}
      </div>
    </div>
  );
}
