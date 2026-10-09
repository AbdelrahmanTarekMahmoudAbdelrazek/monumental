"use client";
import { useEffect, useState } from "react";
import EchoGame from "./EchoGame";

/** Fetches a socket token for signed-in users, then mounts the room. Client-only. */
export default function EchoGate({ code }: { code: string }) {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    fetch("/api/socket-token").then((r) => r.json()).then((d) => setToken(d.token ?? null)).catch(() => setToken(null));
  }, []);
  if (token === undefined) return <div className="grid h-[calc(100dvh-57px)] place-items-center bg-black text-sm text-[#7E887E]">Loading…</div>;
  return <EchoGame code={code} userToken={token} />;
}
