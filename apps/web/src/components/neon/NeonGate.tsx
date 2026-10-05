"use client";
import { useEffect, useState } from "react";
import NeonGame from "./NeonGame";

/** Fetches a socket token for signed-in users, then mounts the arena. Client-only. */
export default function NeonGate({ code }: { code: string }) {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    fetch("/api/socket-token").then((r) => r.json()).then((d) => setToken(d.token ?? null)).catch(() => setToken(null));
  }, []);
  if (token === undefined) return <div className="p-10 text-center text-sm text-ink-500">Loading…</div>;
  return <NeonGame code={code} userToken={token} />;
}
