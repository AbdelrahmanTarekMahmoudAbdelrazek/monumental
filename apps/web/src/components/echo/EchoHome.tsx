"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "@/lib/socket";
import { getGuestId, getNickname, setNickname } from "@/lib/identity";

const TITLE = "font-['Special_Elite',ui-monospace,monospace]";

/** /echo — open a room (you're the host) or join one by code. */
export default function EchoHome() {
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
    getSocket().emit("eh_create", { nickname: name, guestId: getGuestId(), userToken: token }, (a) => {
      setBusy(false);
      if (!a.ok || !a.code) return setErr(a.error ?? "Could not open the room — is the game server awake? Try again in 30 s.");
      router.push(`/echo/${a.code}`);
    });
  };
  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase().replace(/.*\/ECHO\//, "");
    if (!/^[A-Z0-9]{4,10}$/.test(c)) return setErr("Enter the room code from the invite link");
    setNickname(nick.trim() || getNickname());
    router.push(`/echo/${c}`);
  };

  return (
    <div className="min-h-[calc(100vh-57px)] bg-[#07080A] bg-[radial-gradient(ellipse_60%_70%_at_25%_30%,#141A17,#07080A_70%)] px-4 py-10 font-['IBM_Plex_Sans_Arabic',system-ui,sans-serif] text-[#D9DED8]">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Special+Elite&family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap" rel="stylesheet" />
      <div className="mx-auto max-w-5xl">
        <h1 className={`${TITLE} text-6xl leading-none text-[#E9E4D6] md:text-7xl`}>ECHO HALLS</h1>
        <p className="mt-3 max-w-2xl text-lg text-[#9FA89F]">Stay together. Find the way out. <span className="text-[#E0675C]">Trust no voice.</span></p>
        <p className="mt-2 max-w-2xl text-sm text-[#7E887E]">Marrowfield sank into the earth in 2011. Every police team sent down was lost. Fifteen years later, you and up to 3 friends go down to find out why — and something down there can speak with your voices.</p>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border border-[#3E5A4A] bg-[#101412] p-5">
            <h2 className={`${TITLE} text-2xl text-[#E9E4D6]`}>Open a room</h2>
            <label className="mt-3 block text-xs font-semibold uppercase tracking-wider text-[#7E887E]" htmlFor="eh-nick">Your name</label>
            <input id="eh-nick" className="mt-1 w-full rounded-xl border border-[#2A312C] bg-black/40 px-3 py-2" maxLength={20} value={nick} onChange={(e) => setNick(e.target.value)} />
            <button className={`${TITLE} mt-4 h-14 w-full rounded-xl bg-[#E9E4D6] text-xl text-black disabled:opacity-60`} data-testid="eh-create" disabled={busy} onClick={create}>{busy ? "Opening…" : "Open a room & get the link"}</button>
            <p className="mt-2 text-xs text-[#7E887E]">Send the link to up to 3 friends. Headphones recommended.</p>
          </div>
          <form className="rounded-3xl border border-[#222924] bg-[#101412] p-5" onSubmit={join}>
            <h2 className={`${TITLE} text-2xl text-[#E9E4D6]`}>Join a room</h2>
            <p className="mt-1 text-sm text-[#9FA89F]">Got an invite link? Just open it. Or type the room code:</p>
            <label className="sr-only" htmlFor="eh-code">Room code</label>
            <input id="eh-code" className="mt-3 w-full rounded-xl border border-[#2A312C] bg-black/40 px-3 py-2 font-mono uppercase" placeholder="ABCDE" maxLength={60} value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="mt-4 h-12 w-full rounded-xl border border-[#3A433D] font-semibold">Join</button>
          </form>
        </div>
        {err && <p className="mt-4 rounded-xl bg-[#2A1512] px-4 py-3 text-sm text-[#F1C9C4]">{err}</p>}
      </div>
    </div>
  );
}
