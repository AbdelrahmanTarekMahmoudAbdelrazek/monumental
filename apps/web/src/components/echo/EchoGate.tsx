"use client";
import { useEffect, useState } from "react";
import EchoGame from "./EchoGame";
import EchoIntro from "./EchoIntro";

/** Plays the cold open (once per room per tab), fetches a socket token, then mounts the room. Client-only. */
export default function EchoGate({ code }: { code: string }) {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [intro, setIntro] = useState<boolean | null>(null);
  const key = `eh:intro:${code}`;
  useEffect(() => {
    fetch("/api/socket-token").then((r) => r.json()).then((d) => setToken(d.token ?? null)).catch(() => setToken(null));
    let seen = false;
    try { seen = sessionStorage.getItem(key) === "1" || new URLSearchParams(location.search).has("nointro"); } catch { /* storage blocked */ }
    setIntro(!seen);
  }, [key]);
  const introDone = () => { try { sessionStorage.setItem(key, "1"); } catch { /* storage blocked */ } setIntro(false); };
  const [inRoom, setInRoom] = useState(false);
  useEffect(() => { if (intro === false && token !== undefined) setInRoom(true); }, [intro, token]);
  // once in the room, replaying the story is an overlay so we never leave the room
  if (!inRoom) {
    if (intro) return <EchoIntro onDone={introDone} />;
    return <div className="grid h-[calc(100dvh-57px)] place-items-center bg-black text-sm text-[#7E887E]">Loading…</div>;
  }
  return (
    <>
      <EchoGame code={code} userToken={token ?? null} onStory={() => setIntro(true)} />
      {intro && <EchoIntro onDone={introDone} />}
    </>
  );
}
